"""/api/admin/payment-modes: Cash seeded and locked, admin CRUD, on/off, payroll read."""

import pytest
from sqlalchemy import select

from app.core.models import AuditLog

pytestmark = pytest.mark.anyio


async def _csrf(client) -> str:
    return (await client.get("/api/auth/csrf")).json()["csrf_token"]


async def _post(client, path, json=None):
    return await client.post(path, json=json, headers={"X-CSRF-Token": await _csrf(client)})


async def _put(client, path, json):
    return await client.put(path, json=json, headers={"X-CSRF-Token": await _csrf(client)})


BANK = {"type": "bank", "name": "NIC Asia Bank", "details": "A/c ··4410"}


async def test_cash_is_seeded_and_any_user_can_read_active_modes(client, make_user, login):
    await make_user("clerk", role="staff")
    await login("clerk")
    modes = (await client.get("/api/admin/payment-modes?active=1")).json()
    assert [m["name"] for m in modes] == ["Cash"]
    cash = modes[0]
    assert cash["id"] == 1 and cash["type"] == "cash" and cash["is_builtin"] is True
    assert cash["use_salary"] and cash["use_advance"] and cash["active"]
    assert cash["payment_count"] == 0 and cash["details"] is None
    # Writing is admin-only.
    assert (await _post(client, "/api/admin/payment-modes", BANK)).status_code == 403


async def test_admin_crud_and_toggle(client, make_user, login, db):
    await make_user("admin")
    await login("admin")
    created = await _post(client, "/api/admin/payment-modes", {**BANK, "use_salary": True})
    assert created.status_code == 201, created.text
    bank = created.json()
    assert bank["type"] == "bank" and bank["name"] == "NIC Asia Bank" and bank["active"]
    assert bank["id"] > 1 and bank["is_builtin"] is False

    wallet = await _post(
        client,
        "/api/admin/payment-modes",
        {
            "type": "wallet",
            "name": "  eSewa ",
            "details": "",
            "use_salary": False,
            "use_advance": True,
        },
    )
    assert wallet.status_code == 201
    assert wallet.json()["name"] == "eSewa" and wallet.json()["details"] is None

    # Names are unique ignoring case and spaces.
    dup = await _post(client, "/api/admin/payment-modes", {**BANK, "name": "nic  asia BANK"})
    assert dup.status_code == 409
    assert dup.json()["detail"] == "A payment mode with this name already exists."
    # At least one use, type must be editable (not cash).
    none = await _post(
        client,
        "/api/admin/payment-modes",
        {"type": "qr", "name": "Fonepay", "use_salary": False, "use_advance": False},
    )
    assert none.status_code == 422
    assert (
        await _post(client, "/api/admin/payment-modes", {**BANK, "type": "cash", "name": "X"})
    ).status_code == 422

    # Edit reuses the same payload; the list orders Cash first.
    edited = await _put(
        client,
        f"/api/admin/payment-modes/{bank['id']}",
        {**BANK, "name": "Global IME Bank", "use_advance": False},
    )
    assert edited.status_code == 200 and edited.json()["name"] == "Global IME Bank"
    assert edited.json()["use_advance"] is False
    names = [m["name"] for m in (await client.get("/api/admin/payment-modes")).json()]
    assert names == ["Cash", "Global IME Bank", "eSewa"]

    # Off hides it from the active list; on brings it back.
    off = await _post(client, f"/api/admin/payment-modes/{bank['id']}/active", {"active": False})
    assert off.status_code == 200 and off.json()["active"] is False
    active = [m["name"] for m in (await client.get("/api/admin/payment-modes?active=1")).json()]
    assert active == ["Cash", "eSewa"]
    on = await _post(client, f"/api/admin/payment-modes/{bank['id']}/active", {"active": True})
    assert on.json()["active"] is True

    actions = (
        (
            await db.execute(
                select(AuditLog.action)
                .where(AuditLog.entity == "payment_mode")
                .order_by(AuditLog.id)
            )
        )
        .scalars()
        .all()
    )
    assert actions == ["create", "create", "update", "deactivate", "activate"]
    row = await db.scalar(select(AuditLog).where(AuditLog.action == "update"))
    assert row.data["before"]["name"] == "NIC Asia Bank"
    assert row.data["after"]["name"] == "Global IME Bank"

    assert (await _put(client, "/api/admin/payment-modes/999", BANK)).status_code == 404


async def test_cash_cannot_be_edited_or_turned_off(client, make_user, login):
    await make_user("admin")
    await login("admin")
    edit = await _put(client, "/api/admin/payment-modes/1", {**BANK, "name": "Cash money"})
    assert (
        edit.status_code == 409
        and edit.json()["detail"] == "Cash is built in and cannot be changed."
    )
    off = await _post(client, "/api/admin/payment-modes/1/active", {"active": False})
    assert off.status_code == 409 and off.json()["detail"] == "Cash is always on."
    # Turning it "on" is a harmless no-op.
    assert (
        await _post(client, "/api/admin/payment-modes/1/active", {"active": True})
    ).status_code == 200


async def test_nav_lists_payment_modes(client, make_user, login):
    await make_user("admin")
    await login("admin")
    registry = (await client.get("/api/registry")).json()
    admin = next(m for m in registry["modules"] if m["name"] == "admin")
    assert "/admin/payment-modes" in [item["path"] for item in admin["nav"]]
