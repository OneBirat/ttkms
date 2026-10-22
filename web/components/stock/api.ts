/**
 * Stock API client. Pages and widgets call only these functions, so the mock
 * implementation below can be swapped for `apiFetch` calls without touching
 * a page. Each function documents the endpoint the backend session must
 * implement (all under /api/stock, session cookie + X-CSRF-Token as usual).
 *
 * TODO(backend): replace the mock bodies with apiFetch<T>(...) once the
 * endpoints exist, and delete mockData.ts.
 */

import * as mock from "./mockData";
import type {
  AddVariationRequest,
  CalendarMonth,
  CreateProductRequest,
  CurrentStockData,
  DailyHistory,
  EntryRequest,
  EntryResponse,
  EntryType,
  LowStockData,
  Product,
  ProductListResponse,
  ProductStats,
  ReportFilter,
  ReportResponse,
  StockItemsResponse,
  StockStatsData,
  StockToday,
  TodayEntries,
  UpdateProductRequest,
  UpdateVariationRequest,
  Variation,
} from "./types";

/** Simulated network delay so loading states are exercised; 0 in tests. */
let latencyMs = 120;

export function setMockLatency(ms: number): void {
  latencyMs = ms;
}

function respond<T>(produce: () => T): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const run = () => {
      try {
        // Structured clone: callers never share references with the store.
        resolve(structuredClone(produce()));
      } catch (error) {
        reject(error);
      }
    };
    if (latencyMs > 0) setTimeout(run, latencyMs);
    else run();
  });
}

/** GET /api/stock/today -> StockToday (BS + AD for the shop's clock). */
export function getToday(): Promise<StockToday> {
  return respond(() => mock.readToday());
}

/** GET /api/stock/products -> ProductListResponse (products with variations + summary). */
export function listProducts(): Promise<ProductListResponse> {
  return respond(() => mock.readProducts());
}

/** GET /api/stock/products/{id} -> Product. 404 when unknown. */
export function getProduct(id: number): Promise<Product> {
  return respond(() => mock.readProduct(id));
}

/** POST /api/stock/products  CreateProductRequest -> Product. 409 on duplicate name (field "name"). */
export function createProduct(request: CreateProductRequest): Promise<Product> {
  return respond(() => mock.writeProduct(request));
}

/** PATCH /api/stock/products/{id}  UpdateProductRequest -> Product. */
export function updateProduct(id: number, request: UpdateProductRequest): Promise<Product> {
  return respond(() => mock.patchProduct(id, request));
}

/** POST /api/stock/products/{id}/variations  AddVariationRequest -> Product. 409 on duplicate. */
export function addVariation(request: AddVariationRequest): Promise<Product> {
  return respond(() => mock.writeVariation(request));
}

/** PATCH /api/stock/variations/{id}  UpdateVariationRequest -> Variation. */
export function updateVariation(id: number, request: UpdateVariationRequest): Promise<Variation> {
  return respond(() => mock.patchVariation(id, request));
}

/** GET /api/stock/products/{id}/stats?variation_id= -> ProductStats. */
export function getProductStats(productId: number, variationId: number | null): Promise<ProductStats> {
  return respond(() => mock.readProductStats(productId, variationId));
}

/** GET /api/stock/products/{id}/calendar?year=&month=&variation_id= -> CalendarMonth. */
export function getCalendarMonth(
  productId: number,
  variationId: number | null,
  year: number,
  month: number,
): Promise<CalendarMonth> {
  return respond(() => mock.readCalendarMonth(productId, variationId, year, month));
}

/** GET /api/stock/products/{id}/history?days=30&variation_id= -> DailyHistory. */
export function getDailyHistory(
  productId: number,
  variationId: number | null,
  days: number,
): Promise<DailyHistory> {
  return respond(() => mock.readDailyHistory(productId, variationId, days));
}

/**
 * GET /api/stock/items?search=&exclude_ids=1,2 -> StockItemsResponse.
 * Server-side word search ("cooker 3") with current stock; `exclude_ids`
 * hides variations already used in other rows of the form.
 */
export function listItems(search: string, excludeIds: number[] = []): Promise<StockItemsResponse> {
  return respond(() => mock.readItems(search, excludeIds));
}

/**
 * POST /api/stock/entries  EntryRequest -> EntryResponse. All rows or none.
 * 422 (field "rows.N") for a duplicate variation_id in one entry or qty <= 0.
 */
export function saveEntry(request: EntryRequest): Promise<EntryResponse> {
  return respond(() => mock.writeEntry(request));
}

/** GET /api/stock/entries/today?type=purchase|consumption (optional) -> TodayEntries. */
export function getTodayEntries(type: EntryType | null = null): Promise<TodayEntries> {
  return respond(() => mock.readTodayEntries(type));
}

/** GET /api/stock/report?from_bs=&to_bs=&product_id=&variation_id=&type=&page=&page_size= -> ReportResponse. */
export function getReport(filter: ReportFilter): Promise<ReportResponse> {
  return respond(() => mock.readReport(filter));
}

/** Dashboard widget data: GET /api/dashboard returns these as widget.data (kinds below). */

/** kind "stock_stats" -> StockStatsData */
export function getStockStats(): Promise<StockStatsData> {
  return respond(() => mock.readStockStats());
}

/** kind "stock_low" -> LowStockData (also GET /api/stock/low). */
export function getLowStock(): Promise<LowStockData> {
  return respond(() => mock.readLowStock());
}

/** kind "stock_current" -> CurrentStockData (also GET /api/stock/current?q=&page=&page_size=). */
export function getCurrentStock(query: string, page: number, pageSize = 10): Promise<CurrentStockData> {
  return respond(() => mock.readCurrentStock(query, page, pageSize));
}
