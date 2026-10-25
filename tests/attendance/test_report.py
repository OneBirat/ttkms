"""The month report, one employee's month and the marked-day dots: cells (P / O / A / W / N),
totals, staff present per day, payment badges from payroll's contract, inactive and moved staff,
permissions (staff need view_attendance_report) and branch scoping."""

from datetime import datetime, timedelta

import pytest

from app.core import bsdate
from app.core.models import EmployeeStatus
from app.modules.attendance.models import Record
from app.modules.payroll.models import Payment, PaymentKind, PaymentSource

pytestmark = pytest.mark.anyio

TODAY = bsdate.today_bs()
PREVIOUS = bsdate.shift_month(TODAY.year, TODAY.month, -1)
START, END = bsdate.bs_month_range(*PREVIOUS)
DAYS = [START + timedelta(days=i) for i in range((END - START).days + 1)]
SATURDAYS = [d for d in DAYS if bsdate.weekday_index(d) == 6]
WORKDAYS = [d for d in DAYS if bsdate.weekday_index(d) != 6]


async def _as(client, login, user_in, name="boss", role="manager", branch=None, access=None):
    await user_in(name, role, branch, access)
    await login(name)


def _rec(employee, day, status="P", hours=0, branch_id=None):
    return Record(
        employee_id=employee.id,
        date=day,
        status=status,
        overtime_hours=hours,
        branch_id=branch_id or employee.branch_id,
        source="manual",
    )


async def _seed(db, world):
    anita, bikash = world.people["Anita"], world.people["Bikash"]
    db.add_all(
        [
            _rec(anita, WORKDAYS[0]),
            _rec(anita, WORKDAYS[1], "O", 3),
            _rec(anita, WORKDAYS[2], "A"),
            _rec(anita, SATURDAYS[0], "O", 5),
            _rec(bikash, WORKDAYS[0]),
            _rec(world.people["Old Hari"], WORKDAYS[0]),
        ]
    )
    db.add(
        Payment(
            receipt_no="ADV-9001",
            employee_id=anita.id,
            kind=PaymentKind.advance,
            for_year=PREVIOUS[0],
            for_month=PREVIOUS[1],
            amount=1500,
            payment_mode_id=1,
            date=WORKDAYS[1],
            source=PaymentSource.scan,
        )
    )
    await db.flush()


def _params(month=PREVIOUS, **extra):
    return {"bs_year": month[0], "bs_month": month[1], **extra}


async def test_month_report_cells_totals_and_badges(client, db, login, user_in, world):
    await _seed(db, world)
    await _as(client, login, user_in, branch=world.main)
    response = await client.get("/api/attendance/report", params=_params())
    assert response.status_code == 200, response.text
    report = response.json()
    month = report["month"]
    assert month["key"] == f"{PREVIOUS[0]:04d}-{PREVIOUS[1]:02d}"
    assert len(month["days"]) == len(DAYS) and month["working_days"] == len(WORKDAYS)
    assert month["label"] == f"{bsdate.bs_month_name(PREVIOUS[1])} {PREVIOUS[0]}"
    names = [r["employee"]["name"] for r in report["rows"]]
    # Department then name; the inactive Hari still shows in a past month; not the other branch.
    assert names == ["Bikash", "Anita", "Chandra", "Old Hari"]
    anita = next(r for r in report["rows"] if r["employee"]["name"] == "Anita")
    cells = {d["ad_date"]: c for d, c in zip(month["days"], anita["cells"], strict=True)}
    assert cells[WORKDAYS[0].isoformat()]["status"] == "P"
    assert cells[WORKDAYS[1].isoformat()] == {
        "status": "O",
        "ot_hours": 3,
        "advance": 1500,
        "salary": None,
    }
    assert cells[WORKDAYS[2].isoformat()]["status"] == "A"
    assert cells[SATURDAYS[0].isoformat()] == {
        "status": "O",
        "ot_hours": 5,
        "advance": None,
        "salary": None,
    }
    assert cells[SATURDAYS[1].isoformat()]["status"] == "W"
    assert cells[WORKDAYS[3].isoformat()]["status"] == "N"
    assert anita["totals"] == {
        "present": 1,
        "overtime_days": 2,
        "overtime_hours": 8,
        "absent": 1,
        "weekly_off": len(SATURDAYS) - 1,
        "not_marked": len(WORKDAYS) - 3,
        "marked_days": 4,
        "attended": 3,
        "paid_days": 3 + len(SATURDAYS) - 1,
        "saturday_days_worked": 1,
        "saturday_ot_hours": 5,
    }
    first = month["days"].index(next(d for d in month["days"] if d["ad_date"] == str(WORKDAYS[0])))
    assert report["staff_present"][first] == 3  # Anita, Bikash, Old Hari
    assert report["branch_id"] == world.main.id
    assert [b["name"] for b in report["branches"]] == ["Main branch"]


async def test_report_permissions(client, login, user_in, world):
    await _as(client, login, user_in, "clerk", "staff", world.main)
    assert (await client.get("/api/attendance/report", params=_params())).status_code == 403
    month = await client.get(
        f"/api/attendance/employees/{world.people['Anita'].id}/month", params=_params()
    )
    assert month.status_code == 200  # the phone calendar only needs mark_attendance


async def test_staff_with_the_report_switched_on(client, login, user_in, world):
    await _as(
        client,
        login,
        user_in,
        "clerk",
        "staff",
        world.main,
        {"mark_attendance": True, "view_attendance_report": True},
    )
    assert (await client.get("/api/attendance/report", params=_params())).status_code == 200


async def test_report_branch_scoping_and_moved_staff(client, db, login, user_in, world):
    mina = world.people["Mina"]
    db.add(_rec(mina, WORKDAYS[0], branch_id=world.main.id))  # worked in Main before moving
    db.add(_rec(mina, WORKDAYS[1]))
    await db.flush()
    await _as(client, login, user_in, branch=world.main)
    main = (
        await client.get("/api/attendance/report", params=_params(branch=world.second.id))
    ).json()
    assert main["branch_id"] == world.main.id  # a manager cannot pick another branch
    row = next(r for r in main["rows"] if r["employee"]["name"] == "Mina")
    assert [c["status"] for c in row["cells"]].count("P") == 1  # only the Main-branch day
    await client.post("/api/auth/logout")
    await _as(client, login, user_in, "chief", "admin")
    every = (await client.get("/api/attendance/report", params=_params())).json()
    assert every["branch_id"] is None
    assert {r["employee"]["name"] for r in every["rows"]} >= {"Anita", "Mina"}
    second = (
        await client.get("/api/attendance/report", params=_params(branch=world.second.id))
    ).json()
    assert [r["employee"]["name"] for r in second["rows"]] == ["Mina"]


async def test_inactive_staff_drop_out_after_they_left(client, db, login, user_in, world):
    hari = world.people["Old Hari"]
    hari.deactivated_at = datetime.combine(
        START - timedelta(days=3), datetime.min.time(), tzinfo=bsdate.KATHMANDU
    )
    hari.status = EmployeeStatus.inactive
    await db.flush()
    await _as(client, login, user_in, branch=world.main)
    report = (await client.get("/api/attendance/report", params=_params())).json()
    assert "Old Hari" not in [r["employee"]["name"] for r in report["rows"]]


async def test_future_months_and_running_month(client, login, user_in, world):
    await _as(client, login, user_in, branch=world.main)
    nxt = bsdate.shift_month(TODAY.year, TODAY.month, 1)
    assert (await client.get("/api/attendance/report", params=_params(nxt))).status_code == 404
    running = await client.get("/api/attendance/report", params=_params((TODAY.year, TODAY.month)))
    assert running.status_code == 200
    assert running.json()["today"] == bsdate.today_ad().isoformat()


async def test_employee_month_and_marked_days(client, db, login, user_in, world):
    await _seed(db, world)
    await _as(client, login, user_in, branch=world.main)
    anita = world.people["Anita"]
    month = (
        await client.get(f"/api/attendance/employees/{anita.id}/month", params=_params())
    ).json()
    assert month["employee"]["id"] == anita.id
    assert month["totals"]["overtime_hours"] == 8 and month["totals"]["absent"] == 1
    assert [(p["receipt_no"], p["amount"], p["kind"]) for p in month["payments"]] == [
        ("ADV-9001", 1500, "advance")
    ]
    hari = await client.get(
        f"/api/attendance/employees/{world.people['Old Hari'].id}/month", params=_params()
    )
    assert hari.status_code == 200  # inactive staff keep their history
    other = await client.get(
        f"/api/attendance/employees/{world.people['Mina'].id}/month", params=_params()
    )
    assert other.status_code == 403
    dots = (await client.get("/api/attendance/marked-days", params=_params())).json()
    assert dots["marked_days"] == sorted(
        {
            bsdate.ad_to_bs(d).isoformat()
            for d in (WORKDAYS[0], WORKDAYS[1], WORKDAYS[2], SATURDAYS[0])
        }
    )
    mine = (
        await client.get(
            "/api/attendance/marked-days", params=_params(employee_id=world.people["Bikash"].id)
        )
    ).json()
    assert mine["marked_days"] == [bsdate.ad_to_bs(WORKDAYS[0]).isoformat()]
