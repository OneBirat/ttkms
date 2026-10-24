"use client";

import { MarkDesktop } from "./MarkDesktop";
import { MarkMobile } from "./MarkMobile";
import { OvertimeModal } from "./OvertimeModal";
import { SavedModal } from "./SavedModal";
import { ScanCamera } from "./scan/ScanCamera";
import { isListOrigin, isSheetStep } from "./scan/scanFlow";
import { ScanSheet } from "./scan/ScanSheet";
import { useMarkState } from "./useMarkState";
import { PHONE_QUERY, useMediaQuery } from "./useMediaQuery";

/**
 * Mark attendance (/attendance/mark). One state hook, two layouts: the desktop
 * table (design/final/AttendanceMark.dc.html) and, under 640px, the phone
 * screen (AttendanceMarkMobile.dc.html). The overtime-hours pop-up, the camera
 * scanner and the scan sheets are shared by both; the calendar sheet, ⋮ action
 * sheet, "Mark as …?" question and the 3 s saved sheet are phone only, the
 * "Saved as" pop-up is desktop only.
 */
export function MarkPage() {
  const phone = useMediaQuery(PHONE_QUERY);
  const state = useMarkState({ phone });
  const rowOf = (id: number | undefined) => (id === undefined ? undefined : state.data?.rows.find((r) => r.employee.id === id));
  const otRow = rowOf(state.otModal?.employeeId);
  const savedRow = rowOf(state.saved?.employeeId);

  return (
    <>
      {phone ? <MarkMobile state={state} /> : <MarkDesktop state={state} />}
      {!phone && state.saved && savedRow ? (
        <SavedModal
          saved={state.saved}
          employee={savedRow.employee}
          onEdit={state.savedEdit}
          onChange={state.savedChange}
          onClose={state.savedClose}
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
      {phone && state.scan && !isListOrigin(state.scan) ? <ScanCamera state={state} /> : null}
      {isSheetStep(state.scan?.step) ? <ScanSheet state={state} phone={phone} /> : null}
    </>
  );
}
