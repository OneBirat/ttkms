# Bikram Sambat calendar

TTK shows dates in Bikram Sambat (BS) first and AD second. BS month lengths follow a published
table and cannot be computed, so one table is shared by the backend and the frontend.

## Where the table comes from

- **Source of truth:** the Python package [`nepali-datetime`](https://pypi.org/project/nepali-datetime/)
  (pinned in `requirements.txt`). It ships a month-length table for BS 1975–2100.
- **`web/lib/bs/calendar-data.json`** is generated from that package: for every BS year the
  12 month lengths and the AD date of 1 Baisakh. Never edit it by hand.
- **`web/lib/bs/calendar-overrides.json`** holds official corrections. A year listed there
  replaces the package table for that year, in the backend and the frontend alike.
- `app/core/bsdate.py` (Python) and `web/lib/bs` (TypeScript) both read only those two files, so
  the server and the browser can never disagree. Both validate the table when they load it.

## Regenerating

```bash
.venv/bin/python scripts/gen_bs_calendar.py          # rewrites calendar-data.json
.venv/bin/python scripts/gen_bs_calendar.py --check  # exit 1 when the file is stale
```

Regenerate after upgrading `nepali-datetime`; commit the JSON with the pin. The tests
(`tests/core/test_bsdate.py`, `web/lib/bs/*.test.ts`) check that the JSON matches the package, that
every day from 2013-04-14 to 2043-04-13 round-trips AD→BS→AD, that the 12 months of each year add
up to the distance between consecutive new years, and that the official dates in
`web/lib/bs/fixtures/official-2082-2083.json` still hold.

## Yearly check (do this every Baisakh)

The Nepal government publishes the official calendar (Nepali Patro) a year at a time and it has
differed from the package tables before. Each year, check the **current and the next BS year**
against the official patro: the AD date of 1 Baisakh and the first day of every month.

- Everything agrees: nothing to do.
- A month length differs: add the year to `calendar-overrides.json`:

  ```json
  {
    "years": {
      "2085": {"months": [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30], "new_year_ad": "2028-04-13"}
    }
  }
  ```

  Both fields are required. Consecutive years must stay consistent: the next year's `new_year_ad`
  has to equal this year's `new_year_ad` plus the sum of its months, so a correction that changes
  a year's length also needs an entry for the following year. Loading fails with a clear message
  otherwise (`make test` catches it).
- Update `web/lib/bs/fixtures/official-2082-2083.json` (or add a new fixture) with the verified
  dates, so a future package upgrade cannot silently reintroduce the old values.

## Time rules

- Business time zone is Asia/Kathmandu (UTC+05:45). Timestamps are stored as `timestamptz` in UTC;
  calendar days (attendance day, payment date) as plain AD `date` columns.
- "Today", "this month" and attendance day boundaries are always computed in Asia/Kathmandu
  (`bsdate.today_bs()`, `bsdate.day_bounds()`, `nowInKathmandu()` in `web/lib/bs`), never in server
  or browser local time.
- APIs accept `date` (AD) or `date_bs` and always return both; month filters take a BS year and
  month and resolve them with `bs_month_range`.
