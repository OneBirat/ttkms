"""Payment reports tiles: the BS month of the range's To date. The running month is earned so far
(the Pay salary dialog's figure), completed months are whole; voided payments never count; the
Excel and PDF summaries describe the same month with the same figures."""

from datetime import date
from io import BytesIO

import pytest
from openpyxl import load_workbook

from app.core import bsdate
from app.core.models import Branch, Department, Employee
from app.modules.payroll import exports
from app.modules.payroll.models import PayType, SalaryHistory
from tests.attendance_days import attend_kept

pytestmark = pytest.mark.anyio

TODAY = bsdate.today_bs()
CURRENT = (TODAY.year, TODAY.month)
PREVIOUS = bsdate.shift_month(*CURRENT, -1)
NEXT = bsdate.shift_month(*CURRENT, 1)
PREVIOUS_FIRST = bsdate.BSDate(PREVIOUS[0], PREVIOUS[1], 1).isoformat()
PREVIOUS_DAY = bsdate.BSDate(PREVIOUS[0], PREVIOUS[1], 20).isoformat()
#: The screen's default range ends today; one ending last month; one ending next month.
TO_TODAY = {"from": PREVIOUS_FIRST, "to": TODAY.isoformat()}
TO_PREVIOUS = {"from": PREVIOUS_FIRST, "to": PREVIOUS_DAY}
TO_NEXT = {"from": PREVIOUS_FIRST, "to": bsdate.BSDate(NEXT[0], NEXT[1], 5).isoformat()}


async def _start(client, db, make_user, login):
    branch, dept = Branch(name="Main branch"), Department(name="Store")
    db.add_all([branch, dept])
    await db.flush()
    anita = Employee(
        full_name="Anita", branch_id=branch.id, department_id=dept.id, joined_ad=date(2026, 1, 1)
    )
    db.add(anita)
    await db.flush()
    db.add(
        SalaryHistory(
            employee_id=anita.id,
            pay_type=PayType.monthly,
            basic=30000,
            ot_rate=125,
            default_payment_mode_id=1,
            effective_ad=date(2026, 1, 1),
        )
    )
    await db.flush()
    await attend_kept(db, anita)
    await make_user("admin", role="admin")
    await login("admin")
    headers = {"X-CSRF-Token": (await client.get("/api/auth/csrf")).json()["csrf_token"]}
    # Present today: something is earned so far even on the 1st of the month (about one day's
    # pay, Rs 1,000 - the running month's payments below stay under it).
    marked = await client.post(
        "/api/attendance/mark",
        json={"date_bs": TODAY.isoformat(), "employee_id": anita.id, "status": "P"},
        headers=headers,
    )
    assert marked.status_code == 200, marked.text
    return anita, headers


async def _pay(client, headers, anita, kind, amount, month):
    response = await client.post(
        "/api/payroll/payments",
        json={
            "employee_id": anita.id,
            "kind": kind,
            "amount": amount,
            "for_year": month[0],
            "for_month": month[1],
            "source": "account",
        },
        headers=headers,
    )
    assert response.status_code == 201, response.text
    return response.json()["payment"]


async def _void(client, headers, payment):
    response = await client.post(
        f"/api/payroll/payments/{payment['id']}/void", json={"reason": "Test"}, headers=headers
    )
    assert response.status_code == 200, response.text


async def _balance(client, anita, month):
    """What the Pay salary dialog shows for the month."""
    return (
        await client.get(
            "/api/payroll/balance",
            params={"employee_id": anita.id, "for_year": month[0], "for_month": month[1]},
        )
    ).json()


async def _totals(client, params=None):
    response = await client.get("/api/payroll/payments", params=params or {})
    assert response.status_code == 200, response.text
    return response.json()["totals"]


def _month(totals):
    return (totals["month"]["bs_year"], totals["month"]["bs_month"])


async def test_default_tiles_are_the_running_month_earned_so_far(client, db, make_user, login):
    anita, headers = await _start(client, db, make_user, login)
    # Last month is still unpaid: the tiles used to fall back to it. Not any more.
    await _pay(client, headers, anita, "salary", 4000, PREVIOUS)
    await _pay(client, headers, anita, "advance", 300, CURRENT)
    await _pay(client, headers, anita, "salary", 200, CURRENT)
    earned = (await _balance(client, anita, CURRENT))["earned"]
    assert 0 < earned <= 30000
    if TODAY.day <= 15:  # early or mid-month: so far, not the whole salary
        assert earned < 30000
    for params in (TO_TODAY, None, TO_NEXT):  # To = today, no To, To after the running month
        totals = await _totals(client, params)
        assert _month(totals) == CURRENT and totals["in_progress"] is True, params
        assert totals["staff"] == 1 and totals["month_net"] == earned
        assert (totals["salary_paid"], totals["advance_paid"]) == (200, 300)
        assert totals["due"] == earned - 200 - 300


async def test_a_range_ending_in_a_past_month_shows_that_month(client, db, make_user, login):
    anita, headers = await _start(client, db, make_user, login)
    await _pay(client, headers, anita, "salary", 4000, PREVIOUS)
    await _pay(client, headers, anita, "advance", 300, CURRENT)
    whole = await _balance(client, anita, PREVIOUS)
    totals = await _totals(client, TO_PREVIOUS)
    assert _month(totals) == PREVIOUS and totals["in_progress"] is False
    # A completed month stays as it was: the whole month's net, its own payments only.
    assert totals["month_net"] == whole["earned"]
    assert (totals["salary_paid"], totals["advance_paid"]) == (4000, 0)
    assert totals["due"] == whole["earned"] - 4000 == whole["due"]


async def test_voided_payments_are_left_out_of_the_tiles(client, db, make_user, login):
    anita, headers = await _start(client, db, make_user, login)
    await _pay(client, headers, anita, "advance", 300, CURRENT)
    wrong_advance = await _pay(client, headers, anita, "advance", 250, CURRENT)
    wrong_salary = await _pay(client, headers, anita, "salary", 150, CURRENT)
    old_wrong = await _pay(client, headers, anita, "salary", 2500, PREVIOUS)
    for payment in (wrong_advance, wrong_salary, old_wrong):
        await _void(client, headers, payment)
    earned = (await _balance(client, anita, CURRENT))["earned"]
    for params in (TO_TODAY, {**TO_TODAY, "show_voided": "true"}):
        totals = await _totals(client, params)
        assert (totals["salary_paid"], totals["advance_paid"]) == (0, 300)
        assert totals["due"] == earned - 300
    past = await _totals(client, TO_PREVIOUS)
    assert past["salary_paid"] == 0 and past["due"] == past["month_net"]


async def test_exports_use_the_month_and_figures_of_the_tiles(
    client, db, make_user, login, monkeypatch
):
    anita, headers = await _start(client, db, make_user, login)
    await _pay(client, headers, anita, "salary", 4000, PREVIOUS)
    await _pay(client, headers, anita, "advance", 300, CURRENT)
    await _void(client, headers, await _pay(client, headers, anita, "advance", 250, CURRENT))
    seen = {}

    def fake_pdf(template, context, **kwargs):
        seen.update(context)
        return b"%PDF-test"

    monkeypatch.setattr(exports, "to_pdf", fake_pdf)
    for params, month, so_far in ((TO_TODAY, CURRENT, True), (TO_PREVIOUS, PREVIOUS, False)):
        totals = await _totals(client, params)
        assert _month(totals) == month
        label = exports.month_label(*month)

        xlsx = await client.get("/api/payroll/payments/export.xlsx", params=params)
        assert xlsx.status_code == 200, xlsx.text
        book = load_workbook(BytesIO(xlsx.content))
        summary = {row[0]: row[1:] for row in book["Summary"].iter_rows(values_only=True) if row[0]}
        assert f"Summary · {label}" in summary
        assert summary["Net payroll"][0] == totals["month_net"]
        assert ("earned so far" in summary["Net payroll"][1]) is so_far
        assert summary[f"Still due · {label}"][0] == totals["due"]
        by_employee = [
            row for row in book["By employee"].iter_rows(values_only=True) if "Anita" in row
        ]
        assert len(by_employee) == 1 and totals["month_net"] in by_employee[0]

        pdf = await client.get("/api/payroll/payments/export.pdf", params=params)
        assert pdf.status_code == 200, pdf.text
        stats = {name: (value, hint) for name, value, hint in seen["stats"]}
        assert seen["month"] == label
        assert stats["Net payroll"][0] == f"Rs {totals['month_net']:,}"
        assert label in stats["Net payroll"][1]
        assert ("earned so far" in stats["Net payroll"][1]) is so_far
        assert stats["Still due"] == (f"Rs {totals['due']:,}", f"for {label}")
        assert seen["data"].totals.month.bs_month == month[1]
