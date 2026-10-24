"""The Jinja environment now exists only for PDF print templates."""

from datetime import UTC, date, datetime

from app.config import APP_DIR
from app.core import bsdate
from app.core.export import Column, generated_at_text
from app.core.templating import TEMPLATE_DIRS, bs_filter, bs_np_filter, env

#: Sample table for the generic print layout (print/export_demo.html).
COLUMNS = [
    Column("code", "Code"),
    Column("name", "Name"),
    Column("name_np", "नाम (नेपाली)"),
    Column("days", "Days", number_format="0"),
    Column("status", "Status"),
    Column("updated", "Updated (BS)"),
]
ROWS = [
    {"code": "E-001", "name": "Sita Thapa", "name_np": "सीता थापा", "days": 24,
     "status": "ok", "updated": "2083-07-02"},
    {"code": "E-002", "name": "Ramesh K.C.", "name_np": "रमेश के.सी.", "days": 3,
     "status": "low", "updated": "2083-07-01"},
    {"code": "E-003", "name": "Kiran Lama", "name_np": "किरण लामा", "days": 0,
     "status": "out", "updated": "2083-06-28"},
]  # fmt: skip
LEGEND = [("OK", "ok"), ("Low", "low"), ("Out", "danger")]


def test_module_template_dirs_are_on_the_search_path():
    assert TEMPLATE_DIRS[0] == APP_DIR / "core" / "templates"
    assert APP_DIR / "modules" / "admin" / "templates" in TEMPLATE_DIRS


def test_generated_at_text_uses_kathmandu_time():
    assert generated_at_text(datetime(2026, 10, 20, 10, 35, tzinfo=UTC)) == "20 Oct 2026, 16:20"


def test_print_table_template_renders_with_nepali_text():
    html = env.get_template("print/export_demo.html").render(
        title="Sample table",
        company="TTK",
        subtitle="all branches",
        printed_by="Site Admin",
        printed_at=bsdate.header_date(date(2026, 10, 20)),
        generated_at="20 Oct 2026, 16:20",
        legend=LEGEND,
        legend_text="",
        columns=COLUMNS,
        rows=ROWS,
        landscape=False,
    )
    assert "सीता थापा" in html and "नेपाली पाठ" in html
    assert 'class="pill pill--danger"' in html and ">Out<" in html
    assert "Generated 20 Oct 2026, 16:20 by Site Admin" in html
    assert "TTK · all branches" in html
    assert "२०८३-०७-०२" in html  # |np_digits on the BS date column
    assert 'class="print-header"' in html and 'class="print-footer"' in html
    assert 'class="print-footer__page"' in html  # page numbers come from print.css counters
    assert "मंगलबार" in html  # Nepali weekday in the header


def test_bs_filters():
    assert bs_filter(None) == "" and bs_np_filter("") == ""
    assert bs_filter(date(2026, 10, 20)) == "2083-07-03"
    assert bs_np_filter(date(2026, 10, 20)) == "२०८३-०७-०३"
    assert bs_filter(date(1900, 1, 1)) == "1900-01-01 AD"  # outside the table
    assert env.from_string("{{ 2083|np_digits }}").render() == "२०८३"
