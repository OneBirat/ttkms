"use client";

import { Modal } from "@/components/ui/Modal";
import { PhotoFlow } from "./PhotoFlow";
import { setEmployeePhoto } from "./api";
import type { EmployeeProfile } from "./types";

export interface PhotoDialogProps {
  open: boolean;
  employee: EmployeeProfile;
  onClose: () => void;
}

/** "Use this device": the same capture flow as the phone page, in a popup. */
export function PhotoDialog({ open, employee, onClose }: PhotoDialogProps) {
  return (
    <Modal open={open} title={`Photo · ${employee.full_name}`} onClose={onClose} size="sm">
      <PhotoFlow
        key={open ? "open" : "closed"}
        employeeName={employee.full_name}
        currentPhoto={employee.photo_url}
        compact
        onSave={async (dataUrl) => {
          await setEmployeePhoto(employee.id, dataUrl);
        }}
        onDone={onClose}
        doneText={`${employee.full_name.split(" ")[0]}'s profile now shows the new photo.`}
      />
    </Modal>
  );
}
