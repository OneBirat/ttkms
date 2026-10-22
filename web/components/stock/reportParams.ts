import type { MovementType, ReportFilter } from "./types";

export interface ReportForm {
  from_bs: string;
  to_bs: string;
  product_id: number | null;
  variation_id: number | null;
  type: MovementType | null;
  show_ad: boolean;
}

export const PAGE_SIZE = 25;

/** Query string for the print route / bookmarkable filters. */
export function reportQuery(form: ReportForm, extra: Record<string, string> = {}): string {
  const params = new URLSearchParams({
    from: form.from_bs,
    to: form.to_bs,
    product: form.product_id ? String(form.product_id) : "",
    variation: form.variation_id ? String(form.variation_id) : "",
    type: form.type ?? "",
    ad: form.show_ad ? "1" : "0",
    ...extra,
  });
  return params.toString();
}

export function reportFormFromParams(get: (key: string) => string | null, fallback: ReportForm): ReportForm {
  const type = get("type");
  return {
    from_bs: get("from") || fallback.from_bs,
    to_bs: get("to") || fallback.to_bs,
    product_id: Number(get("product")) || null,
    variation_id: Number(get("variation")) || null,
    type: type === "purchase" || type === "consumption" || type === "opening" ? type : null,
    show_ad: get("ad") !== "0",
  };
}

export function toFilter(form: ReportForm, page: number, pageSize = PAGE_SIZE): ReportFilter {
  return {
    from_bs: form.from_bs,
    to_bs: form.to_bs,
    product_id: form.product_id,
    variation_id: form.variation_id,
    type: form.type,
    page,
    page_size: pageSize,
  };
}
