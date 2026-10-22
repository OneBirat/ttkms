from datetime import date

from app.config import APP_DIR
from app.core import bsdate
from app.core.templating import TEMPLATE_DIRS, bs_filter, bs_np_filter, env


def render(source: str, **context) -> str:
    return env.from_string(source).render(**context)


def test_module_template_dirs_are_on_the_search_path():
    assert TEMPLATE_DIRS[0] == APP_DIR / "core" / "templates"
    assert APP_DIR / "modules" / "stock" / "templates" in TEMPLATE_DIRS


def test_pill_macro_maps_status_to_tone():
    out = render('{% from "macros/ui.html" import pill %}{{ pill("low") }}{{ pill("weekly_off") }}')
    assert 'class="pill pill--low"' in out and ">Low<" in out
    assert 'class="pill pill--neutral"' in out and ">Weekly off<" in out
    assert "pill--ok" in render('{% from "macros/ui.html" import pill %}{{ pill("active", "On") }}')


def test_data_table_macro():
    out = render(
        '{% from "macros/ui.html" import data_table %}'
        "{{ data_table(columns, rows, compact=True) }}",
        columns=[{"key": "name", "label": "Item"}, {"key": "qty", "label": "Qty", "num": True},
                 {"key": "status", "label": "Status", "pill": True}],
        rows=[{"name": "Cooker", "qty": 3, "status": "ok"}],
    )  # fmt: skip
    assert 'class="table-scroll"' in out
    assert "table--compact" in out
    assert '<th scope="col" class="num">Qty</th>' in out
    assert "pill--ok" in out and "Cooker" in out

    empty = render(
        '{% from "macros/ui.html" import data_table %}{{ data_table(columns, []) }}',
        columns=[{"key": "a", "label": "A"}],
    )
    assert "No records yet." in empty


def test_segmented_and_modal_macros():
    out = render(
        '{% from "macros/ui.html" import segmented %}'
        '{{ segmented([("d", "Day"), ("m", "Month")], "m") }}'
    )
    assert 'aria-pressed="true"' in out and 'aria-pressed="false"' in out
    assert out.count("<button") == 2 and 'type="button"' in out

    modal = render(
        '{% from "macros/ui.html" import modal %}{% call modal("Edit item") %}<p>x</p>{% endcall %}'
    )
    assert 'role="dialog"' in modal and 'aria-modal="true"' in modal
    assert "modal-backdrop" in modal and "data-modal-close" in modal and "<p>x</p>" in modal


def test_other_macros_render():
    out = render(
        '{% from "macros/ui.html" import page_header, stat_card, empty_state, pagination, '
        "bs_date_input %}"
        '{{ page_header("Title", "Sub") }}{{ stat_card("Users", 4, "core.users", "ok") }}'
        '{{ empty_state("Nothing", "yet") }}{{ pagination(2, 5, "/x?q=1") }}'
        '{{ bs_date_input("from", "2083-07-04") }}'
    )
    assert '<h1 class="page-title">Title</h1>' in out and "Sub" in out
    assert "stat-card--ok" in out and ">4<" in out
    assert "Nothing" in out
    assert 'href="/x?q=1&amp;page=3"' in out and 'href="/x?q=1&amp;page=1"' in out
    assert 'name="from"' in out and 'value="2083-07-04"' in out and "data-bs-date" in out


def test_bs_filters():
    assert bs_filter(None) == "" and bs_np_filter("") == ""
    out = bs_filter(date(2026, 10, 20))
    if bsdate.is_available():
        assert out == "2083-07-04"
        assert bs_np_filter(date(2026, 10, 20)) == "२०८३-०७-०४"
    else:
        assert out == "2026-10-20 AD"
    assert render("{{ 2083|np_digits }}") == "२०८३"
