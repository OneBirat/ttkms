"use client";

import { Suspense, useEffect, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ApiError,
  apiFetch,
  ensureCsrf,
  safeNextPath,
  type AuthResponse,
  type LoginRequest,
} from "@/lib/api";
import styles from "./login.module.css";

function Brand() {
  return (
    <div className={styles.brand}>
      <span className={styles.tile} aria-hidden="true">
        TT
      </span>
      <span className={styles.brandText}>
        <span className={styles.brandName}>TTK Stock</span>
        <span className={styles.brandSub}>Stock &amp; attendance</span>
      </span>
    </div>
  );
}

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const nextPath = safeNextPath(params.get("next"));

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Establish the session cookie + CSRF token before the first POST.
  useEffect(() => {
    ensureCsrf().catch(() => {
      // Retried automatically by apiFetch when the form is submitted.
    });
  }, []);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    const payload: LoginRequest = { username, password, remember };
    try {
      await apiFetch<AuthResponse>("/api/auth/login", {
        method: "POST",
        json: payload,
        redirectOn401: false,
      });
      router.replace(nextPath);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 403) {
          // CSRF token rejected (stale session): fetch a fresh one for the retry.
          await ensureCsrf(true).catch(() => undefined);
        }
        setError(err.detail);
      } else {
        setError("Could not reach the server. Check the connection and try again.");
      }
      setSubmitting(false);
    }
  }

  return (
    <form className={styles.form} onSubmit={onSubmit} noValidate>
      <div className={styles.field}>
        <label htmlFor="login-username" className="label">
          Username
        </label>
        <input
          id="login-username"
          name="username"
          type="text"
          className="input"
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          required
          autoFocus
          value={username}
          onChange={(event) => setUsername(event.target.value)}
        />
      </div>
      <div className={styles.field}>
        <label htmlFor="login-password" className="label">
          Password
        </label>
        <input
          id="login-password"
          name="password"
          type="password"
          className="input"
          autoComplete="current-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      </div>
      <label className={styles.checkbox} htmlFor="login-remember">
        <input
          id="login-remember"
          name="remember"
          type="checkbox"
          checked={remember}
          onChange={(event) => setRemember(event.target.checked)}
        />
        Keep me signed in
      </label>
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
      <button
        type="submit"
        className={`btn btn--primary ${styles.submit}`}
        disabled={submitting}
      >
        {submitting ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <main id="main" className={styles.page}>
      <div className={`card ${styles.card}`}>
        <Brand />
        <h1 className={styles.title}>Sign in</h1>
        <Suspense
          fallback={
            <p className="muted" role="status">
              Loading…
            </p>
          }
        >
          <LoginForm />
        </Suspense>
      </div>
    </main>
  );
}
