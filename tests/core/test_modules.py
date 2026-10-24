import pytest

from app.core.models import Role
from app.core.modules import MODULE_NAMES, Module, NavItem, enabled_modules, is_enabled
from app.main import MODULES
from app.modules.admin.permissions import preset_for

pytestmark = pytest.mark.anyio

TITLES = {
    "attendance": "Attendance",
    "payroll": "People & payroll",
    "admin": "Admin",
}

#: Where a module's pages live in the Next.js app. Payroll's sidebar section is "People", so its
#: pages sit under /people (web/app/people); every other module uses its own name.
FRONTEND_PREFIX = {"payroll": "/people"}


def frontend_prefix(name: str) -> str:
    return FRONTEND_PREFIX.get(name, f"/{name}")


def staff_may_open(module: Module) -> bool:
    """Whether the Staff preset unlocks ``module`` (a role-only entry admitting staff, or a
    permission the preset switches on)."""
    access = preset_for("staff")
    return any(item.visible_to("staff", access) for item in module.nav)


def test_registry_shape():
    assert [m.name for m in MODULES] == [n for n in MODULE_NAMES if is_enabled(n)]
    assert [m.name for m in MODULES] == list(enabled_modules())
    assert [m.title for m in MODULES] == [TITLES[m.name] for m in MODULES]
    for module in MODULES:
        assert isinstance(module, Module)
        assert module.nav and all(isinstance(item, NavItem) for item in module.nav)
        prefix = frontend_prefix(module.name)
        assert all(item.path.startswith(prefix) for item in module.nav), module.name
    # Dashboard cards: Attendance today and Payments today only; admin contributes none.
    assert {m.name: len(m.dashboard_widgets) for m in MODULES} == {
        "attendance": 1,
        "payroll": 1,
        "admin": 0,
    }


def test_nav_visibility():
    item = NavItem("Overview", "/x", "box", {"admin", "manager"})
    assert item.visible_to("admin") and not item.visible_to("staff") and not item.visible_to(None)
    assert NavItem("All", "/x", "box", set()).visible_to("staff")
    assert Module("x", "X", MODULES[0].router, [item]).allowed("manager")
    assert not Module("x", "X", MODULES[0].router, [item]).allowed("staff")
    # A permission-gated entry follows the access map, whatever the role.
    gated = NavItem("Mark", "/attendance/mark", "check", permission="mark_attendance")
    assert gated.visible_to("staff", {"mark_attendance": True})
    assert not gated.visible_to("manager", {"mark_attendance": False})
    assert not gated.visible_to("manager")


@pytest.mark.parametrize("module", MODULES, ids=[m.name for m in MODULES])
async def test_module_endpoint_for_admin(client, make_user, login, module):
    await make_user("admin")
    await login("admin")
    response = await client.get(f"/api/{module.name}")
    assert response.status_code == 200
    body = response.json()
    assert body["module"] == module.name and body["title"] == module.title
    assert body["status"] in ("coming_soon", "ready")


@pytest.mark.parametrize("module", MODULES, ids=[m.name for m in MODULES])
async def test_module_endpoint_is_access_guarded(client, make_user, login, module):
    """A module's index answers exactly the users who can see one of its sidebar entries:
    the Staff preset opens attendance (mark_attendance) and nothing else."""
    await make_user("clerk", role=Role.staff)
    await login("clerk")
    response = await client.get(f"/api/{module.name}")
    allowed = staff_may_open(module)
    assert allowed == (module.name == "attendance")
    assert response.status_code == (200 if allowed else 403)
    if not allowed:
        assert response.json()["detail"]


@pytest.mark.parametrize("module", MODULES, ids=[m.name for m in MODULES])
async def test_module_endpoint_requires_login(client, module):
    response = await client.get(f"/api/{module.name}")
    assert response.status_code == 401
    assert response.json() == {"detail": "login required"}
