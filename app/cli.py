"""Command-line admin tasks (argparse, no typer).

    python -m app.cli create-admin [--force] # the first admin (and first branch); prompts
    python -m app.cli seed [--no-input]     # branches, departments, 5 employees, settings, admin
    python -m app.cli seed-demo             # the 25 design employees + salaries + a month of
                                            # payments (APP_ENV=dev only; never automatic)
    python -m app.cli photos-upgrade        # old employees/<id>.jpg photos -> 600 px JPEG +
                                            # 128 px WebP, metadata stripped (run once)

``seed`` and ``seed-demo`` are idempotent development helpers; seed's admin credentials come from
ADMIN_USERNAME / ADMIN_PASSWORD in .env (or the environment) when set, otherwise you are prompted.
``create-admin`` is the production one (deploy/create-admin.sh runs it as the ttk user): it always
asks, and refuses while an admin exists unless ``--force``.
"""

from __future__ import annotations

import argparse
import asyncio
import getpass
import sys
from collections.abc import Callable, Sequence

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.core.auth import hash_password
from app.core.models import (
    Branch,
    Department,
    Employee,
    Role,
    Setting,
    User,
    is_phone,
    normalize_phone,
    normalize_username,
)
from app.core.services import DEFAULT_SETTINGS, find_branch, find_department, record_audit
from app.db import SessionLocal
from app.modules.admin.models import UserAccess

SEED_BRANCHES = ["Main branch", "Branch 2"]
SEED_DEPARTMENTS = ["Store", "Kitchen", "Housekeeping", "Front desk", "Accounts"]
# (full name, phone, branch, department, designation)
SEED_EMPLOYEES = [
    ("Ram Bahadur Thapa", "9841000001", "Main branch", "Store", "Store keeper"),
    ("Sita Sharma", "9841000002", "Main branch", "Accounts", "Accountant"),
    ("Hari Prasad Adhikari", "9841000003", "Main branch", "Kitchen", "Head cook"),
    ("Gita Rai", "9841000004", "Branch 2", "Housekeeping", "Housekeeper"),
    ("Bikash Shrestha", "9841000005", "Branch 2", "Front desk", "Front desk officer"),
]
MIN_PASSWORD_LENGTH = 8


class CliError(Exception):
    pass


# --------------------------------------------------------------------------- operations


async def ensure_admin(
    db: AsyncSession, username: str, password: str, full_name: str = "Administrator"
) -> tuple[User, bool]:
    """Create the admin user, or reset the password/role of an existing one. Not committed."""
    uname = normalize_username(username)
    if not uname:
        raise CliError("username must not be empty")
    if len(password) < MIN_PASSWORD_LENGTH:
        raise CliError(f"password must be at least {MIN_PASSWORD_LENGTH} characters")
    user = await db.scalar(select(User).where(User.username == uname))
    created = user is None
    if user is None:
        user = User(username=uname, full_name=full_name, role=Role.admin)
        db.add(user)
    user.password_hash = hash_password(password)
    user.role = Role.admin
    user.is_active = True
    await db.flush()
    return user, created


async def seed_reference_data(db: AsyncSession) -> dict[str, int]:
    """Branches, departments, settings and sample employees. Idempotent. Not committed."""
    created = {"branches": 0, "departments": 0, "settings": 0, "employees": 0}

    for key, value in DEFAULT_SETTINGS.items():
        if await db.get(Setting, key) is None:
            db.add(Setting(key=key, value=value))
            created["settings"] += 1

    branches: dict[str, Branch] = {}
    for name in SEED_BRANCHES:
        branch = await find_branch(db, name)
        if branch is None:
            branch = Branch(name=name)
            db.add(branch)
            created["branches"] += 1
        branches[name] = branch

    departments: dict[str, Department] = {}
    for name in SEED_DEPARTMENTS:
        department = await find_department(db, name)
        if department is None:
            department = Department(name=name)
            db.add(department)
            created["departments"] += 1
        departments[name] = department
    await db.flush()

    for full_name, phone, branch_name, department_name, designation in SEED_EMPLOYEES:
        exists = await db.scalar(
            select(Employee).where(Employee.full_name == full_name, Employee.phone == phone)
        )
        if exists is None:
            db.add(
                Employee(
                    full_name=full_name,
                    phone=phone,
                    branch=branches[branch_name],
                    department=departments[department_name],
                    designation=designation,
                )
            )
            created["employees"] += 1
    await db.flush()
    return created


async def create_first_admin(
    db: AsyncSession,
    *,
    force: bool,
    ask: Callable[[str], str] = input,
    secret: Callable[[str], str] = getpass.getpass,
) -> tuple[User, Branch | None]:
    """The production ``create-admin``: full name, username or phone, password (twice), and the
    first branch when there is none. The user gets the Admin preset (role admin, no overrides,
    all branches) and starts on the first branch A-Z. Returns (user, branch created or None).
    Refuses while any admin exists unless ``force`` (then an existing login with the same
    username is promoted and its password reset). Not committed."""
    admins = await db.scalar(select(func.count()).select_from(User).where(User.role == Role.admin))
    if admins and not force:
        raise CliError(
            f"{admins} admin user(s) already exist; sign in as one of them, or run again with "
            "--force to add (or reset) another admin"
        )

    full_name = ask("Full name: ").strip()
    if not full_name:
        raise CliError("full name must not be empty")
    login = ask("Username or phone: ").strip()
    phone = normalize_phone(login) if is_phone(login) else None
    username = phone or normalize_username(login)
    if not username:
        raise CliError("username must not be empty")
    password = secret("Password: ")
    if len(password) < MIN_PASSWORD_LENGTH:
        raise CliError(f"password must be at least {MIN_PASSWORD_LENGTH} characters")
    if secret("Password again: ") != password:
        raise CliError("passwords do not match")

    user = await db.scalar(select(User).where(User.username == username))
    if user is not None and not force:
        raise CliError(f"a user named {username!r} already exists (use --force to make it admin)")
    if phone:
        taken = await db.scalar(select(User).where(User.phone == phone))
        if taken is not None and taken is not user:
            raise CliError(f"phone {phone} is already the login of {taken.username!r}")

    created_branch: Branch | None = None
    first = await db.scalar(
        select(Branch).where(Branch.is_active.is_(True)).order_by(Branch.name, Branch.id).limit(1)
    )
    if first is None:
        name = ask("No branch yet. Name of the first branch: ").strip()
        if not name:
            raise CliError("branch name must not be empty")
        first = await find_branch(db, name)  # an inactive branch of that name: switch it on
        if first is None:
            first = created_branch = Branch(name=name)
            db.add(first)
        first.is_active = True
        await db.flush()

    created = user is None
    if user is None:
        user = User(username=username)
        db.add(user)
    user.full_name = full_name
    user.phone = phone or user.phone
    user.role = Role.admin
    user.is_active = True
    user.must_change_password = False
    user.password_hash = hash_password(password)
    user.active_branch_id = first.id
    await db.flush()
    access = await db.get(UserAccess, user.id)
    if access is None:
        access = UserAccess(user_id=user.id)
        db.add(access)
    access.branch_id = None  # admins: all branches
    access.access = None  # the Admin preset, no overrides
    await record_audit(
        db,
        module="core",
        action="cli_create_admin" if created else "cli_make_admin",
        entity="user",
        entity_id=user.id,
        user_id=None,
        data={"username": user.username, "branch_created": created_branch is not None},
    )
    await db.flush()
    return user, created_branch


# --------------------------------------------------------------------------- commands


def resolve_credentials(
    no_input: bool, *, username: str | None = None, confirm: bool = True
) -> tuple[str, str]:
    username = username or settings.admin_username
    password = settings.admin_password
    if username is None:
        if no_input:
            raise CliError("ADMIN_USERNAME is not set and --no-input was given")
        username = input("Admin username: ").strip()
    if password is None:
        if no_input:
            raise CliError("ADMIN_PASSWORD is not set and --no-input was given")
        password = getpass.getpass("Admin password: ")
        if confirm and getpass.getpass("Confirm password: ") != password:
            raise CliError("passwords do not match")
    return username, password


async def cmd_create_admin(args: argparse.Namespace) -> int:
    async with SessionLocal() as db:
        user, branch = await create_first_admin(db, force=args.force)
        await db.commit()
    if branch is not None:
        print(f"Created branch {branch.name!r}.")
    print(f"Admin {user.username!r} ({user.full_name}) is ready. Sign in with it.")
    return 0


async def cmd_seed(args: argparse.Namespace) -> int:
    username, password = resolve_credentials(args.no_input)
    async with SessionLocal() as db:
        created = await seed_reference_data(db)
        user, admin_created = await ensure_admin(db, username, password)
        await db.commit()
    for key, count in created.items():
        print(f"  {key:<12} +{count}")
    print(f"  admin        {'created' if admin_created else 'exists'} ({user.username})")
    print("Seed complete.")
    return 0


async def cmd_seed_demo(args: argparse.Namespace) -> int:
    from app.modules.payroll.seed_demo import NotDevelopment, seed_demo

    try:
        async with SessionLocal() as db:
            created = await seed_demo(db)
            await db.commit()
    except NotDevelopment as exc:
        raise CliError(str(exc)) from None
    for key, count in created.items():
        print(f"  {key:<12} +{count}")
    print("Demo seed complete.")
    return 0


async def cmd_photos_upgrade(args: argparse.Namespace) -> int:
    from app.modules.payroll.photos import upgrade_legacy

    async with SessionLocal() as db:
        done = await upgrade_legacy(db)
    print(f"Converted {done} photo(s) to the 600 px JPEG + 128 px WebP layout.")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="python -m app.cli", description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)

    create = sub.add_parser(
        "create-admin", help="create the first admin (and the first branch when there is none)"
    )
    create.add_argument(
        "--force", action="store_true", help="add or reset an admin even when one already exists"
    )
    create.set_defaults(func=cmd_create_admin)

    seed = sub.add_parser("seed", help="load reference data, sample employees and the admin user")
    seed.add_argument("--no-input", action="store_true", help="never prompt; use env vars")
    seed.set_defaults(func=cmd_seed)

    demo = sub.add_parser(
        "seed-demo", help="sample employees, salaries and payments (APP_ENV=dev only)"
    )
    demo.set_defaults(func=cmd_seed_demo)

    photos = sub.add_parser(
        "photos-upgrade",
        help="convert photos stored as employees/<id>.jpg to the two-size layout (run once)",
    )
    photos.set_defaults(func=cmd_photos_upgrade)
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        return asyncio.run(args.func(args))
    except CliError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
