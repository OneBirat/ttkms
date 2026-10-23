/**
 * In-memory mock store behind api.ts. Everything is derived from a list of
 * movements (opening / purchase / consumption) so stock, history, calendars
 * and report totals always agree, and mutations (add product, save entries)
 * behave like the real backend will.
 *
 * The history is generated deterministically relative to today, so "today's
 * entries" always exist. Replace this file with real fetches in api.ts once
 * the FastAPI endpoints exist; nothing else imports it.
 */

import {
  addDays,
  adToBs,
  bsMonthName,
  bsMonthNameNp,
  bsToAd,
  daysInBsMonth,
  formatAdLong,
  formatBsIso,
  formatBsLong,
  formatBsLongNp,
  parseBsIso,
  previousBsMonth,
  SATURDAY,
  todayAd,
  weekdayOf,
  WEEKDAY_NAMES_NP,
} from "./calendar";
import {
  averagePerOpenDay,
  daysLeft,
  findDuplicateProduct,
  fixed1,
  isDuplicateVariation,
  matchesSearch,
  percentChange,
  statusFor,
  sum,
  variationCode,
} from "./helpers";
import {
  StockApiError,
  type AddVariationRequest,
  type CalendarMonth,
  type CreateProductRequest,
  type CurrentStockData,
  type DailyHistory,
  type DailyHistoryRow,
  type EntryRequest,
  type EntryResponse,
  type EntryType,
  type LowStockData,
  type LowStockRow,
  type MonthTotals,
  type Movement,
  type MovementType,
  type Product,
  type ProductListResponse,
  type ProductStats,
  type ReportFilter,
  type ReportResponse,
  type StockItem,
  type StockItemsResponse,
  type StockStatsData,
  type StockSummary,
  type StockToday,
  type StockUnit,
  type TodayEntries,
  type TodayTotals,
  type UpdateProductRequest,
  type UpdateVariationRequest,
  type Variation,
  type VariationsBy,
} from "./types";

// ------------------------------------------------------------- records

interface ProductRecord {
  id: number;
  name: string;
  variations_by: VariationsBy;
  unit: StockUnit;
}

interface VariationRecord {
  id: number;
  product_id: number;
  name: string;
  reorder_level: number;
}

interface MovementRecord {
  id: number;
  variation_id: number;
  type: MovementType;
  quantity: number;
  date_ad: string;
  time: string;
  remarks: string | null;
  entered_by: string;
}

interface State {
  products: ProductRecord[];
  variations: VariationRecord[];
  movements: MovementRecord[];
  nextProductId: number;
  nextVariationId: number;
  nextMovementId: number;
}

/** The signed-in user as the backend would record it. */
const CURRENT_USER = "Admin";
const HISTORY_DAYS = 200;

// ----------------------------------------------------------- catalogue

interface SeedVariation {
  name: string;
  reorder: number;
  /** Stock we want today (the generator sets the opening count to reach it). */
  target: number;
  /** 0.6 slow seller, 1 normal, 1.4 fast seller. */
  popularity: number;
}

interface SeedProduct {
  name: string;
  by: VariationsBy;
  unit: StockUnit;
  variations: SeedVariation[];
}

const v = (name: string, reorder: number, target: number, popularity = 1): SeedVariation => ({
  name,
  reorder,
  target,
  popularity,
});

const CATALOGUE: SeedProduct[] = [
  {
    name: "SS Black cooker",
    by: "Capacity",
    unit: "pcs",
    variations: [v("2 L", 5, 7), v("2.5 L", 5, 14), v("3 L", 6, 10, 1.4), v("5 L", 5, 0, 1.4)],
  },
  {
    name: "Aluminium cooker",
    by: "Capacity",
    unit: "pcs",
    variations: [v("3 L", 6, 18), v("5 L", 6, 11), v("7.5 L", 4, 9, 0.6)],
  },
  {
    name: "Induction base cooker",
    by: "Capacity",
    unit: "pcs",
    variations: [v("3 L", 4, 15), v("5 L", 4, 8)],
  },
  {
    name: "Steel kadhai",
    by: "Diameter",
    unit: "pcs",
    variations: [v("24 cm", 4, 12), v("26 cm", 6, 20, 1.4), v("30 cm", 6, 2, 0.6)],
  },
  {
    name: "Non-stick tawa",
    by: "Diameter",
    unit: "pcs",
    variations: [v("26 cm", 4, 9), v("28 cm", 4, 1, 1.4)],
  },
  {
    name: "Non-stick fry pan",
    by: "Diameter",
    unit: "pcs",
    variations: [v("24 cm", 4, 13), v("28 cm", 4, 6)],
  },
  {
    name: "Glass top gas stove",
    by: "Burners",
    unit: "pcs",
    variations: [v("2 burner", 3, 7), v("3 burner", 3, 5, 0.6)],
  },
  {
    name: "Rice cooker",
    by: "Capacity",
    unit: "pcs",
    variations: [v("1 L", 4, 8), v("1.8 L", 5, 9, 1.4), v("2.8 L", 5, 3)],
  },
  {
    name: "Electric kettle",
    by: "Capacity",
    unit: "pcs",
    variations: [v("1.5 L", 4, 10), v("1.8 L", 4, 16)],
  },
  {
    name: "Mixer grinder",
    by: "Wattage",
    unit: "pcs",
    variations: [v("500 W", 4, 6), v("750 W", 4, 2, 0.6)],
  },
  {
    name: "Steel spoon set",
    by: "Pieces in set",
    unit: "set",
    variations: [v("6 pcs", 6, 22), v("12 pcs", 6, 4, 1.4)],
  },
  {
    name: "Cooker gasket",
    by: "Capacity",
    unit: "pcs",
    variations: [v("2–3 L", 10, 34, 1.4), v("5 L", 10, 26)],
  },
];

const PURCHASE_USERS = ["Anita", "Kamala"];
const SALE_USERS = ["Bikash", "Sita"];
const SUPPLIERS = ["Sharma Traders", "Kathmandu Metal Works", "Everest Appliances"];
const SALE_REMARKS = ["Counter sale", "Counter sale", "Counter sale", "Shop order", "Display damage"];
/** Relative sales volume Sunday … Saturday (Saturday closed). */
const WEEKDAY_WEIGHT = [1.1, 0.8, 0.9, 0.9, 1, 1.5, 0];

/** Small deterministic hash so the generated history is stable between reloads. */
function hash(...parts: number[]): number {
  let h = 2166136261;
  for (const p of parts) {
    h ^= p + 0x9e3779b9;
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h % 1000;
}

function timeFor(seed: number): string {
  const minutes = 9 * 60 + 15 + (hash(seed, 7) % (9 * 60));
  const hh = Math.floor(minutes / 60);
  const mm = minutes % 60;
  return `${hh < 10 ? "0" : ""}${hh}:${mm < 10 ? "0" : ""}${mm}`;
}

function seedState(today: string): State {
  const state: State = {
    products: [],
    variations: [],
    movements: [],
    nextProductId: 1,
    nextVariationId: 1,
    nextMovementId: 1,
  };
  const push = (m: Omit<MovementRecord, "id">) => {
    state.movements.push({ id: state.nextMovementId++, ...m });
  };

  let k = 0;
  for (const seed of CATALOGUE) {
    const product: ProductRecord = {
      id: state.nextProductId++,
      name: seed.name,
      variations_by: seed.by,
      unit: seed.unit,
    };
    state.products.push(product);
    for (const sv of seed.variations) {
      k += 1;
      const variation: VariationRecord = {
        id: state.nextVariationId++,
        product_id: product.id,
        name: sv.name,
        reorder_level: sv.reorder,
      };
      state.variations.push(variation);

      // 1. Sales per day (deterministic), Saturdays closed.
      const sales: number[] = new Array<number>(HISTORY_DAYS).fill(0);
      for (let t = HISTORY_DAYS - 1; t >= 0; t--) {
        const wd = weekdayOf(addDays(today, -t));
        if (wd === SATURDAY) continue;
        const r = hash(t, k, 1) % 10;
        const base = r < 4 ? 0 : r < 7 ? 1 : r < 9 ? 2 : 3;
        sales[t] = Math.round(base * WEEKDAY_WEIGHT[wd] * sv.popularity);
      }
      // 2. Forward simulation: restock a lot once the balance is at or below
      //    the reorder level. "Story" items (target at or below the reorder
      //    level) stop restocking for the last few weeks so they end exactly
      //    at their target, which is what the design's Low / Out rows show.
      const lot = sv.reorder * 2 + 4 + (k % 4) * 3;
      const story = sv.target <= sv.reorder;
      let drainStart = story ? (sv.target === 0 ? 45 : 10 + (hash(k, 8) % 8)) : -1;
      while (drainStart >= 0 && weekdayOf(addDays(today, -drainStart)) === SATURDAY) drainStart += 1;
      const deliveryToday = !story && hash(k, 9) % 8 === 0;
      const opening = sv.reorder * 3 + lot;
      let balance = opening;
      const flows: { t: number; type: MovementType; qty: number; bulk?: boolean }[] = [];
      for (let t = HISTORY_DAYS - 1; t >= 0; t--) {
        const wd = weekdayOf(addDays(today, -t));
        if (wd === SATURDAY) continue;
        if (story && t === drainStart) {
          let need = sv.target;
          for (let u = t; u >= 0; u--) need += sales[u];
          if (balance < need) {
            flows.push({ t, type: "purchase", qty: need - balance });
            balance = need;
          } else if (balance > need) {
            flows.push({ t, type: "consumption", qty: balance - need, bulk: true });
            balance = need;
          }
        } else if ((!story || t > drainStart) && (balance <= sv.reorder || (deliveryToday && t === 0))) {
          const qty = lot + (hash(t, k, 2) % 4);
          flows.push({ t, type: "purchase", qty });
          balance += qty;
        }
        const sold = Math.min(balance, sales[t]);
        if (sold > 0) {
          flows.push({ t, type: "consumption", qty: sold });
          balance -= sold;
        }
      }
      push({
        variation_id: variation.id,
        type: "opening",
        quantity: opening,
        date_ad: addDays(today, -HISTORY_DAYS),
        time: "09:00",
        remarks: "Opening count",
        entered_by: "Admin",
      });
      for (const f of flows) {
        const date = addDays(today, -f.t);
        const dayIndex = HISTORY_DAYS - f.t;
        if (f.type === "purchase") {
          push({
            variation_id: variation.id,
            type: "purchase",
            quantity: f.qty,
            date_ad: date,
            time: timeFor(dayIndex * 3 + 1 + k * 11),
            remarks: hash(dayIndex, 3) % 3 === 0 ? SUPPLIERS[hash(dayIndex, 3) % SUPPLIERS.length] : null,
            entered_by: PURCHASE_USERS[hash(dayIndex, 4) % PURCHASE_USERS.length],
          });
        } else {
          push({
            variation_id: variation.id,
            type: "consumption",
            quantity: f.qty,
            date_ad: date,
            time: timeFor(dayIndex * 7 + k),
            remarks: f.bulk ? "Shop order" : SALE_REMARKS[hash(dayIndex, k, 5) % SALE_REMARKS.length],
            entered_by: SALE_USERS[hash(dayIndex, k, 6) % SALE_USERS.length],
          });
        }
      }
    }
  }
  // Ids follow the clock, so "newest first" is simply the highest id and a
  // row saved now always lands on top of today's list.
  state.movements.sort((a, b) => a.date_ad.localeCompare(b.date_ad) || a.time.localeCompare(b.time) || a.id - b.id);
  state.movements.forEach((m, i) => {
    m.id = i + 1;
  });
  state.nextMovementId = state.movements.length + 1;
  return state;
}

// --------------------------------------------------------------- state

let today = todayAd();
let state = seedState(today);

/** Rebuilds the mock store (tests). `now` fixes "today". */
export function resetMockState(now?: Date): void {
  today = todayAd(now);
  state = seedState(today);
}

export function mockToday(): string {
  return today;
}

// ------------------------------------------------------------ lookups

function productOr404(id: number): ProductRecord {
  const product = state.products.find((p) => p.id === id);
  if (!product) throw new StockApiError(404, "Product not found");
  return product;
}

function variationOr404(id: number): VariationRecord {
  const variation = state.variations.find((v) => v.id === id);
  if (!variation) throw new StockApiError(404, "Variation not found");
  return variation;
}

function variationsOf(productId: number): VariationRecord[] {
  return state.variations.filter((v) => v.product_id === productId);
}

function movementsOf(variationId: number): MovementRecord[] {
  return state.movements.filter((m) => m.variation_id === variationId);
}

function signedQty(m: MovementRecord): number {
  return m.type === "consumption" ? -m.quantity : m.quantity;
}

function stockAsOf(variationIds: number[], dateAd: string): number {
  const ids = new Set(variationIds);
  return sum(
    state.movements
      .filter((m) => ids.has(m.variation_id) && m.date_ad <= dateAd)
      .map(signedQty),
  );
}


function toMovement(m: MovementRecord): Movement {
  const variation = variationOr404(m.variation_id);
  const product = productOr404(variation.product_id);
  return {
    id: m.id,
    product_id: product.id,
    product_name: product.name,
    variation_id: variation.id,
    variation_name: variation.name,
    type: m.type,
    quantity: m.quantity,
    date_bs: formatBsIso(adToBs(m.date_ad)),
    date_ad: m.date_ad,
    time: m.time,
    remarks: m.remarks,
    entered_by: m.entered_by,
  };
}

function toVariation(record: VariationRecord): Variation {
  const product = productOr404(record.product_id);
  const movements = movementsOf(record.id);
  const in_stock = sum(movements.map(signedQty));
  const todays = movements.filter((m) => m.date_ad === today);
  return {
    id: record.id,
    product_id: record.product_id,
    name: record.name,
    code: variationCode(product.name, record.name),
    reorder_level: record.reorder_level,
    in_stock,
    status: statusFor(in_stock, record.reorder_level),
    in_today: sum(todays.filter((m) => m.type === "purchase").map((m) => m.quantity)),
    out_today: sum(todays.filter((m) => m.type === "consumption").map((m) => m.quantity)),
  };
}

function toProduct(record: ProductRecord): Product {
  return {
    id: record.id,
    name: record.name,
    variations_by: record.variations_by,
    unit: record.unit,
    variations: variationsOf(record.id).map(toVariation),
  };
}

function summaryOf(products: Product[]): StockSummary {
  const variations = products.flatMap((p) => p.variations);
  return {
    products: products.length,
    variations: variations.length,
    total_pcs: sum(variations.map((x) => x.in_stock)),
    today_in: sum(variations.map((x) => x.in_today)),
    today_out: sum(variations.map((x) => x.out_today)),
    low: variations.filter((x) => x.status === "low").length,
    out: variations.filter((x) => x.status === "out").length,
  };
}

function nowTime(): string {
  const d = new Date();
  const hh = d.getHours();
  const mm = d.getMinutes();
  return `${hh < 10 ? "0" : ""}${hh}:${mm < 10 ? "0" : ""}${mm}`;
}

function bsOr422(value: string, field: string): string {
  const parsed = parseBsIso(value);
  if (!parsed) throw new StockApiError(422, "Enter a BS date as YYYY-MM-DD", field);
  return bsToAd(parsed);
}

// ------------------------------------------------------------ reads

export function readToday(): StockToday {
  const bs = adToBs(today);
  const weekday = weekdayOf(today);
  return {
    ad: today,
    bs: formatBsIso(bs),
    weekday,
    bs_text: formatBsLong(bs),
    bs_text_np: `${WEEKDAY_NAMES_NP[weekday]}, ${formatBsLongNp(bs)}`,
    ad_text: formatAdLong(today),
  };
}

export function readProducts(): ProductListResponse {
  const products = state.products.map(toProduct);
  return { products, summary: summaryOf(products) };
}

export function readProduct(id: number): Product {
  return toProduct(productOr404(id));
}

function totalsOf(type: EntryType): TodayTotals {
  const list = state.movements.filter((m) => m.date_ad === today && m.type === type);
  return { count: list.length, total_quantity: sum(list.map((m) => m.quantity)) };
}

/** Newest first: ids are assigned in clock order (see the generator), so the highest id is the latest. */
function newestFirst(a: MovementRecord, b: MovementRecord): number {
  return b.id - a.id;
}

export function readTodayEntries(type: EntryType | null): TodayEntries {
  const entries = state.movements
    .filter((m) => m.date_ad === today && m.type !== "opening" && (type === null || m.type === type))
    .sort(newestFirst)
    .map(toMovement);
  return {
    date_bs: formatBsIso(adToBs(today)),
    purchases: totalsOf("purchase"),
    consumptions: totalsOf("consumption"),
    entries,
  };
}

/** Combobox rows: every word of `search` must match "product variation"; `excludeIds` are hidden. */
export function readItems(search: string, excludeIds: number[]): StockItemsResponse {
  const hidden = new Set(excludeIds);
  const items: StockItem[] = [];
  for (const product of state.products) {
    for (const record of state.variations) {
      if (record.product_id !== product.id || hidden.has(record.id)) continue;
      if (!matchesSearch(search, product.name, record.name)) continue;
      const variation = toVariation(record);
      items.push({
        variation_id: record.id,
        product_id: product.id,
        product_name: product.name,
        variation_name: record.name,
        code: variation.code,
        in_stock: variation.in_stock,
        status: variation.status,
      });
    }
  }
  return { items };
}

export function readReport(filter: ReportFilter): ReportResponse {
  const fromAd = bsOr422(filter.from_bs, "from_bs");
  const toAd = bsOr422(filter.to_bs, "to_bs");
  if (fromAd > toAd) throw new StockApiError(422, "From must not be after To", "from_bs");
  let scope = state.variations;
  if (filter.product_id) scope = scope.filter((x) => x.product_id === filter.product_id);
  if (filter.variation_id) scope = scope.filter((x) => x.id === filter.variation_id);
  const ids = new Set(scope.map((x) => x.id));
  const inRange = state.movements.filter(
    (m) => ids.has(m.variation_id) && m.date_ad >= fromAd && m.date_ad <= toAd,
  );
  const purchased = sum(inRange.filter((m) => m.type === "purchase").map((m) => m.quantity));
  const consumed = sum(inRange.filter((m) => m.type === "consumption").map((m) => m.quantity));
  const opening = sum(inRange.filter((m) => m.type === "opening").map((m) => m.quantity));
  const stock_at_start = stockAsOf([...ids], addDays(fromAd, -1));
  const rows = (filter.type ? inRange.filter((m) => m.type === filter.type) : inRange)
    .slice()
    .sort((a, b) =>
      a.date_ad !== b.date_ad
        ? b.date_ad.localeCompare(a.date_ad)
        : a.time !== b.time
          ? b.time.localeCompare(a.time)
          : b.id - a.id,
    );
  const pageSize = Math.max(1, filter.page_size);
  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  const page = Math.min(Math.max(1, filter.page), pages);
  return {
    totals: {
      stock_at_start,
      purchased,
      consumed,
      opening,
      stock_at_end: stock_at_start + opening + purchased - consumed,
    },
    rows: rows.slice((page - 1) * pageSize, page * pageSize).map(toMovement),
    total: rows.length,
    page,
    pages,
  };
}

function scopeIds(productId: number, variationId: number | null): number[] {
  productOr404(productId);
  if (variationId !== null) {
    const variation = variationOr404(variationId);
    if (variation.product_id !== productId) throw new StockApiError(404, "Variation not found");
    return [variationId];
  }
  return variationsOf(productId).map((x) => x.id);
}

function dayTotals(ids: Set<number>, dateAd: string): { purchased: number; sold: number; net: number } {
  let purchased = 0;
  let sold = 0;
  let net = 0;
  for (const m of state.movements) {
    if (m.date_ad !== dateAd || !ids.has(m.variation_id)) continue;
    if (m.type === "purchase") purchased += m.quantity;
    else if (m.type === "consumption") sold += m.quantity;
    net += signedQty(m);
  }
  return { purchased, sold, net };
}

export function readDailyHistory(
  productId: number,
  variationId: number | null,
  days: number,
): DailyHistory {
  const idList = scopeIds(productId, variationId);
  const ids = new Set(idList);
  let closing = stockAsOf(idList, today);
  const rows: DailyHistoryRow[] = [];
  for (let t = 0; t < days; t++) {
    const date = addDays(today, -t);
    const totals = dayTotals(ids, date);
    rows.push({
      date_bs: formatBsIso(adToBs(date)),
      date_ad: date,
      weekday: weekdayOf(date),
      purchased: totals.purchased,
      sold: totals.sold,
      closing,
    });
    closing -= totals.net;
  }
  const openRows = rows.filter((r) => r.weekday !== SATURDAY);
  return {
    product_id: productId,
    variation_id: variationId,
    days,
    rows,
    purchased: sum(rows.map((r) => r.purchased)),
    sold: sum(rows.map((r) => r.sold)),
    open_days: openRows.length,
    days_with_sales: rows.filter((r) => r.sold > 0).length,
    avg_sold_per_open_day: averagePerOpenDay(rows),
  };
}

export function readCalendarMonth(
  productId: number,
  variationId: number | null,
  year: number,
  month: number,
): CalendarMonth {
  const ids = new Set(scopeIds(productId, variationId));
  const count = daysInBsMonth(year, month);
  const days = [];
  let maxSold = 0;
  for (let day = 1; day <= count; day++) {
    const dateAd = bsToAd({ year, month, day });
    const totals = dayTotals(ids, dateAd);
    maxSold = Math.max(maxSold, totals.sold);
    days.push({
      day,
      date_bs: formatBsIso({ year, month, day }),
      date_ad: dateAd,
      weekday: weekdayOf(dateAd),
      purchased: totals.purchased,
      sold: totals.sold,
    });
  }
  return {
    year,
    month,
    month_name: bsMonthName(month),
    month_name_np: bsMonthNameNp(month),
    first_weekday: weekdayOf(bsToAd({ year, month, day: 1 })),
    days,
    max_sold: maxSold,
  };
}

function monthTotals(ids: Set<number>, year: number, month: number, upToDay: number): MonthTotals {
  let purchased = 0;
  let sold = 0;
  for (let day = 1; day <= upToDay; day++) {
    const t = dayTotals(ids, bsToAd({ year, month, day }));
    purchased += t.purchased;
    sold += t.sold;
  }
  return { year, month, label: bsMonthName(month), purchased, sold };
}

export function readProductStats(productId: number, variationId: number | null): ProductStats {
  const idList = scopeIds(productId, variationId);
  const ids = new Set(idList);
  const bsToday = adToBs(today);
  const inStock = stockAsOf(idList, today);

  // This BS month to date.
  const weekday_sales = [0, 0, 0, 0, 0, 0, 0];
  const perVariation = new Map<number, number>();
  let purchased = 0;
  let sold = 0;
  let openDays = 0;
  for (let day = 1; day <= bsToday.day; day++) {
    const dateAd = bsToAd({ year: bsToday.year, month: bsToday.month, day });
    const wd = weekdayOf(dateAd);
    if (wd !== SATURDAY) openDays += 1;
    for (const m of state.movements) {
      if (m.date_ad !== dateAd || !ids.has(m.variation_id)) continue;
      if (m.type === "purchase") purchased += m.quantity;
      if (m.type === "consumption") {
        sold += m.quantity;
        weekday_sales[wd] += m.quantity;
        perVariation.set(m.variation_id, (perVariation.get(m.variation_id) ?? 0) + m.quantity);
      }
    }
  }
  const avg_per_day = openDays ? sold / openDays : 0;
  const avg_per_week = sold / Math.max(1, bsToday.day / 7);

  const last_6_months: MonthTotals[] = [];
  let cursor = { year: bsToday.year, month: bsToday.month };
  for (let i = 0; i < 6; i++) {
    const upTo = i === 0 ? bsToday.day : daysInBsMonth(cursor.year, cursor.month);
    last_6_months.unshift(monthTotals(ids, cursor.year, cursor.month, upTo));
    cursor = previousBsMonth(cursor.year, cursor.month);
  }
  const avg_per_month = sum(last_6_months.map((m) => m.sold)) / last_6_months.length;
  const days_left = daysLeft(inStock, avg_per_day);

  // Plain-language findings.
  const patterns: string[] = [];
  const monthName = bsMonthName(bsToday.month);
  const weekdayEn = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  if (sold > 0) {
    const openWeekdays = weekday_sales.slice(0, 6);
    const best = openWeekdays.indexOf(Math.max(...openWeekdays));
    const least = openWeekdays.indexOf(Math.min(...openWeekdays));
    patterns.push(
      `Sells most on ${weekdayEn[best]} (${WEEKDAY_NAMES_NP[best]}): ${weekday_sales[best]} pcs this month, least on ${weekdayEn[least]}.`,
    );
  } else {
    patterns.push(`No sales recorded in ${monthName} yet.`);
  }
  if (variationId === null) {
    const [topId, topQty] = [...perVariation.entries()].sort((a, b) => b[1] - a[1])[0] ?? [];
    if (topId !== undefined && topQty) {
      const top = variationOr404(topId);
      patterns.push(
        `${top.name} is the best seller: ${topQty} of ${sold} pcs (${Math.round((topQty / sold) * 100)}%) this month.`,
      );
    }
  } else if (sold > 0) {
    const name = variationOr404(variationId).name;
    patterns.push(`${name} sold ${sold} pcs this month, ${fixed1(avg_per_day)} per open day.`);
  }
  if (inStock <= 0) {
    patterns.push("Out of stock now. Record a purchase to keep selling.");
  } else if (days_left !== null) {
    const reorder = Math.min(...idList.map((id) => variationOr404(id).reorder_level));
    patterns.push(
      `Current stock lasts about ${days_left} days at this month's pace; reorder before it drops under ${reorder} pcs.`,
    );
  }
  const first = last_6_months[0];
  const change = percentChange(first.sold, sold);
  if (change !== null && first.month !== bsToday.month) {
    const direction = change > 0 ? "higher" : change < 0 ? "lower" : "the same as";
    patterns.push(
      change === 0
        ? `Monthly sales are the same as in ${first.label}.`
        : `Monthly sales are ${Math.abs(change)}% ${direction} than in ${first.label}.`,
    );
  }

  return {
    product_id: productId,
    variation_id: variationId,
    month_name: monthName,
    in_stock: inStock,
    purchased_this_month: purchased,
    sold_this_month: sold,
    avg_per_day,
    avg_per_week,
    avg_per_month,
    days_left,
    weekday_sales,
    last_6_months,
    patterns,
  };
}

export function readStockStats(): StockStatsData {
  const products = readProducts();
  const todays = state.movements.filter((m) => m.date_ad === today && m.type !== "opening");
  const purchases = todays.filter((m) => m.type === "purchase").length;
  return {
    variations: products.summary.variations,
    products: products.summary.products,
    below_reorder: products.summary.low + products.summary.out,
    entries_today: todays.length,
    purchases_today: purchases,
    consumptions_today: todays.length - purchases,
  };
}

export function readLowStock(): LowStockData {
  const since = addDays(today, -29);
  const rows: LowStockRow[] = [];
  for (const record of state.variations) {
    const variation = toVariation(record);
    if (variation.status === "ok") continue;
    const movements = movementsOf(record.id);
    const consumed30 = sum(
      movements
        .filter((m) => m.type === "consumption" && m.date_ad >= since)
        .map((m) => m.quantity),
    );
    const lastPurchase = movements
      .filter((m) => m.type === "purchase")
      .sort((a, b) => b.date_ad.localeCompare(a.date_ad) || b.id - a.id)[0];
    rows.push({
      variation_id: record.id,
      product_id: record.product_id,
      product_name: productOr404(record.product_id).name,
      variation_name: record.name,
      status: variation.status,
      in_stock: variation.in_stock,
      reorder_level: record.reorder_level,
      short_by: Math.max(0, record.reorder_level - variation.in_stock),
      days_left: daysLeft(variation.in_stock, consumed30 / 30),
      last_purchase_bs: lastPurchase ? formatBsIso(adToBs(lastPurchase.date_ad)) : null,
      last_purchase_qty: lastPurchase ? lastPurchase.quantity : null,
    });
  }
  rows.sort((a, b) => {
    if (a.status !== b.status) return a.status === "out" ? -1 : 1;
    return b.short_by - a.short_by || a.product_name.localeCompare(b.product_name);
  });
  return { rows };
}

export function readCurrentStock(query: string, page: number, pageSize: number): CurrentStockData {
  const rows = [];
  for (const record of state.variations) {
    const product = productOr404(record.product_id);
    if (!matchesSearch(query, product.name, record.name)) continue;
    const movements = movementsOf(record.id);
    const opening = sum(movements.filter((m) => m.type === "opening").map((m) => m.quantity));
    const purchased = sum(movements.filter((m) => m.type === "purchase").map((m) => m.quantity));
    const consumed = sum(movements.filter((m) => m.type === "consumption").map((m) => m.quantity));
    const in_stock = opening + purchased - consumed;
    rows.push({
      variation_id: record.id,
      product_id: record.product_id,
      product_name: product.name,
      variation_name: record.name,
      opening,
      purchased,
      consumed,
      in_stock,
      status: statusFor(in_stock, record.reorder_level),
    });
  }
  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  const current = Math.min(Math.max(1, page), pages);
  return {
    rows: rows.slice((current - 1) * pageSize, current * pageSize),
    total: rows.length,
    page: current,
    pages,
  };
}

// --------------------------------------------------------- mutations

function cleanName(value: string, field: string, what: string): string {
  const name = value.trim().replace(/\s+/g, " ");
  if (!name) throw new StockApiError(422, `Enter a ${what}`, field);
  return name;
}

export function writeProduct(request: CreateProductRequest): Product {
  const name = cleanName(request.name, "name", "product name");
  const duplicate = findDuplicateProduct(state.products, name);
  if (duplicate) {
    throw new StockApiError(
      409,
      `"${duplicate.name}" already exists. Open it from Items to add a variation instead.`,
      "name",
    );
  }
  const openingAd = bsOr422(request.opening_date_bs, "opening_date_bs");
  const names: string[] = [];
  // No variations listed = a single stock item (the popup's "save as a single item").
  const variations = request.variations.length === 0
    ? [{ name: "Standard", opening: 0, reorder_level: 5 }]
    : request.variations;
  for (const item of variations) {
    const vName = cleanName(item.name, "variations", "variation name");
    if (isDuplicateVariation(names, vName)) {
      throw new StockApiError(422, `"${vName}" is listed twice. Duplicates aren't allowed.`, "variations");
    }
    names.push(vName);
  }
  if (names.length === 0) {
    throw new StockApiError(422, "Add at least one variation", "variations");
  }
  const product: ProductRecord = {
    id: state.nextProductId++,
    name,
    variations_by: request.variations_by,
    unit: request.unit,
  };
  state.products.push(product);
  variations.forEach((item, index) => {
    const variation: VariationRecord = {
      id: state.nextVariationId++,
      product_id: product.id,
      name: names[index],
      reorder_level: Math.max(0, Math.floor(item.reorder_level)),
    };
    state.variations.push(variation);
    state.movements.push({
      id: state.nextMovementId++,
      variation_id: variation.id,
      type: "opening",
      quantity: Math.max(0, Math.floor(item.opening)),
      date_ad: openingAd,
      time: nowTime(),
      remarks: "Opening stock",
      entered_by: CURRENT_USER,
    });
  });
  return toProduct(product);
}

export function writeVariation(request: AddVariationRequest): Product {
  const product = productOr404(request.product_id);
  const name = cleanName(request.variation.name, "name", "variation name");
  const existing = variationsOf(product.id).map((x) => x.name);
  if (isDuplicateVariation(existing, name)) {
    throw new StockApiError(409, `"${name}" is already in this product. Duplicates aren't allowed.`, "name");
  }
  const openingAd = bsOr422(request.opening_date_bs, "opening_date_bs");
  const variation: VariationRecord = {
    id: state.nextVariationId++,
    product_id: product.id,
    name,
    reorder_level: Math.max(0, Math.floor(request.variation.reorder_level)),
  };
  state.variations.push(variation);
  state.movements.push({
    id: state.nextMovementId++,
    variation_id: variation.id,
    type: "opening",
    quantity: Math.max(0, Math.floor(request.variation.opening)),
    date_ad: openingAd,
    time: nowTime(),
    remarks: "Opening stock",
    entered_by: CURRENT_USER,
  });
  return toProduct(product);
}

export function patchVariation(id: number, request: UpdateVariationRequest): Variation {
  const variation = variationOr404(id);
  if (request.name !== undefined) {
    const name = cleanName(request.name, "name", "variation name");
    const others = variationsOf(variation.product_id)
      .filter((x) => x.id !== id)
      .map((x) => x.name);
    if (isDuplicateVariation(others, name)) {
      throw new StockApiError(409, `"${name}" is already in this product. Duplicates aren't allowed.`, "name");
    }
    variation.name = name;
  }
  if (request.reorder_level !== undefined) {
    variation.reorder_level = Math.max(0, Math.floor(request.reorder_level));
  }
  return toVariation(variation);
}

export function patchProduct(id: number, request: UpdateProductRequest): Product {
  const product = productOr404(id);
  if (request.name !== undefined) {
    const name = cleanName(request.name, "name", "product name");
    const duplicate = findDuplicateProduct(state.products, name, id);
    if (duplicate) {
      throw new StockApiError(409, `"${duplicate.name}" already exists.`, "name");
    }
    product.name = name;
  }
  if (request.variations_by !== undefined) product.variations_by = request.variations_by;
  if (request.unit !== undefined) product.unit = request.unit;
  return toProduct(product);
}

export function writeEntry(request: EntryRequest): EntryResponse {
  const dateAd = bsOr422(request.date_bs, "date_bs");
  if (request.date_ad && request.date_ad !== dateAd) {
    throw new StockApiError(422, "date_ad does not match date_bs", "date_ad");
  }
  if (request.type !== "purchase" && request.type !== "consumption") {
    throw new StockApiError(422, "type must be purchase or consumption", "type");
  }
  if (request.rows.length === 0) throw new StockApiError(422, "Add at least one row", "rows");
  const seen = new Set<number>();
  request.rows.forEach((row, index) => {
    variationOr404(row.variation_id);
    if (seen.has(row.variation_id)) {
      throw new StockApiError(422, `Row ${index + 1}: item is already in another row`, `rows.${index}`);
    }
    seen.add(row.variation_id);
    if (!Number.isInteger(row.qty) || row.qty <= 0) {
      throw new StockApiError(422, `Row ${index + 1}: quantity must be a whole number above 0`, `rows.${index}`);
    }
  });
  if (request.time != null && !/^([01]\d|2[0-3]):[0-5]\d$/.test(request.time)) {
    throw new StockApiError(422, "time must be HH:MM", "time");
  }
  const time = request.time ?? nowTime();
  const created: MovementRecord[] = request.rows.map((row) => ({
    id: state.nextMovementId++,
    variation_id: row.variation_id,
    type: request.type,
    quantity: row.qty,
    date_ad: dateAd,
    time,
    remarks: row.remark?.trim() || null,
    entered_by: CURRENT_USER,
  }));
  state.movements.push(...created);
  return { saved: created.map(toMovement), today: totalsOf(request.type) };
}
