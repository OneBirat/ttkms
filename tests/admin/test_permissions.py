"""Per-user access: presets, overrides and the require_access dependency."""

import pytest

from app.core.models import Role
from app.modules.admin import permissions as perm
from app.modules.admin.models import UserAccess

pytestmark = pytest.mark.anyio


def test_catalogue_matches_the_design():
    assert perm.PERMISSIONS == (
        "mark_attendance",
        "view_attendance_report",
        "see_other_branches",
        "manage_employees",
        "salary_advances",
        "manage_users",
    )
    assert perm.preset_for("admin") == dict.fromkeys(perm.PERMISSIONS, True)
    assert perm.preset_for(Role.manager) == {
        "mark_attendance": True,
        "view_attendance_report": True,
        "see_other_branches": False,
        "manage_employees": True,
        "salary_advances": False,
        "manage_users": False,
    }
    assert [k for k, on in perm.preset_for("staff").items() if on] == ["mark_attendance"]


def test_effective_access_applies_overrides_and_locks_admin_manage_users():
    access = perm.effective_access("staff", {"salary_advances": True, "bogus": True})
    assert access["salary_advances"] is True and access["mark_attendance"] is True
    assert "bogus" not in access
    assert perm.effective_access("admin", {"manage_users": False})["manage_users"] is True
    assert perm.effective_access("manager", {"manage_users": 1})["manage_users"] is True


def test_is_custom_and_clean_overrides():
    assert perm.is_custom("manager", None) is False
    assert perm.is_custom("manager", perm.preset_for("manager")) is False
    assert perm.is_custom("manager", {"salary_advances": True}) is True
    # Equal to the preset -> nothing stored; different -> the full map is stored.
    assert perm.clean_overrides("staff", {"mark_attendance": True}) is None
    stored = perm.clean_overrides("staff", {"mark_attendance": False})
    assert stored is not None and set(stored) == set(perm.PERMISSIONS)
    assert stored["mark_attendance"] is False
    # Admins: overriding manage_users off changes nothing, so it is not "custom".
    assert perm.clean_overrides("admin", {"manage_users": False}) is None


def test_require_access_rejects_unknown_permissions():
    with pytest.raises(ValueError):
        perm.require_access("fly")
    with pytest.raises(ValueError):
        perm.require_access()


async def test_require_access_uses_presets_and_overrides(client, make_user, login, db):
    await make_user("boss", role="manager")
    await login("boss")
    assert (await client.get("/api/admin/users")).status_code == 403

    clerk = await make_user("clerk", role="staff")
    db.add(
        UserAccess(user_id=clerk.id, access=perm.effective_access("staff", {"manage_users": True}))
    )
    await db.flush()
    await login("clerk")
    response = await client.get("/api/admin/users")
    assert response.status_code == 200
    me = next(u for u in response.json() if u["username"] == "clerk")
    assert me["custom"] is True and me["access"]["manage_users"] is True


async def test_permissions_endpoint(client, make_user, login):
    await make_user("clerk", role="staff")
    await login("clerk")
    body = (await client.get("/api/admin/permissions")).json()
    assert [g["title"] for g in body["groups"]] == ["Attendance", "People & payroll", "Admin"]
    assert body["presets"]["staff"] == ["mark_attendance"]
    assert len(body["presets"]["admin"]) == 6
