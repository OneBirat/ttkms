"""Command-line admin tasks (argparse, no typer).

    python -m app.cli create-admin          # prompts for username / password
    python -m app.cli seed [--no-input]     # branches, departments, 5 employees, settings, admin
    python -m app.cli seed-demo             # the 25 design employees + salaries + a month of
                                            # payments (APP_ENV=dev only; never automatic)
    python -m app.cli photos-upgrade        # old employees/<id>.jpg photos -> 600 px JPEG +
                                            # 128 px WebP, metadata stripped (run once)

All are idempotent. The admin user's credentials come from ADMIN_USERNAME / ADMIN_PASSWORD in
.env (or the environment) when set, otherwise you are prompted.
"""

from __future__ import annotations

import argparse
import asyncio
import getpass
import sys
from collections.abc import Sequence

from sqlalchemy import select
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
    normalize_username,
)
from app.core.services import DEFAULT_SETTINGS, find_branch, find_department
from app.db import SessionLocal

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
    username, password = resolve_credentials(args.no_input, username=args.username)
    async with SessionLocal() as db:
        user, created = await ensure_admin(db, username, password)
        await db.commit()
    print(f"{'Created' if created else 'Updated'} admin user {user.username!r}.")
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

    create = sub.add_parser("create-admin", help="create (or reset) the admin user")
    create.add_argument("--username", help="admin username (default: ADMIN_USERNAME or prompt)")
    create.add_argument("--no-input", action="store_true", help="never prompt; use env vars")
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
