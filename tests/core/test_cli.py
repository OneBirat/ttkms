import pytest
from sqlalchemy import func, select

from app import cli
from app.core.models import AuditLog, Branch, Department, Employee, Role, Setting, User
from app.core.services import find_branch, get_setting
from app.modules.admin.models import UserAccess
from app.modules.admin.permissions import effective_access, preset_for

pytestmark = pytest.mark.anyio


async def _count(db, model) -> int:
    return int(await db.scalar(select(func.count()).select_from(model)) or 0)


async def test_seed_reference_data_is_idempotent(db):
    first = await cli.seed_reference_data(db)
    assert first == {"branches": 2, "departments": 5, "settings": 3, "employees": 5}
    assert await _count(db, Branch) == 2
    assert await _count(db, Department) == 5
    assert await _count(db, Employee) == 5
    assert await _count(db, Setting) == 3
    assert await get_setting(db, "late_after") == "09:30"
    assert await get_setting(db, "weekly_off") == ["sat"]
    assert await get_setting(db, "company_name") == "TTK"
    assert (await find_branch(db, "main branch")) is not None

    second = await cli.seed_reference_data(db)
    assert second == {"branches": 0, "departments": 0, "settings": 0, "employees": 0}
    assert await _count(db, Employee) == 5

    employees = (await db.execute(select(Employee).order_by(Employee.id))).scalars().all()
    assert all(e.code.startswith("E-") for e in employees)
    assert {e.branch.name for e in employees} == {"Main branch", "Branch 2"}
    assert employees[0].department is not None and employees[0].department.name == "Store"


async def test_ensure_admin_creates_then_updates(db):
    user, created = await cli.ensure_admin(db, " Admin ", "very-secret-1")
    assert created and user.username == "admin" and user.role == Role.admin
    assert await _count(db, User) == 1

    same, created_again = await cli.ensure_admin(db, "admin", "new-password-2")
    assert not created_again and same.id == user.id
    assert await _count(db, User) == 1

    from app.core.auth import verify_password

    assert verify_password(same.password_hash, "new-password-2")


async def test_ensure_admin_validates(db):
    with pytest.raises(cli.CliError):
        await cli.ensure_admin(db, "   ", "very-secret-1")
    with pytest.raises(cli.CliError):
        await cli.ensure_admin(db, "admin", "short")


def test_resolve_credentials_from_env(monkeypatch):
    monkeypatch.setattr(cli.settings, "admin_username", "boss")
    monkeypatch.setattr(cli.settings, "admin_password", "very-secret-1")
    assert cli.resolve_credentials(no_input=True) == ("boss", "very-secret-1")


def test_resolve_credentials_no_input_without_env(monkeypatch):
    monkeypatch.setattr(cli.settings, "admin_username", None)
    monkeypatch.setattr(cli.settings, "admin_password", None)
    with pytest.raises(cli.CliError):
        cli.resolve_credentials(no_input=True)


def test_resolve_credentials_prompts(monkeypatch):
    monkeypatch.setattr(cli.settings, "admin_username", None)
    monkeypatch.setattr(cli.settings, "admin_password", None)
    monkeypatch.setattr("builtins.input", lambda prompt: " admin ")
    answers = iter(["pw-12345678", "pw-12345678"])
    monkeypatch.setattr(cli.getpass, "getpass", lambda prompt: next(answers))
    assert cli.resolve_credentials(no_input=False) == ("admin", "pw-12345678")


def test_parser_has_both_commands():
    parser = cli.build_parser()
    assert parser.parse_args(["seed", "--no-input"]).func is cli.cmd_seed
    create = parser.parse_args(["create-admin", "--force"])
    assert create.func is cli.cmd_create_admin and create.force


def _answers(*values):
    """(ask, secret) prompt stand-ins that hand out ``values`` in order and record the prompts."""
    queue, prompts = list(values), []

    def answer(prompt):
        prompts.append(prompt)
        return queue.pop(0)

    return answer, answer, prompts


async def test_create_first_admin_makes_the_first_branch_and_an_admin(db):
    ask, secret, prompts = _answers(
        "Sita Sharma", "+977 984-1000002", "very-secret-1", "very-secret-1", "Main branch"
    )
    user, branch = await cli.create_first_admin(db, force=False, ask=ask, secret=secret)
    assert prompts[-1].startswith("No branch yet")
    assert branch is not None and branch.name == "Main branch"
    # A phone login: username = phone, like the users the admin pages create.
    assert (user.username, user.phone, user.full_name) == (
        "9841000002",
        "9841000002",
        "Sita Sharma",
    )
    assert user.role == Role.admin and user.is_active and not user.must_change_password
    assert user.active_branch_id == branch.id
    access = await db.get(UserAccess, user.id)
    assert access.branch_id is None and access.access is None  # Admin preset, all branches
    assert effective_access(user.role, access.access) == preset_for(Role.admin)
    from app.core.auth import verify_password

    assert verify_password(user.password_hash, "very-secret-1")
    audit = await db.scalar(select(AuditLog).where(AuditLog.action == "cli_create_admin"))
    assert audit.entity_id == str(user.id)


async def test_create_admin_refuses_while_an_admin_exists_unless_forced(db):
    db.add(Branch(name="Main branch"))
    await db.flush()
    ask, secret, _ = _answers("Admin", "admin", "very-secret-1", "very-secret-1")
    first, branch = await cli.create_first_admin(db, force=False, ask=ask, secret=secret)
    assert branch is None and first.username == "admin"  # a branch exists: not asked

    ask, secret, prompts = _answers()
    with pytest.raises(cli.CliError, match="already exist"):
        await cli.create_first_admin(db, force=False, ask=ask, secret=secret)
    assert prompts == []  # refused before asking anything

    ask, secret, _ = _answers("Boss", "boss", "other-secret-2", "other-secret-2")
    second, _ = await cli.create_first_admin(db, force=True, ask=ask, secret=secret)
    assert second.role == Role.admin and await _count(db, User) == 2


async def test_create_admin_force_promotes_an_existing_login(db):
    db.add(Branch(name="Main branch"))
    clerk = User(username="clerk", full_name="Clerk", role=Role.staff, password_hash="x")
    db.add(clerk)
    await db.flush()
    ask, secret, _ = _answers("Clerk Two", "clerk", "very-secret-1", "very-secret-1")
    with pytest.raises(cli.CliError, match="already exists"):
        await cli.create_first_admin(db, force=False, ask=ask, secret=secret)
    ask, secret, _ = _answers("Clerk Two", "clerk", "very-secret-1", "very-secret-1")
    user, _ = await cli.create_first_admin(db, force=True, ask=ask, secret=secret)
    assert user.id == clerk.id and user.role == Role.admin and await _count(db, User) == 1


@pytest.mark.parametrize(
    "answers, message",
    [
        (("", "admin", "very-secret-1", "very-secret-1"), "full name"),
        (("Admin", "  ", "very-secret-1", "very-secret-1"), "username"),
        (("Admin", "admin", "short", "short"), "at least 8"),
        (("Admin", "admin", "very-secret-1", "very-secret-2"), "do not match"),
        (("Admin", "admin", "very-secret-1", "very-secret-1", " "), "branch name"),
    ],
)
async def test_create_admin_validates(db, answers, message):
    ask, secret, _ = _answers(*answers)
    with pytest.raises(cli.CliError, match=message):
        await cli.create_first_admin(db, force=False, ask=ask, secret=secret)
    assert await _count(db, User) == 0 and await _count(db, Branch) == 0


def test_seed_demo_refuses_in_production(monkeypatch, capsys):
    monkeypatch.setattr(cli.settings, "app_env", "prod")
    assert cli.main(["seed-demo"]) == 2
    assert "APP_ENV=dev" in capsys.readouterr().err
