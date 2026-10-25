"""Code 128 encoding, the barcode employee list and the sticker PDF."""

import pytest

from app.core.models import Branch, Department, Employee
from app.modules.admin.barcodes import (
    STICKER_SIZES,
    code128_bars,
    code128_values,
    sticker_text,
)

pytestmark = pytest.mark.anyio


def test_code128_values_match_a_known_encoding():
    # "TTK-E-001": start B (104), chars - 32, checksum, stop (106).
    values = code128_values("TTK-E-001")
    chars = [ord(c) - 32 for c in "TTK-E-001"]
    assert values[0] == 104 and values[1:-2] == chars and values[-1] == 106
    checksum = (104 + sum(v * i for i, v in enumerate(chars, start=1))) % 103
    assert values[-2] == checksum
    with pytest.raises(ValueError):
        code128_values("नाम")
    with pytest.raises(ValueError):
        code128_values("")


def test_code128_bars_geometry():
    code = code128_bars("TTK-E-001")
    # Each symbol is 11 modules wide, the stop symbol 13, plus two quiet zones of 10.
    symbols = len(code128_values("TTK-E-001"))
    assert code.width == 10 + 11 * (symbols - 1) + 13 + 10
    assert code.bars[0].x == 10 and all(b.width in (1, 2, 3, 4) for b in code.bars)
    # Bars never overlap and the last one ends before the right quiet zone.
    last = 0
    for bar in code.bars:
        assert bar.x >= last
        last = bar.x + bar.width
    assert last == code.width - 10
    assert sticker_text("E-007") == "TTK-E007"
    assert [s.per_page for s in STICKER_SIZES.values()] == [24, 10, 40]


async def _employees(db) -> list[Employee]:
    branch = Branch(name="Main branch")
    store = Department(name="Store")
    db.add_all([branch, store])
    await db.flush()
    rows = [
        Employee(
            full_name="Sita Thapa",
            branch_id=branch.id,
            department_id=store.id,
            designation="Cashier",
        ),
        Employee(full_name="Anita Gurung", branch_id=branch.id, designation="Store keeper"),
        Employee(full_name="Gone Person", branch_id=branch.id, status="inactive"),
    ]
    db.add_all(rows)
    await db.flush()
    return rows


async def test_barcode_employees_endpoint(client, make_user, login, db):
    await make_user("admin")
    rows = await _employees(db)
    await login("admin")
    body = (await client.get("/api/admin/barcodes")).json()
    assert [e["full_name"] for e in body["employees"]] == ["Anita Gurung", "Sita Thapa"]
    sita = body["employees"][1]
    assert sita["department"] == "Store" and sita["designation"] == "Cashier"
    assert (
        sita["branch"] == "Main branch"
        and sita["barcode"] == f"TTK-{rows[0].code.replace('-', '')}"
    )
    assert [s["key"] for s in body["sizes"]] == ["3x8", "2x5", "4x10"]
    assert isinstance(body["pdf_available"], bool)


async def test_barcodes_are_admin_only(client, make_user, login):
    await make_user("boss", role="manager")
    await login("boss")
    assert (await client.get("/api/admin/barcodes")).status_code == 403
    assert (await client.get("/api/admin/barcodes.pdf?ids=1")).status_code == 403


async def test_sticker_pdf_endpoint(client, make_user, login, db):
    await make_user("admin")
    rows = await _employees(db)
    await login("admin")
    assert (await client.get("/api/admin/barcodes.pdf?ids=&size=3x8")).status_code == 422
    assert (await client.get("/api/admin/barcodes.pdf?ids=1&size=9x9")).status_code == 422
    assert (await client.get("/api/admin/barcodes.pdf?ids=x")).status_code == 422
    response = await client.get(f"/api/admin/barcodes.pdf?ids={rows[0].id},{rows[1].id}&size=2x5")
    if response.status_code == 503:
        pytest.skip(f"PDF unavailable: {response.json()['detail']}")
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("application/pdf")
    assert response.content.startswith(b"%PDF")


def test_sticker_template_renders_bars():
    from app.core import bsdate
    from app.core.templating import env

    html = env.get_template("admin/barcodes.html").render(
        title="Employee barcodes",
        subtitle="2 stickers",
        company="TTK",
        printed_by="Admin",
        printed_at=bsdate.header_date(),
        generated_at="now",
        legend=[],
        legend_text="legend",
        landscape=False,
        size=STICKER_SIZES["3x8"],
        stickers=[
            {"name": "Sita Thapa", "code": "E-001", "barcode": code128_bars("TTK-E-001")},
        ],
    )
    assert "grid-template-columns: repeat(3, 1fr)" in html
    assert "TTK-E-001" in html and html.count("<rect") > 20 and "Sita Thapa" in html
