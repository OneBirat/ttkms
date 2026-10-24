"use client";

import { Suspense, useEffect, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Icon } from "@/components/icons";
import {
  ApiError,
  apiFetch,
  safeNextPath,
  type AuthResponse,
  type ChangePasswordRequest,
  type ModulesResponse,
} from "@/lib/api";
import { homePath } from "@/lib/modules";
import styles from "../login/login.module.css";

/* First sign-in after an admin created the account or reset its password:
   the temporary password must be replaced before the app opens. Same dark
   page and card as the sign-in screen (design/final/Login.dc.html). */

const MIN_LENGTH = 8;

function Brand() {
  return (
    <div className={styles.brand}>
      <span className={styles.tile} aria-hidden="true">
        TT
      </span>
      <span className={styles.brandText}>
        <span className={styles.brandName}>TTK Attendance</span>
        <span className={styles.brandSub}>Attendance &amp; payroll</span>
      </span>
    </div>
  );
}

async function landingPath(next: string | null): Promise<string> {
  if (next) return safeNextPath(next);
  try {
    const modules = await apiFetch<ModulesResponse>("/api/core/modules", {
      redirectOn401: false,
    });
    return homePath(modules.nav);
  } catch {
    return "/";
  }
}

function SetPasswordForm() {
  const router = useRouter();
  const params = useSearchParams();
  const nextParam = params.get("next");

  const [name, setName] = useState<string | null>(null);
  const [forced, setForced] = useState(true);
  const [current, setCurrent] = useState("");
  const [fresh, setFresh] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Who is signing in (and whether the change is still required at all).
  useEffect(() => {
    apiFetch<AuthResponse>("/api/auth/me")
      .then((session) => {
        setName(session.user.full_name);
        setForced(session.user.must_change_password);
      })
      .catch(() => {
        // A 401 already sent the user to /login.
      });
  }, []);

  const tooShort = fresh.length > 0 && fresh.length < MIN_LENGTH;
  const mismatch = confirm.length > 0 && confirm !== fresh;
  const canSubmit =
    current.length > 0 && fresh.length >= MIN_LENGTH && confirm === fresh && !submitting;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    const payload: ChangePasswordRequest = {
      current_password: current,
      new_password: fresh,
    };
    try {
      await apiFetch<AuthResponse>("/api/auth/change-password", {
        method: "POST",
        json: payload,
      });
      router.replace(await landingPath(nextParam));
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.detail
          : "Could not reach the server. Check the connection and try again.",
      );
      setSubmitting(false);
    }
  }

  return (
    <form className={styles.card} onSubmit={onSubmit} noValidate>
      <h1 className={styles.title}>{forced ? "Set your password" : "Change password"}</h1>
      <p className={styles.note} style={{ textAlign: "left" }}>
        {forced
          ? `${name ? `${name}, the` : "The"} temporary password you were given works only once. Choose your own password (at least ${MIN_LENGTH} characters) to continue.`
          : `Choose a new password of at least ${MIN_LENGTH} characters.`}
      </p>
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
      <div className={styles.group}>
        <label htmlFor="pw-current" className={styles.label}>
          {forced ? "Temporary password" : "Current password"}
        </label>
        <div className={styles.field}>
          <input
            id="pw-current"
            name="current_password"
            type={show ? "text" : "password"}
            autoComplete="current-password"
            required
            autoFocus
            value={current}
            onChange={(event) => setCurrent(event.target.value)}
          />
        </div>
      </div>
      <div className={styles.group}>
        <label htmlFor="pw-new" className={styles.label}>
          New password
        </label>
        <div className={styles.field}>
          <input
            id="pw-new"
            name="new_password"
            type={show ? "text" : "password"}
            autoComplete="new-password"
            minLength={MIN_LENGTH}
            required
            aria-invalid={tooShort || undefined}
            aria-describedby="pw-new-hint"
            value={fresh}
            onChange={(event) => setFresh(event.target.value)}
          />
          <button
            type="button"
            className={styles.eye}
            aria-label={show ? "Hide passwords" : "Show passwords"}
            aria-pressed={show}
            onClick={() => setShow((value) => !value)}
          >
            <Icon name={show ? "eye-off" : "eye"} />
          </button>
        </div>
        <span id="pw-new-hint" className={styles.note} style={{ textAlign: "left" }}>
          {tooShort ? `At least ${MIN_LENGTH} characters.` : `${MIN_LENGTH} characters or more.`}
        </span>
      </div>
      <div className={styles.group}>
        <label htmlFor="pw-confirm" className={styles.label}>
          Confirm new password
        </label>
        <div className={styles.field}>
          <input
            id="pw-confirm"
            name="confirm_password"
            type={show ? "text" : "password"}
            autoComplete="new-password"
            required
            aria-invalid={mismatch || undefined}
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
          />
        </div>
        {mismatch ? (
          <span className={styles.error} role="alert">
            The two passwords do not match.
          </span>
        ) : null}
      </div>
      <button type="submit" className={styles.submit} disabled={!canSubmit}>
        {submitting ? "Saving…" : "Save password and continue"}
      </button>
    </form>
  );
}

export default function SetPasswordPage() {
  return (
    <main id="main" className={styles.page}>
      <div className={styles.column}>
        <Brand />
        <Suspense
          fallback={
            <p className={styles.loading} role="status">
              Loading…
            </p>
          }
        >
          <SetPasswordForm />
        </Suspense>
      </div>
    </main>
  );
}
