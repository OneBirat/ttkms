"use client";

import { ActionSheet } from "./ActionSheet";
import { AskModal } from "./AskModal";
import { ClearMarkModal } from "./ClearMarkModal";
import { ManualDoneSheet } from "./ManualDoneSheet";
import { MarkDesktop } from "./MarkDesktop";
import { MarkMobile } from "./MarkMobile";
import { OvertimeModal } from "./OvertimeModal";
import { SavedModal } from "./SavedModal";
import { ScanCamera } from "./scan/ScanCamera";
import { isListOrigin, isSheetStep } from "./scan/scanFlow";
import { ScanSheet } from "./scan/ScanSheet";
import { useMarkState } from "./useMarkState";
import { BSDatePicker } from "@/components/date";
import { PHONE_QUERY, useMediaQuery } from "@/lib/useMediaQuery";

/**
 * Mark attendance (/attendance/mark). One state hook, two layouts: the desktop
 * table (design/final/AttendanceMark.dc.html) and, under 640px, the phone
 * screen (AttendanceMarkMobile.dc.html). The overtime-hours pop-up, the camera
 * scanner and the scan sheets are shared by both; the date picker sheet, ⋮ action
 * sheet, "Mark as …?" question and the 3 s saved sheet are phone only, the
 * "Saved as" pop-up is desktop only.
 */
export function MarkPage() {
  const phone = useMediaQuery(PHONE_QUERY);
  const state = useMarkState({ phone });
  const rowOf = (id: number | undefined) => (id === undefined ? undefined : state.data?.rows.find((r) => r.employee.id === id));
  const otRow = rowOf(state.otModal?.employeeId);
  const savedRow = rowOf(state.saved?.employeeId);
  const askRow = rowOf(state.ask?.employeeId);
  const doneRow = rowOf(state.manualDone?.employeeId);
  const actionRow = rowOf(state.action ?? undefined);
  const clearRow = rowOf(state.clearAsk?.employeeId);

  return (
    <>
      {phone ? <MarkMobile state={state} /> : <MarkDesktop state={state} />}
      {!phone && state.saved && savedRow ? (
        <SavedModal
          saved={state.saved}
          employee={savedRow.employee}
          onEdit={state.savedEdit}
          onChange={state.savedChange}
          onClear={() => state.askClear(state.saved!.employeeId)}
          onClose={state.savedClose}
        />
      ) : null}
      {phone && state.calendarOpen && state.today ? (
        <BSDatePicker
          open
          value={state.date}
          noFutureDays
          markedDays={state.markedDays}
          markedLabel="attendance marked"
          title="Choose date"
          onChange={(bs) => {
            state.setDate(bs);
            state.setCalendarOpen(false);
          }}
          onClose={() => state.setCalendarOpen(false)}
        />
      ) : null}
      {phone && actionRow ? (
        <ActionSheet
          employee={actionRow.employee}
          current={state.draftOf(actionRow)}
          onOvertime={() => {
            state.closeAction();
            state.openOvertime(actionRow.employee.id);
          }}
          onPayments={() => state.openPayments(actionRow.employee.id)}
          onCalendar={() => state.openAttendanceRecord(actionRow.employee.id)}
          onChange={(status) => {
            state.closeAction();
            state.askStatus(actionRow.employee.id, status);
          }}
          onClear={() => state.askClear(actionRow.employee.id)}
          canPay={state.canPay}
          onClose={state.closeAction}
        />
      ) : null}
      {phone && state.ask && askRow ? (
        <AskModal ask={state.ask} employee={askRow.employee} onConfirm={state.askConfirm} onCancel={state.askCancel} />
      ) : null}
      {state.clearAsk && clearRow ? (
        <ClearMarkModal
          ask={state.clearAsk}
          employee={clearRow.employee}
          weeklyOff={state.data?.day.is_weekly_off ?? false}
          onConfirm={state.clearConfirm}
          onCancel={state.clearCancel}
        />
      ) : null}
      {state.otModal ? (
        <OvertimeModal
          name={otRow?.employee.name ?? ""}
          hours={state.otModal.hours}
          onHours={state.setOvertimeHours}
          onCancel={state.cancelOvertime}
          onSave={state.saveOvertime}
        />
      ) : null}
      {phone && state.manualDone && doneRow ? (
        <ManualDoneSheet done={state.manualDone} employee={doneRow.employee} onClose={state.manualDoneClose} />
      ) : null}
      {phone && state.scan && !isListOrigin(state.scan) ? <ScanCamera state={state} /> : null}
      {isSheetStep(state.scan?.step) ? <ScanSheet state={state} phone={phone} /> : null}
    </>
  );
}
