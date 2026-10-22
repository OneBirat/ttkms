import pytest
from sqlalchemy import func, select

from app import cli
from app.core.models import Branch, Department, Employee, Role, Setting, User
from app.core.services import find_branch, get_setting

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
    assert parser.parse_args(["create-admin", "--username", "x"]).func is cli.cmd_create_admin
