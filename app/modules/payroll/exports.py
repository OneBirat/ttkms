"""Excel and PDF files of the salary report (and, later, the payments register).

The workbook builder mirrors ``web/app/people/_lib/xlsx.ts``: a title row, a muted meta line, a
tinted header row with an autofilter, number cells that stay numbers (``#,##0``), formula cells
with a cached value, bold total rows, several sheets per file.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from io import BytesIO
from typing import Any, Literal

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

from app.core import bsdate
from app.core.export import generated_at_text, to_pdf
from app.modules.payroll import reports
from app.modules.payroll.reports import ReportData, month_label

StyleName = Literal[
    "normal", "bold", "title", "muted", "header", "header_dark", "number", "number_bold", "total"
]


@dataclass(frozen=True)
class Styled:
    value: Any = None
    style: StyleName = "normal"
    #: Excel formula without the leading "=", with ``value`` as the cached result.
    formula: str | None = None


Cell = Any  # plain value or Styled


@dataclass
class Sheet:
    name: str
    rows: list[list[Cell]]
    widths: Sequence[float] = ()
    auto_filter: str | None = None


_HEADER_FILL = PatternFill("solid", fgColor="E7F1EF")
_DARK_FILL = PatternFill("solid", fgColor="0A5454")
_TOTAL_FILL = PatternFill("solid", fgColor="F1F3F0")
_HEADER_BORDER = Border(bottom=Side(style="thin", color="0A5454"))
_MUTED = "5B6670"
NUMBER_FORMAT = "#,##0"


def _sheet_title(name: str) -> str:
    cleaned = "".join("-" if ch in "[]:*?/\\" else ch for ch in name).strip()
    return (cleaned or "Sheet")[:31]


def _apply(cell, style: StyleName) -> None:
    if style == "title":
        cell.font = Font(bold=True, size=13)
    elif style == "bold":
        cell.font = Font(bold=True)
    elif style == "muted":
        cell.font = Font(color=_MUTED)
    elif style == "header":
        cell.font = Font(bold=True)
        cell.fill = _HEADER_FILL
        cell.border = _HEADER_BORDER
    elif style == "header_dark":
        cell.font = Font(bold=True, color="FFFFFF")
        cell.fill = _DARK_FILL
    elif style == "number":
        cell.number_format = NUMBER_FORMAT
        cell.alignment = Alignment(horizontal="right")
    elif style == "number_bold":
        cell.number_format = NUMBER_FORMAT
        cell.font = Font(bold=True)
        cell.alignment = Alignment(horizontal="right")
    elif style == "total":
        cell.font = Font(bold=True)
        cell.fill = _TOTAL_FILL
        cell.number_format = NUMBER_FORMAT


def build_workbook(sheets: Sequence[Sheet]) -> bytes:
    wb = Workbook()
    wb.remove(wb.active)
    for sheet in sheets:
        ws = wb.create_sheet(_sheet_title(sheet.name))
        for r, row in enumerate(sheet.rows, start=1):
            for c, raw in enumerate(row, start=1):
                styled = raw if isinstance(raw, Styled) else Styled(raw)
                if styled.formula:
                    cell = ws.cell(row=r, column=c, value=f"={styled.formula}")
                elif styled.value is None or styled.value == "":
                    cell = ws.cell(row=r, column=c)
                else:
                    cell = ws.cell(row=r, column=c, value=styled.value)
                    if isinstance(styled.value, str) and cell.data_type == "f":
                        cell.data_type = "s"
                if styled.style != "normal":
                    _apply(cell, styled.style)
        for i, width in enumerate(sheet.widths, start=1):
            ws.column_dimensions[get_column_letter(i)].width = max(width, 4)
        if sheet.auto_filter:
            ws.auto_filter.ref = sheet.auto_filter
    buffer = BytesIO()
    wb.save(buffer)
    return buffer.getvalue()


def header(labels: Sequence[str], dark: bool = False) -> list[Cell]:
    return [Styled(label, "header_dark" if dark else "header") for label in labels]


def num(value: int) -> Styled:
    return Styled(value, "number")


def total(value: int, formula: str | None = None) -> Styled:
    return Styled(value, "total", formula)


STATUS_LABEL = {"paid": "Paid", "part_paid": "Part paid", "pending": "Pending"}


# ------------------------------------------------------------------------ salary report


def salary_report_sheets(data: ReportData) -> list[Sheet]:
    out = data.out
    rows = data.ledgers
    all_branches = out.branch is None
    month = month_label(out.month.bs_year, out.month.bs_month)
    scope_line = f"{out.branch.name if out.branch else 'All branches'}" + (
        f" · {out.department.name}" if out.department else ""
    )

    HEADER = 4
    first = HEADER + 1
    last = HEADER + max(1, len(rows))
    columns = ["Emp ID", "Name", "Department"] + (["Branch"] if all_branches else []) + [
        "Pay type", "Paid days", "Days", "Gross", "Overtime", "Absence", "Advance paid",
        "Salary paid", "TDS", "Net", "Paid", "Due", "Status",
    ]  # fmt: skip
    money_from = 3 + (1 if all_branches else 0) + 3  # 0-based index of "Gross"
    sheet_rows: list[list[Cell]] = [
        [Styled(f"TTK · {data.title}", "title")],
        [
            Styled(
                f"{len(rows)} staff · {scope_line} · net payroll Rs {out.totals.net:,}"
                f" · due Rs {out.totals.due:,}",
                "muted",
            )
        ],
        [],
        header(columns),
    ]
    for r in rows:
        e = r.employee
        line: list[Cell] = [e.code, e.full_name, e.department.name if e.department else ""]
        if all_branches:
            line.append(e.branch.name)
        line += [
            "Monthly" if r.structure.pay_type.value == "monthly" else "Daily wage",
            num(r.pay.paid_days),
            num(r.attendance.days_in_month),
            num(r.pay.earnings),
            num(r.pay.overtime_pay),
            num(r.pay.absence_deduction),
            num(r.settled.advance_paid),
            num(r.settled.salary_paid),
            num(r.pay.tds),
            Styled(r.pay.net, "number_bold"),
            num(r.settled.paid),
            Styled(r.settled.due, "number_bold"),
            STATUS_LABEL[r.settled.status],
        ]
        sheet_rows.append(line)
    if not rows:
        sheet_rows.append([Styled("Nobody on the sheet", "muted")])
    totals_line: list[Cell] = [Styled(f"Total · {len(rows)} staff", "total")] + [
        Styled(None, "total")
    ] * (money_from - 1)
    for offset, pick in enumerate(
        [
            lambda r: r.pay.earnings,
            lambda r: r.pay.overtime_pay,
            lambda r: r.pay.absence_deduction,
            lambda r: r.settled.advance_paid,
            lambda r: r.settled.salary_paid,
            lambda r: r.pay.tds,
            lambda r: r.pay.net,
            lambda r: r.settled.paid,
            lambda r: r.settled.due,
        ]
    ):
        col = get_column_letter(money_from + offset + 1)
        totals_line.append(total(sum(pick(r) for r in rows), f"SUM({col}{first}:{col}{last})"))
    totals_line.append(Styled(None, "total"))
    sheet_rows.append(totals_line)
    widths = (
        [9, 24, 14]
        + ([14] if all_branches else [])
        + [11, 9, 7, 11, 10, 10, 12, 11, 7, 11, 11, 11, 10]
    )
    payroll = Sheet(
        name="Payroll sheet",
        rows=sheet_rows,
        widths=widths,
        auto_filter=f"A{HEADER}:{get_column_letter(len(columns))}{last}",
    )

    dept_rows: list[list[Cell]] = [
        [Styled(f"By department · {month} · {scope_line}", "title")],
        header(["Department", "Staff", "Net payroll", "Paid", "Due"]),
    ]
    by_dept: dict[str, list[reports.ledgers.MonthLedger]] = {}
    for r in rows:
        by_dept.setdefault(
            r.employee.department.name if r.employee.department else "No department", []
        ).append(r)
    for name in sorted(by_dept):
        group = by_dept[name]
        dept_rows.append(
            [
                name,
                num(len(group)),
                num(sum(g.net for g in group)),
                num(sum(g.paid for g in group)),
                num(sum(g.due for g in group)),
            ]
        )
    d_first, d_last = 3, 2 + max(1, len(by_dept))
    dept_rows.append(
        [
            Styled("Total", "total"),
            total(len(rows), f"SUM(B{d_first}:B{d_last})"),
            total(out.totals.net, f"SUM(C{d_first}:C{d_last})"),
            total(out.totals.salary_paid + out.totals.advance_paid, f"SUM(D{d_first}:D{d_last})"),
            total(out.totals.due, f"SUM(E{d_first}:E{d_last})"),
        ]
    )
    by_department = Sheet(
        name="By department",
        rows=dept_rows,
        widths=[22, 8, 14, 14, 14],
        auto_filter=f"A2:E{d_last}",
    )

    sheets = [payroll]
    if all_branches:
        b_rows: list[list[Cell]] = [
            [
                Styled(
                    f"By branch · {month}"
                    + (f" · {out.department.name}" if out.department else ""),
                    "title",
                )
            ],
            header(["Branch", "Staff", "Net payroll", "Paid", "Due"]),
        ]
        for b in out.by_branch:
            b_rows.append([b.branch.name, num(b.staff), num(b.net), num(b.paid), num(b.due)])
        b_first, b_last = 3, 2 + max(1, len(out.by_branch))
        b_rows.append(
            [
                Styled("All branches", "total"),
                total(sum(b.staff for b in out.by_branch), f"SUM(B{b_first}:B{b_last})"),
                total(sum(b.net for b in out.by_branch), f"SUM(C{b_first}:C{b_last})"),
                total(sum(b.paid for b in out.by_branch), f"SUM(D{b_first}:D{b_last})"),
                total(sum(b.due for b in out.by_branch), f"SUM(E{b_first}:E{b_last})"),
            ]
        )
        sheets.append(
            Sheet(
                name="By branch",
                rows=b_rows,
                widths=[22, 8, 14, 14, 14],
                auto_filter=f"A2:E{b_last}",
            )
        )
    sheets.append(by_department)

    t = out.totals
    summary = Sheet(
        name="Summary",
        rows=[
            [Styled(f"Summary · {data.title}", "title")],
            ["Staff", num(t.staff)],
            [
                "Gross (incl. overtime)",
                num(t.gross),
                Styled(f"overtime Rs {t.overtime_pay:,} for {t.overtime_hours} h", "muted"),
            ],
            [
                "Absence deductions",
                num(t.absence_deduction),
                Styled(f"{t.absent_days} absent days", "muted"),
            ],
            ["TDS", num(t.tds), Styled("not applied yet", "muted")],
            [Styled("Net payable", "bold"), Styled(t.net, "number_bold")],
            [
                "Advances paid",
                num(t.advance_paid),
                Styled("part of the salary, already paid", "muted"),
            ],
            ["Salary paid", num(t.salary_paid)],
            [
                Styled("Still due", "bold"),
                Styled(t.due, "number_bold"),
                Styled(
                    f"{t.paid_count} paid · {t.part_paid_count} part paid"
                    f" · {t.pending_count} pending",
                    "muted",
                ),
            ],
            [],
            [
                Styled(
                    "Monthly: net = salary − salary ÷ days in month × absent days + overtime. "
                    "Daily: wage × days present + overtime. Saturdays are paid. No SSF; TDS 0 "
                    "for now.",
                    "muted",
                )
            ],
        ],
        widths=[26, 16, 60],
    )
    sheets.append(summary)
    return sheets


def salary_report_xlsx(data: ReportData) -> bytes:
    return build_workbook(salary_report_sheets(data))


def salary_report_pdf(data: ReportData, printed_by: str) -> bytes:
    out = data.out
    t = out.totals
    context = {
        "title": data.title,
        "subtitle": f"{len(data.ledgers)} staff · "
        f"{month_label(out.month.bs_year, out.month.bs_month)}",
        "printed_by": printed_by,
        "report": out,
        "rows": data.ledgers,
        "all_branches": out.branch is None,
        "status_label": STATUS_LABEL,
        "legend_text": (
            "Monthly: net = salary − salary ÷ days in month × absent days + overtime · "
            "Daily: wage × days present + overtime · Saturdays paid · no SSF · TDS 0"
        ),
        "stats": [
            ("Gross", f"Rs {t.gross:,}", f"{t.staff} staff · overtime Rs {t.overtime_pay:,}"),
            ("Absence", f"− Rs {t.absence_deduction:,}", f"{t.absent_days} absent days"),
            ("Advances paid", f"Rs {t.advance_paid:,}", "part of salary"),
            (
                "Net payable",
                f"Rs {t.net:,}",
                f"{t.paid_count} paid · {t.part_paid_count} part · {t.pending_count} pending",
            ),
            ("Still due", f"Rs {t.due:,}", month_label(out.month.bs_year, out.month.bs_month)),
        ],
        "generated_at": generated_at_text(),
        "month_np": bsdate.format_bs(
            bsdate.BSDate(out.month.bs_year, out.month.bs_month, 1), "%B %Y", "ne"
        ),
    }
    return to_pdf("payroll/report.html", context, landscape=True)
