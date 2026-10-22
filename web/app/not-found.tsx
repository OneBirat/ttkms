import Link from "next/link";
import styles from "./not-found.module.css";

export default function NotFound() {
  return (
    <main id="main" className={styles.page}>
      <div className={`card ${styles.card}`}>
        <p className={styles.code}>404</p>
        <h1 className={styles.title}>Page not found</h1>
        <p className="muted">
          The page you asked for does not exist or has moved.
        </p>
        <Link href="/" className="btn btn--primary">
          Go to the dashboard
        </Link>
      </div>
    </main>
  );
}
