"use client";

import Link from "next/link";
import { Icon } from "@/components/icons";
import { PhotoFlow } from "./PhotoFlow";
import { resolvePhotoToken, uploadPhotoByToken } from "../api";
import { payrollErrorMessage, usePayroll } from "../_lib/usePayroll";
import styles from "./photo.module.css";

/** /people/photo/[token]: mobile-first, no sidebar. */
export function PhotoCaptureScreen({ token }: { token: string }) {
  const info = usePayroll(() => resolvePhotoToken(token), [token]);
  const employee = info.data?.employee ?? null;

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <Link
          href={employee ? `/people/employees/${employee.id}` : "/people/employees"}
          aria-label="Back to employee"
          className={styles.back}
        >
          <Icon name="chevron-left" size={22} />
        </Link>
        <div className={styles.headerText}>
          <span className={styles.headerTitle}>Employee photo</span>
          <span className={styles.headerSub}>
            {employee ? `${employee.full_name} · ${employee.code}` : "TTK"}
          </span>
        </div>
      </header>
      {info.error ? (
        <div className={styles.status} role="alert">
          <p className={styles.error}>{payrollErrorMessage(info.error)}</p>
          <p className={styles.guide}>
            Open the employee on the computer and scan the new QR code shown there.
          </p>
        </div>
      ) : !employee ? (
        <div className={styles.status} role="status">
          <p className={styles.guide}>Opening…</p>
        </div>
      ) : (
        <PhotoFlow
          key={employee.id}
          employeeName={employee.full_name}
          currentPhoto={employee.photo_url}
          onSave={async (dataUrl) => {
            await uploadPhotoByToken(token, dataUrl);
          }}
          onDone={() => {
            window.location.assign(`/people/employees/${employee.id}`);
          }}
        />
      )}
    </div>
  );
}
