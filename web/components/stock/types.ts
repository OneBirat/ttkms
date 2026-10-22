/**
 * Stock module contract: the shapes the FastAPI endpoints under /api/stock
 * will return. Pages only ever see these types through api.ts, so swapping
 * the mock implementation for real fetches never touches a page.
 *
 * Conventions (same as app/core/schemas.py): snake_case keys, dates as
 * "YYYY-MM-DD" strings (both BS and AD are sent), quantities in pcs.
 */

export const VARIATIONS_BY = [
  "Capacity",
  "Diameter",
  "Burners",
  "Wattage",
  "Pieces in set",
  "Colour",
  "No variations",
] as const;
export type VariationsBy = (typeof VARIATIONS_BY)[number];

export const STOCK_UNITS = ["pcs", "set", "box"] as const;
export type StockUnit = (typeof STOCK_UNITS)[number];

/** OK above the reorder level, Low at or below it, Out at 0. */
export type StockStatus = "ok" | "low" | "out";

/** Opening = first count, purchase = production / stock in, consumption = sales / used. */
export type MovementType = "opening" | "purchase" | "consumption";

/** What the Stock entry form can record; opening stock is set when a product is added. */
export type EntryType = "purchase" | "consumption";

// ------------------------------------------------------------- catalogue

export interface Variation {
  id: number;
  product_id: number;
  /** "3 L", "26 cm", "2 burner" … or "Standard" for "No variations". */
  name: string;
  /** Auto code, e.g. "SBC-3L". */
  code: string;
  reorder_level: number;
  in_stock: number;
  status: StockStatus;
  /** Purchased / produced today. */
  in_today: number;
  /** Sold / used today. */
  out_today: number;
}

export interface Product {
  id: number;
  name: string;
  variations_by: VariationsBy;
  unit: StockUnit;
  variations: Variation[];
}

/** Shop-wide numbers shown above the Items list and on the printed list. */
export interface StockSummary {
  products: number;
  variations: number;
  total_pcs: number;
  today_in: number;
  today_out: number;
  low: number;
  out: number;
}

export interface ProductListResponse {
  products: Product[];
  summary: StockSummary;
}

export interface NewVariationInput {
  name: string;
  /** Blank in the form = 0. */
  opening: number;
  reorder_level: number;
}

export interface CreateProductRequest {
  name: string;
  variations_by: VariationsBy;
  unit: StockUnit;
  /** BS date the opening stock is dated. */
  opening_date_bs: string;
  variations: NewVariationInput[];
}

export interface AddVariationRequest {
  product_id: number;
  opening_date_bs: string;
  variation: NewVariationInput;
}

export interface UpdateVariationRequest {
  name?: string;
  reorder_level?: number;
}

export interface UpdateProductRequest {
  name?: string;
  variations_by?: VariationsBy;
  unit?: StockUnit;
}

// ------------------------------------------------------------- movements

export interface Movement {
  id: number;
  product_id: number;
  product_name: string;
  variation_id: number;
  variation_name: string;
  type: MovementType;
  quantity: number;
  date_bs: string;
  date_ad: string;
  /** "HH:MM" local time the entry was recorded. */
  time: string;
  remarks: string | null;
  entered_by: string;
}

/** One row of the Stock entry combobox: GET /api/stock/items?search=&exclude_ids= */
export interface StockItem {
  variation_id: number;
  product_id: number;
  product_name: string;
  variation_name: string;
  code: string;
  in_stock: number;
  status: StockStatus;
}

export interface StockItemsResponse {
  items: StockItem[];
}

export interface EntryRow {
  variation_id: number;
  qty: number;
  remark: string | null;
}

/** One form submission: every row saves together or none does. */
export interface EntryRequest {
  type: EntryType;
  date_bs: string;
  date_ad: string;
  rows: EntryRow[];
}

/** Count and quantity of one entry type recorded today. */
export interface TodayTotals {
  count: number;
  total_quantity: number;
}

export interface EntryResponse {
  /** The movements just created, in row order. */
  saved: Movement[];
  /** Today's running totals for `type`, including the rows just saved. */
  today: TodayTotals;
}

/** GET /api/stock/entries/today?type= — today's panel / tab. */
export interface TodayEntries {
  date_bs: string;
  purchases: TodayTotals;
  consumptions: TodayTotals;
  /** Newest first; only the requested type when `type` was given. */
  entries: Movement[];
}

// ---------------------------------------------------------- stock report

export interface ReportFilter {
  from_bs: string;
  to_bs: string;
  product_id: number | null;
  variation_id: number | null;
  type: MovementType | null;
  page: number;
  page_size: number;
}

export interface ReportTotals {
  stock_at_start: number;
  purchased: number;
  consumed: number;
  /** Opening entries inside the range (counted into stock at end). */
  opening: number;
  stock_at_end: number;
}

export interface ReportResponse {
  totals: ReportTotals;
  rows: Movement[];
  total: number;
  page: number;
  pages: number;
}

// --------------------------------------------------------- product detail

export interface DailyHistoryRow {
  date_bs: string;
  date_ad: string;
  /** 0 = Sunday … 6 = Saturday. */
  weekday: number;
  purchased: number;
  sold: number;
  closing: number;
}

export interface DailyHistory {
  product_id: number;
  variation_id: number | null;
  days: number;
  /** Newest first. */
  rows: DailyHistoryRow[];
  purchased: number;
  sold: number;
  open_days: number;
  days_with_sales: number;
  avg_sold_per_open_day: number;
}

export interface CalendarDay {
  day: number;
  date_bs: string;
  date_ad: string;
  weekday: number;
  purchased: number;
  sold: number;
}

export interface CalendarMonth {
  year: number;
  month: number;
  month_name: string;
  month_name_np: string;
  /** Weekday of day 1 (0 = Sunday). */
  first_weekday: number;
  days: CalendarDay[];
  max_sold: number;
}

export interface MonthTotals {
  year: number;
  month: number;
  label: string;
  purchased: number;
  sold: number;
}

export interface ProductStats {
  product_id: number;
  variation_id: number | null;
  month_name: string;
  in_stock: number;
  purchased_this_month: number;
  sold_this_month: number;
  avg_per_day: number;
  avg_per_week: number;
  avg_per_month: number;
  /** null when nothing was sold (cannot estimate). */
  days_left: number | null;
  /** Sunday … Saturday, pcs sold this month. */
  weekday_sales: number[];
  last_6_months: MonthTotals[];
  patterns: string[];
}

// -------------------------------------------------------------- dashboard

export interface StockStatsData {
  variations: number;
  products: number;
  below_reorder: number;
  entries_today: number;
  purchases_today: number;
  consumptions_today: number;
}

export interface LowStockRow {
  variation_id: number;
  product_id: number;
  product_name: string;
  variation_name: string;
  status: StockStatus;
  in_stock: number;
  reorder_level: number;
  short_by: number;
  /** null when there is no consumption in the last 30 days. */
  days_left: number | null;
  last_purchase_bs: string | null;
  last_purchase_qty: number | null;
}

export interface LowStockData {
  rows: LowStockRow[];
}

export interface CurrentStockRow {
  variation_id: number;
  product_id: number;
  product_name: string;
  variation_name: string;
  opening: number;
  purchased: number;
  consumed: number;
  in_stock: number;
  status: StockStatus;
}

export interface CurrentStockData {
  rows: CurrentStockRow[];
  total: number;
  page: number;
  pages: number;
}

// ------------------------------------------------------------------ misc

export interface StockToday {
  ad: string;
  bs: string;
  weekday: number;
  bs_text: string;
  bs_text_np: string;
  ad_text: string;
}

/** Thrown by api.ts for a 409/422 the form should show inline. */
export class StockApiError extends Error {
  readonly status: number;
  readonly field: string | null;

  constructor(status: number, message: string, field: string | null = null) {
    super(message);
    this.name = "StockApiError";
    this.status = status;
    this.field = field;
  }
}
