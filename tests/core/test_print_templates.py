"""The Jinja environment now exists only for PDF print templates."""

from datetime import UTC, date, datetime

from app.config import APP_DIR
from app.core import bsdate
from app.core.export import generated_at_text
from app.core.routes import DEMO_COLUMNS, DEMO_LEGEND, DEMO_ROWS, DEMO_TITLE
from app.core.templating import TEMPLATE_DIRS, bs_filter, bs_np_filter, env


def test_module_template_dirs_are_on_the_search_path():
    assert TEMPLATE_DIRS[0] == APP_DIR / "core" / "templates"
    assert APP_DIR / "modules" / "stock" / "templates" in TEMPLATE_DIRS


def test_generated_at_text_uses_kathmandu_time():
    assert generated_at_text(datetime(2026, 10, 20, 10, 35, tzinfo=UTC)) == "20 Oct 2026, 16:20"


def test_export_demo_template_renders_with_nepali_text():
    html = env.get_template("print/export_demo.html").render(
        title=DEMO_TITLE,
        company="TTK",
        subtitle="all branches",
        printed_by="Site Admin",
        printed_at=bsdate.header_date(date(2026, 10, 20)),
        generated_at="20 Oct 2026, 16:20",
        legend=DEMO_LEGEND,
        legend_text="",
        columns=DEMO_COLUMNS,
        rows=DEMO_ROWS,
        landscape=False,
    )
    assert "प्रेसर कुकर" in html and "नेपाली पाठ" in html
    assert 'class="pill pill--danger"' in html and ">Out<" in html
    assert "Generated 20 Oct 2026, 16:20 by Site Admin" in html
    assert "TTK · all branches" in html
    assert "२०८३-०७-०२" in html  # |np_digits on the BS date column
    assert 'class="print-header"' in html and 'class="print-footer"' in html
    assert 'class="print-footer__page"' in html  # page numbers come from print.css counters
    if bsdate.is_available():
        assert "मंगलबार" in html  # Nepali weekday in the header once the table is ported


def test_bs_filters():
    assert bs_filter(None) == "" and bs_np_filter("") == ""
    out = bs_filter(date(2026, 10, 20))
    if bsdate.is_available():
        assert out == "2083-07-04"
        assert bs_np_filter(date(2026, 10, 20)) == "२०८३-०७-०४"
    else:
        assert out == "2026-10-20 AD"
    assert env.from_string("{{ 2083|np_digits }}").render() == "२०८३"
