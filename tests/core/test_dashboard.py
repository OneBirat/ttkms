import re

import pytest

from app.core import bsdate
from app.core.models import Role
from app.main import MODULES

pytestmark = pytest.mark.anyio


async def test_dashboard_shell_for_admin(client, make_user, login):
    await make_user("admin", full_name="Site Admin")
    await login("admin")
    page = await client.get("/")
    assert page.status_code == 200
    html = page.text

    # sidebar: brand block and every module section, in order
    assert "TTK Stock" in html and "Stock &amp; attendance" in html
    positions = [html.index(f'data-module="{m.name}"') for m in MODULES]
    assert positions == sorted(positions)
    for title in ("Stock", "Attendance", "People &amp; payroll", "Admin"):
        assert title in html
    for m in MODULES:
        assert f'href="/{m.name}"' in html

    # stat-card row and one "Coming soon" widget per module
    assert len(re.findall(r'class="stat-card[ "]', html)) == 4
    assert html.count("Coming soon") >= len(MODULES)

    # header date
    today = bsdate.header_date()
    assert today.ad in html
    if today.available:
        assert today.np in html and today.bs_en in html
    else:
        assert "BS calendar not installed" in html


async def test_sidebar_hides_sections_the_role_cannot_open(client, make_user, login):
    await make_user("clerk", role=Role.staff)
    await login("clerk")
    html = (await client.get("/")).text
    assert 'href="/attendance"' in html
    assert 'href="/admin"' not in html
    assert 'href="/payroll"' not in html
    assert 'href="/stock"' not in html


async def test_dashboard_requires_login(client):
    assert (await client.get("/")).status_code == 303


async def test_404_renders_html_page_for_browsers(client, make_user, login):
    await make_user("admin")
    await login("admin")
    response = await client.get("/nope", headers={"Accept": "text/html"})
    assert response.status_code == 404
    assert "Page not found" in response.text
    assert (await client.get("/nope")).json()["detail"] == "Not Found"
