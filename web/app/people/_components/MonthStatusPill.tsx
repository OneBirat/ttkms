import { Icon } from "@/components/icons";
import { Pill } from "@/components/ui/Pill";
import { monthStatusText } from "../_lib/settle";
import { statusPill } from "../_lib/helpers";
import type { MonthLedger } from "../types";
import shared from "./payroll.module.css";

/** Pending · Part paid · tick + "Cleared Kartik 8" (the salary ledger and the Salary report). */
export function MonthStatusPill({ ledger }: { ledger: Pick<MonthLedger, "status" | "due" | "cleared_on"> }) {
  if (ledger.status === "pending") return <span className={shared.pillNeutral}>Pending</span>;
  if (ledger.due === 0 && ledger.cleared_on) {
    return (
      <span className={shared.pillCleared}>
        <Icon name="check" size={12} />
        {monthStatusText(ledger)}
      </span>
    );
  }
  return <Pill status={statusPill(ledger.status)} label={monthStatusText(ledger)} />;
}
