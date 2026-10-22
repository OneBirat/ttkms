# TTK — Stock design (latest, 23 Oct 2026)

Screens for the stock worktree. Each `*.dc.html` file is one screen: HTML with inline styles plus a small
`class Component` script at the bottom that holds the sample data and the interactions. Rebuild them as Next.js components.
The script shows the intended behaviour (validation, pop-ups, locking). Copy the behaviour, not the code.

| File | Screen | Route |
|---|---|---|
| Items.dc.html | Items list (Compact / Grouped, Show codes, today in/out, PDF/Print) | /stock/items |
| AddProduct.dc.html | Add product popup (variations + opening stock, no duplicates). Admin only — NOT reachable from Stock entry | modal on Items |
| ProductDetail.dc.html | Product detail (product dropdown, variation tabs, calendar/table, averages, patterns) | /stock/products/[id] |
| StockEntry.dc.html | Stock entry, desktop (see CHANGES below) | /stock/entry |
| StockEntryMobile.dc.html | Stock entry, phone layout | /stock/entry below ~640px |
| StockEntryMobileEmpty.dc.html | Same phone screen, empty state (wrapper: start-empty) | — |
| StockEntryMobileMenu.dc.html | Same phone screen, side menu open (wrapper: start-menu) | — |
| Movements.dc.html | Stock report | /stock/report |
| Main.dc.html | Dashboard — use only the stock widgets | / |

Design tokens: sidebar #17222A (active #24363F), bg #F4F5F2, card #FFFFFF / border #E2E5E1, input border #CBD2CC,
text #1B2328, muted #5B6670, primary #0E6B6B (hover #0A4F4F), consumption accent #9A4A06 / #8A4205 on #FCEFD9,
OK #E3F0EE/#0A5454, Low #FCEFD9/#8A4205, Out #F6DCD3/#8E2F12. Fonts: IBM Plex Sans, IBM Plex Mono (numbers),
Noto Sans Devanagari (500/600/700). Teal = purchase, amber = consumption, everywhere.
