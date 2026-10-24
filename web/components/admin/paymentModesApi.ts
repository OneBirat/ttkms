/** Payment modes: /api/admin/payment-modes (app/modules/admin). */

import { apiFetch } from "@/lib/api";
import type { PaymentMode, PaymentModeInput } from "./types";

export function listPaymentModes(activeOnly = false): Promise<PaymentMode[]> {
  return apiFetch<PaymentMode[]>(`/api/admin/payment-modes${activeOnly ? "?active=1" : ""}`);
}

export function createPaymentMode(input: PaymentModeInput): Promise<PaymentMode> {
  return apiFetch<PaymentMode>("/api/admin/payment-modes", { method: "POST", json: input });
}

export function updatePaymentMode(id: number, input: PaymentModeInput): Promise<PaymentMode> {
  return apiFetch<PaymentMode>(`/api/admin/payment-modes/${id}`, { method: "PUT", json: input });
}

export function setPaymentModeActive(id: number, active: boolean): Promise<PaymentMode> {
  return apiFetch<PaymentMode>(`/api/admin/payment-modes/${id}/active`, {
    method: "POST",
    json: { active },
  });
}
