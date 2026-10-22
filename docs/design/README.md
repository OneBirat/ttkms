# TTK UI design reference

Exported from the approved design canvas. Each `*.dc.html` file is one screen: plain HTML with inline styles, plus a small
`class Component` script at the bottom that holds the sample data and the interactive behaviour (toggles, filters, popups).
Use them as the source of truth for layout, copy, colours and behaviour — rebuild them as Next.js components; do not embed them.

| Module | Screens |
|---|---|
| shared | Main (dashboard), Login |
| stock | Items, AddProduct (popup), ProductDetail, StockEntry, Movements (= Stock report) |
| attendance | AttendanceMark, AttendanceReport, ExportPdf, ExportExcel |
| payroll | Employees, AddEmployee (popup), PhotoCapture (phone), SalaryReport |
| later | BiometricImport (skipped for now) |

Design tokens: sidebar #17222A (active #24363F), bg #F4F5F2, card #FFFFFF / border #E2E5E1, input border #CBD2CC,
text #1B2328, muted #5B6670, primary #0E6B6B (hover #0A4F4F), OK #E3F0EE/#0A5454, Low #FCEFD9/#8A4205,
Out #F6DCD3/#8E2F12, Leave #E3E8F4/#253F73. Fonts: IBM Plex Sans, IBM Plex Mono (numbers), Noto Sans Devanagari.
Radius 8px inputs / 12px cards, min touch target 44px. BS dates first everywhere, Nepali weekday initials आ सो मं बु बि शु श.
