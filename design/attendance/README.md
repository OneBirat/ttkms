# TTK — Attendance design (latest, 24 Oct 2026)

Each `*.dc.html` is one screen: HTML + inline styles + a `class Component` script at the bottom holding
sample data and interactions. Rebuild as Next.js components; copy the behaviour, not the code.
`AttendanceScan*.dc.html` are thin wrappers that open AttendanceMarkMobile at one step of the scan flow.

| File | Screen | Route |
|---|---|---|
| AttendanceMark.dc.html | Mark attendance, desktop: filters, USB-scanner box, Present / Overtime / Absent, overtime-hours pop-up, scan pop-ups | /attendance/mark |
| AttendanceMarkMobile.dc.html | Same, phone layout (< ~640px): cards, camera scanner, side menu | /attendance/mark |
| AttendanceScanCamera … Missing | Scan flow: camera → employee found → overtime hours → saved; card not found | (states) |
| AttendanceScanAlready / Pay / Salary | Already-marked label → Salary or Advance payment → amount | (states) |
| AttendanceReport.dc.html | Month / week report | /attendance/report |
| ExportPdf / ExportExcel | Export samples | PDF / XLSX download |
| Main.dc.html | Dashboard — attendance widget only ("Attendance today") | / |

Statuses are now ONLY: P = Present, O = Overtime (present + whole hours), A = Absent. Weekly off (Saturday) shown as –.
The report/export files still show L/H/V (old) — update them to P / O / A + overtime hours.

Tokens: sidebar #17222A (active #24363F), bg #F4F5F2, card #FFFFFF / #E2E5E1, input border #CBD2CC, text #1B2328,
muted #5B6670, primary #0E6B6B, overtime #2F4E8C on #E3E8F4, absent #8E2F12 on #F6DCD3, not marked #8A4205 on #FFF3E0.
Fonts: IBM Plex Sans, IBM Plex Mono (numbers), Noto Sans Devanagari.
