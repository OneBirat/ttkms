"use client";

import Link from "next/link";
import { Modal } from "@/components/ui/Modal";
import { Barcode, downloadBarcodePng } from "./Barcode";
import type { Employee } from "../types";
import styles from "./employees.module.css";
import shared from "./payroll.module.css";

export interface BarcodeDialogProps {
  open: boolean;
  employee: Employee;
  onClose: () => void;
}

/** "View barcode": the Code 128 sticker value, large, with Download PNG. */
export function BarcodeDialog({ open, employee, onClose }: BarcodeDialogProps) {
  return (
    <Modal open={open} title="Employee barcode" onClose={onClose} size="sm">
      <div className={shared.stack}>
        <div className={styles.barcodeStage}>
          <div className={styles.barcodeSticker}>
            <Barcode value={employee.barcode} label={`Barcode ${employee.barcode} for ${employee.full_name}`} unit={3} height={72} className={styles.barcodeBig} />
            <span className={styles.barcodeValue}>{employee.barcode}</span>
            <span className={styles.barcodeName} style={{ fontSize: 16, fontWeight: 700 }}>
              {employee.full_name}
            </span>
          </div>
        </div>
        <p className={shared.note} style={{ fontSize: 13, lineHeight: 1.5 }}>
          Code 128 · made automatically from the employee ID when the employee is added. Stickers are printed by
          an admin from <Link href="/admin/barcodes">Admin › Barcodes</Link>; scanning one marks attendance.
        </p>
        <div className={shared.footerButtons}>
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => downloadBarcodePng(employee.barcode, employee.full_name, `${employee.barcode}.png`)}
          >
            Download PNG
          </button>
        </div>
      </div>
    </Modal>
  );
}
