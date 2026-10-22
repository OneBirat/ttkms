"use client";

import { useState } from "react";
import { Icon } from "@/components/icons";
import type { OneTimePassword } from "../types";
import styles from "./admin.module.css";

export function OneTimePasswordBox({ otp }: { otp: OneTimePassword }) {
  const [copied, setCopied] = useState<"idle" | "done" | "failed">("idle");

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(otp.password);
      setCopied("done");
    } catch {
      setCopied("failed");
    }
    setTimeout(() => setCopied("idle"), 2500);
  };

  return (
    <div className={styles.form}>
      <p>
        One-time password for <strong>{otp.username}</strong>. It is shown only now.
      </p>
      <div className={styles.otp}>
        <code className={styles.otpValue} aria-label="One-time password">
          {otp.password}
        </code>
        <button type="button" className="btn" onClick={() => void copy()}>
          {copied === "done" ? <Icon name="check" size={18} /> : null}
          {copied === "done" ? "Copied" : copied === "failed" ? "Copy failed" : "Copy"}
        </button>
      </div>
      <p className={styles.note}>They set their own password at first sign-in.</p>
    </div>
  );
}
