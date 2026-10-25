"""Employee barcode stickers (design/final/AdminBarcodes.dc.html).

Each sticker carries the employee's ``barcode`` (``core.employees.barcode``, "TTK-E001" - the
code without its dash, one format everywhere) as a Code 128 (code set B) barcode; scanning it on
Mark attendance marks the employee present / overtime. Stickers printed before 2026-10-26 read
"TTK-E-001"; the by-barcode lookups still accept that form. :func:`code128_bars` is the twin of
``web/components/admin/code128.ts`` (the preview draws the same bars in the browser);
:func:`sticker_pdf` lays the selected stickers out on A4 through the shared print pipeline.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any

from app.core.export import to_pdf

# Code 128 patterns (bar/space widths) for values 0-106; 106 is the stop pattern.
_PATTERNS = (
    "212222 222122 222221 121223 121322 131222 122213 122312 132212 221213 221312 231212 "
    "112232 122132 122231 113222 123122 123221 223211 221132 221231 213212 223112 312131 "
    "311222 321122 321221 312212 322112 322211 212123 212321 232121 111323 131123 131321 "
    "112313 132113 132311 211313 231113 231311 112133 112331 132131 113123 113321 133121 "
    "313121 211331 231131 213113 213311 213131 311123 311321 331121 312113 312311 332111 "
    "314111 221411 431111 111224 111422 121124 121421 141122 141221 112214 112412 122114 "
    "122411 142112 142211 241211 221114 413111 241112 134111 111242 121142 121241 114212 "
    "124112 124211 411212 421112 421211 212141 214121 412121 111143 111341 131141 114113 "
    "114311 411113 411311 113141 114131 311141 411131 211412 211214 211232 2331112"
).split()
START_B = 104
STOP = 106
QUIET_ZONE = 10


@dataclass(frozen=True)
class Bar:
    x: int
    width: int


@dataclass(frozen=True)
class Barcode:
    text: str
    bars: tuple[Bar, ...]
    width: int


def code128_values(text: str) -> list[int]:
    """Start B, the characters, the checksum and the stop value."""
    if not text or any(not 32 <= ord(ch) <= 126 for ch in text):
        raise ValueError("Code 128 B needs printable ASCII")
    values = [START_B]
    checksum = START_B
    for position, ch in enumerate(text, start=1):
        value = ord(ch) - 32
        values.append(value)
        checksum += value * position
    values.append(checksum % 103)
    values.append(STOP)
    return values


def code128_bars(text: str) -> Barcode:
    bars: list[Bar] = []
    x = QUIET_ZONE
    for value in code128_values(text):
        for index, digit in enumerate(_PATTERNS[value]):
            width = int(digit)
            if index % 2 == 0:
                bars.append(Bar(x, width))
            x += width
    return Barcode(text=text, bars=tuple(bars), width=x + QUIET_ZONE)


def sticker_text(employee_code: str) -> str:
    """``"E-007"`` -> ``"TTK-E007"``, the same expression as the generated ``barcode`` column."""
    return f"TTK-{employee_code.replace('-', '')}"


@dataclass(frozen=True)
class StickerSize:
    key: str
    label: str
    columns: int
    rows: int
    bar_height_mm: float

    @property
    def per_page(self) -> int:
        return self.columns * self.rows


STICKER_SIZES: dict[str, StickerSize] = {
    "3x8": StickerSize("3x8", "3 × 8 · 24 per page", 3, 8, 12),
    "2x5": StickerSize("2x5", "2 × 5 · 10 per page (large)", 2, 5, 20),
    "4x10": StickerSize("4x10", "4 × 10 · 40 per page (small)", 4, 10, 9),
}
DEFAULT_SIZE = "3x8"


def sticker_pdf(
    employees: Sequence[Any], size: StickerSize, *, company: str, printed_by: str
) -> bytes:
    """A4 sheet(s) of stickers; ``employees`` need ``code`` and ``full_name``."""
    stickers = [
        {
            "name": employee.full_name,
            "code": employee.code,
            "barcode": code128_bars(sticker_text(employee.code)),
        }
        for employee in employees
    ]
    context = {
        "title": "Employee barcodes",
        "subtitle": f"{len(stickers)} sticker{'' if len(stickers) == 1 else 's'} · {size.label}",
        "company": company,
        "printed_by": printed_by,
        "legend_text": "Scan on Mark attendance · TTK-<employee ID> · Code 128",
        "size": size,
        "stickers": stickers,
    }
    return to_pdf("admin/barcodes.html", context)
