import pytest

from app.core.models import Role
from app.core.modules import MODULE_NAMES, Module, NavItem
from app.main import MODULES

pytestmark = pytest.mark.anyio

HTML = {"Accept": "text/html"}


def test_registry_shape():
    assert [m.name for m in MODULES] == list(MODULE_NAMES)
    assert [m.title for m in MODULES] == ["Stock", "Attendance", "People & payroll", "Admin"]
    for module in MODULES:
        assert isinstance(module, Module)
        assert module.nav and all(isinstance(item, NavItem) for item in module.nav)
        assert all(item.path.startswith(f"/{module.name}") for item in module.nav)
        assert module.dashboard_widgets, "stub modules expose a Coming-soon widget"


def test_nav_visibility():
    item = NavItem("Overview", "/stock", "box", {"admin", "manager"})
    assert item.visible_to("admin") and not item.visible_to("staff") and not item.visible_to(None)
    assert NavItem("All", "/x", "box", set()).visible_to("staff")


@pytest.mark.parametrize("module", MODULES, ids=[m.name for m in MODULES])
async def test_placeholder_page_for_admin(client, make_user, login, module):
    await make_user("admin")
    await login("admin")
    response = await client.get(f"/{module.name}")
    assert response.status_code == 200
    assert "Coming soon" in response.text
    assert module.title.replace("&", "&amp;") in response.text


@pytest.mark.parametrize("module", MODULES, ids=[m.name for m in MODULES])
async def test_placeholder_page_is_role_guarded(client, make_user, login, module):
    await make_user("clerk", role=Role.staff)
    await login("clerk")
    response = await client.get(f"/{module.name}", headers=HTML)
    allowed = "staff" in module.nav[0].roles
    assert response.status_code == (200 if allowed else 403)


@pytest.mark.parametrize("module", MODULES, ids=[m.name for m in MODULES])
async def test_placeholder_page_requires_login(client, module):
    response = await client.get(f"/{module.name}")
    assert response.status_code == 303
    assert response.headers["location"].startswith("/login")
