"use client";

import { MarkDesktop } from "./MarkDesktop";
import { MarkMobile } from "./MarkMobile";
import { OvertimeModal } from "./OvertimeModal";
import { ScanCamera } from "./scan/ScanCamera";
import { ScanSheet } from "./scan/ScanSheet";
import { useMarkState } from "./useMarkState";
import { PHONE_QUERY, useMediaQuery } from "./useMediaQuery";

/**
 * Mark attendance (/attendance/mark). One state hook, two layouts: the desktop
 * table (design/attendance/AttendanceMark.dc.html) and, under 640px, the phone
 * screen (AttendanceMarkMobile.dc.html). The overtime-hours pop-up, the camera
 * scanner and the scan sheets are shared by both.
 */
export function MarkPage() {
  const phone = useMediaQuery(PHONE_QUERY);
  const state = useMarkState({ phone });
  const otRow = state.otModal
    ? state.data?.rows.find((r) => r.employee.id === state.otModal?.employeeId)
    : undefined;

  return (
    <>
      {phone ? <MarkMobile state={state} /> : <MarkDesktop state={state} />}
      {state.otModal ? (
        <OvertimeModal
          name={otRow?.employee.name ?? ""}
          hours={state.otModal.hours}
          onHours={state.setOvertimeHours}
          onCancel={state.cancelOvertime}
          onSave={state.saveOvertime}
        />
      ) : null}
      {state.scan?.step === "camera" ? <ScanCamera state={state} /> : null}
      {state.scan && state.scan.step !== "camera" && state.scan.step !== "lookup" ? (
        <ScanSheet state={state} phone={phone} />
      ) : null}
    </>
  );
}
