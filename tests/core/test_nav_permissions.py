"""Sidebar and module access follow effective permissions (preset + per-user switches).

The Staff preset is ``mark_attendance`` only, so a staff user must see "Mark attendance" (and
reach /api/attendance) without the report or People; a manager gets both attendance entries and
Employees; a switch turned on for one user shows up for that user alone.
"""

import pytest

from app.core.models import Branch
from app.core.modules import Module, NavItem
from app.main import MODULES
from app.modules.admin import permissions as perm
from app.modules.admin.models import UserAccess

pytestmark = pytest.mark.anyio

MARK = {"label": "Mark attendance", "path": "/attendance/mark", "icon": "check"}
REPORT = {"label": "Attendance report", "path": "/attendance/report", "icon": "calendar"}
EMPLOYEES = {"label": "Employees", "path": "/people/employees", "icon": "users"}


def _sections(modules_json) -> dict[str, list[dict]]:
    return {s["module"]: s["items"] for s in modules_json["nav"]}


async def _grant(db, user, **switches) -> None:
    db.add(UserAccess(user_id=user.id, access=perm.effective_access(user.role, switches)))
    await db.flush()


async def test_staff_preset_sees_mark_attendance_only(client, make_user, login):
    await make_user("clerk", role="staff")
    await login("clerk")
    sections = _sections((await client.get("/api/core/modules")).json())
    assert sections == {"attendance": [MARK]}

    registry = {m["name"]: m for m in (await client.get("/api/registry")).json()["modules"]}
    assert registry["attendance"]["allowed"] is True
    assert [i["path"] for i in registry["attendance"]["nav"]] == ["/attendance/mark"]
    assert registry["attendance"]["nav"][0]["permission"] == "mark_attendance"
    for name in ("payroll", "admin"):
        assert registry[name]["allowed"] is False and registry[name]["nav"] == []

    assert (await client.get("/api/attendance")).status_code == 200
    forbidden = await client.get("/api/payroll")
    assert forbidden.status_code == 403
    assert forbidden.json()["detail"] == perm.NO_ACCESS_DETAIL
    assert (await client.get("/api/admin")).status_code == 403


async def test_manager_preset_sees_both_attendance_entries_and_employees(client, make_user, login):
    await make_user("boss", role="manager")
    await login("boss")
    sections = _sections((await client.get("/api/core/modules")).json())
    assert sections["attendance"] == [MARK, REPORT]
    assert sections["payroll"] == [EMPLOYEES], "Salary & advances is off in the Manager preset"
    assert "admin" not in sections
    assert (await client.get("/api/payroll")).status_code == 200


async def test_staff_with_report_switched_on_sees_the_report(client, make_user, login, db):
    plain = await make_user("clerk", role="staff")
    viewer = await make_user("viewer", role="staff")
    await _grant(db, viewer, view_attendance_report=True)

    await login("viewer")
    sections = _sections((await client.get("/api/core/modules")).json())
    assert sections == {"attendance": [MARK, REPORT]}

    await login("clerk")  # the switch is per user: the other staff account is unchanged
    assert _sections((await client.get("/api/core/modules")).json()) == {"attendance": [MARK]}
    assert plain.id != viewer.id


async def test_staff_with_salary_advances_reaches_people(client, make_user, login, db):
    """A switch unlocks the module's shared endpoints too (``require_any_access``)."""
    payer = await make_user("payer", role="staff")
    await _grant(db, payer, salary_advances=True)
    await login("payer")
    sections = _sections((await client.get("/api/core/modules")).json())
    assert [i["label"] for i in sections["payroll"]] == ["Salary report", "Payment reports"]
    assert (await client.get("/api/payroll")).status_code == 200


async def test_switching_mark_attendance_off_hides_attendance(client, make_user, login, db):
    nobody = await make_user("nobody", role="staff")
    await _grant(db, nobody, mark_attendance=False)
    await login("nobody")
    assert (await client.get("/api/core/modules")).json()["nav"] == []
    assert (await client.get("/api/attendance")).status_code == 403


async def test_admin_keeps_everything(client, make_user, login, db):
    admin = await make_user("admin")
    await _grant(db, admin, manage_users=False)  # ignored: admins cannot lose manage_users
    await login("admin")
    registry = (await client.get("/api/registry")).json()["modules"]
    assert all(m["allowed"] for m in registry)
    assert [len(m["nav"]) for m in registry] == [len(m.nav) for m in MODULES]


async def test_session_carries_branch_and_effective_access(client, make_user, login, db):
    """``/api/auth/me`` gives every screen the user's own branch and permissions, so payroll
    and attendance need neither a "first branch" fallback nor role checks."""
    branch = Branch(name="Branch 2")
    db.add(branch)
    await db.flush()
    clerk = await make_user("clerk", role="staff")
    db.add(
        UserAccess(
            user_id=clerk.id,
            branch_id=branch.id,
            access=perm.effective_access("staff", {"view_attendance_report": True}),
        )
    )
    await db.flush()
    await login("clerk")
    me = (await client.get("/api/auth/me")).json()
    assert me["branch_id"] == branch.id
    assert me["access"] == {
        "mark_attendance": True,
        "view_attendance_report": True,
        "see_other_branches": False,
        "manage_employees": False,
        "salary_advances": False,
        "manage_users": False,
    }

    await make_user("plain", role="staff")  # no user_access row: preset, no branch
    login_body = (await login("plain")).json()
    assert login_body["branch_id"] is None
    assert login_body["access"] == perm.preset_for("staff")


def test_nav_item_visibility_combines_role_and_permission():
    item = NavItem("Mark", "/attendance/mark", "check", permission="mark_attendance")
    assert item.visible_to("staff", {"mark_attendance": True})
    assert not item.visible_to("staff", {"mark_attendance": False})
    assert not item.visible_to("staff", None)
    assert not item.visible_to(None, {"mark_attendance": True})
    admin_only = NavItem("Barcodes", "/admin/barcodes", "barcode", roles={"admin"})
    assert admin_only.visible_to("admin") and not admin_only.visible_to("manager", {})
    both = NavItem("X", "/x", "x", roles={"admin"}, permission="manage_users")
    assert both.visible_to("admin", {"manage_users": True})
    assert not both.visible_to("manager", {"manage_users": True})
    module = Module("x", "X", MODULES[0].router, [item, admin_only])
    assert module.permissions == {"mark_attendance"}
    assert module.allowed("staff", {"mark_attendance": True})
    assert not module.allowed("staff", {"mark_attendance": False})


def test_every_module_entry_names_a_catalogue_permission_or_a_role():
    for module in MODULES:
        for item in module.nav:
            assert item.permission in perm.PERMISSIONS or item.roles, (module.name, item.label)
