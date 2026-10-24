"use client";

import { Suspense, useEffect, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Icon } from "@/components/icons";
import {
  ApiError,
  apiFetch,
  ensureCsrf,
  safeNextPath,
  type AuthResponse,
  type LoginRequest,
  type ModulesResponse,
} from "@/lib/api";
import { homePath } from "@/lib/modules";
import styles from "./login.module.css";

/* Sign-in screen from docs/design/Login.dc.html: dark page, brand block above
   a white card with username, password (show/hide), "Keep me signed in". */

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

/**
 * Where to go after signing in: the `next` query value when the user was sent
 * here from a page, otherwise the first page of the first module they may see
 * (Attendance while stock is paused). Falls back to the dashboard.
 */
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

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const nextParam = params.get("next");

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
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
      router.replace(await landingPath(nextParam));
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
    <form className={styles.card} onSubmit={onSubmit} noValidate>
      <h1 className={styles.title}>Sign in</h1>
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
      <div className={styles.group}>
        <label htmlFor="login-username" className={styles.label}>
          Phone or username
        </label>
        <div className={styles.field}>
          <input
            id="login-username"
            name="username"
            type="text"
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
      </div>
      <div className={styles.group}>
        <label htmlFor="login-password" className={styles.label}>
          Password
        </label>
        <div className={styles.field}>
          <input
            id="login-password"
            name="password"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          <button
            type="button"
            className={styles.eye}
            aria-label={showPassword ? "Hide password" : "Show password"}
            aria-pressed={showPassword}
            onClick={() => setShowPassword((value) => !value)}
          >
            <Icon name={showPassword ? "eye-off" : "eye"} />
          </button>
        </div>
      </div>
      <label className={styles.remember} htmlFor="login-remember">
        <input
          id="login-remember"
          name="remember"
          type="checkbox"
          checked={remember}
          onChange={(event) => setRemember(event.target.checked)}
        />
        Keep me signed in on this device
      </label>
      <button type="submit" className={styles.submit} disabled={submitting}>
        {submitting ? "Signing in…" : "Sign in"}
      </button>
      <p className={styles.note}>Forgot your password? Ask an admin to reset it.</p>
    </form>
  );
}

export default function LoginPage() {
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
          <LoginForm />
        </Suspense>
      </div>
    </main>
  );
}
