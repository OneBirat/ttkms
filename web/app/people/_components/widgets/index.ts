/**
 * Payroll dashboard widgets, keyed by the API's widget `kind`; spread into the
 * shared registry in web/components/widgets/index.tsx.
 */

import { PaymentsTodayWidget } from "./PaymentsTodayWidget";

export { PaymentsTodayWidget };

export const PAYROLL_WIDGETS = {
  payments_today: PaymentsTodayWidget,
} as const;
