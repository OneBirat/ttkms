"""The Jinja environment now exists only for PDF print templates."""

from datetime import date

from app.config import APP_DIR
from app.core import bsdate
from app.core.routes import DEMO_COLUMNS, DEMO_LEGEND, DEMO_ROWS, DEMO_TITLE
from app.core.templating import TEMPLATE_DIRS, bs_filter, bs_np_filter, env


def test_module_template_dirs_are_on_the_search_path():
    assert TEMPLATE_DIRS[0] == APP_DIR / "core" / "templates"
    assert APP_DIR / "modules" / "stock" / "templates" in TEMPLATE_DIRS


def test_export_demo_template_renders_with_nepali_text():
    html = env.get_template("print/export_demo.html").render(
        title=DEMO_TITLE,
        company="TTK",
        printed_by="Site Admin",
        printed_at=bsdate.header_date(date(2026, 10, 20)),
        legend=DEMO_LEGEND,
        columns=DEMO_COLUMNS,
        rows=DEMO_ROWS,
        landscape=False,
    )
    assert "प्रेसर कुकर" in html and "नेपाली पाठ" in html
    assert 'class="pill pill--danger"' in html and ">Out<" in html
    assert "Printed by Site Admin" in html and "Tue 20 Oct 2026" in html
    assert "२०८३-०७-०२" in html  # |np_digits on the BS date column
    assert 'class="print-header"' in html and 'class="print-legend"' in html


def test_bs_filters():
    assert bs_filter(None) == "" and bs_np_filter("") == ""
    out = bs_filter(date(2026, 10, 20))
    if bsdate.is_available():
        assert out == "2083-07-04"
        assert bs_np_filter(date(2026, 10, 20)) == "२०८३-०७-०४"
    else:
        assert out == "2026-10-20 AD"
    assert env.from_string("{{ 2083|np_digits }}").render() == "२०८३"
