"""Export the Bikram Sambat calendar table to web/lib/bs/calendar-data.json.

    python scripts/gen_bs_calendar.py            # writes web/lib/bs/calendar-data.json
    python scripts/gen_bs_calendar.py --check    # exit 1 when the file is out of date

Source of truth: the Python package ``nepali-datetime`` (pinned in requirements.txt). BS month
lengths come from a published table and cannot be calculated, so this script copies, for every
BS year the package supports, the 12 month lengths and the AD date of 1 Baisakh. The backend
(app/core/bsdate.py) and the frontend (web/lib/bs) both read only that JSON, so they can never
disagree. Official corrections go into web/lib/bs/calendar-overrides.json, never into this file.
See docs/bs-calendar.md.
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import timedelta
from importlib.metadata import version
from pathlib import Path

import nepali_datetime

ROOT = Path(__file__).resolve().parent.parent
OUTPUT = ROOT / "web" / "lib" / "bs" / "calendar-data.json"
REQUIRED_RANGE = (2070, 2100)


def build_table() -> dict:
    years: dict[str, dict] = {}
    first_year, last_year = nepali_datetime.MINYEAR, nepali_datetime.MAXYEAR
    for year in range(first_year, last_year + 1):
        new_year = nepali_datetime.date(year, 1, 1).to_datetime_date()
        months = [nepali_datetime._days_in_month(year, month) for month in range(1, 13)]
        if year < last_year:
            next_new_year = nepali_datetime.date(year + 1, 1, 1).to_datetime_date()
            if new_year + timedelta(days=sum(months)) != next_new_year:
                raise SystemExit(f"package table inconsistent at BS {year}")
        years[str(year)] = {"months": months, "new_year_ad": new_year.isoformat()}
    lo, hi = REQUIRED_RANGE
    if first_year > lo or last_year < hi:
        raise SystemExit(f"package covers BS {first_year}-{last_year}, need {lo}-{hi}")
    return {
        "source": {
            "package": "nepali-datetime",
            "version": version("nepali-datetime"),
            "generator": "scripts/gen_bs_calendar.py",
            "note": "GENERATED - do not edit. Corrections go to calendar-overrides.json.",
        },
        "first_year": first_year,
        "last_year": last_year,
        "years": years,
    }


def render(table: dict) -> str:
    # One year per line so diffs stay readable.
    lines = ["{", f'  "source": {json.dumps(table["source"], ensure_ascii=False)},']
    lines.append(f'  "first_year": {table["first_year"]},')
    lines.append(f'  "last_year": {table["last_year"]},')
    lines.append('  "years": {')
    items = list(table["years"].items())
    for index, (year, entry) in enumerate(items):
        comma = "," if index < len(items) - 1 else ""
        lines.append(f'    "{year}": {json.dumps(entry, separators=(", ", ": "))}{comma}')
    lines.append("  }")
    lines.append("}")
    return "\n".join(lines) + "\n"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("-o", "--output", type=Path, default=OUTPUT)
    parser.add_argument("--check", action="store_true", help="only verify the file is current")
    args = parser.parse_args(argv)
    text = render(build_table())
    if args.check:
        current = args.output.read_text() if args.output.exists() else ""
        if current != text:
            print(f"{args.output} is out of date: run python scripts/gen_bs_calendar.py")
            return 1
        print(f"{args.output} is current")
        return 0
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(text)
    table = json.loads(text)
    years = f"BS {table['first_year']}-{table['last_year']}"
    print(f"wrote {args.output}: {years} from nepali-datetime {table['source']['version']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
