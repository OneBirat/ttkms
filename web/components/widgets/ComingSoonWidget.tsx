import { Pill } from "@/components/ui/Pill";
import type { Widget } from "@/lib/api";
import styles from "./widgets.module.css";

export function ComingSoonWidget({ widget }: { widget: Widget }) {
  const note = typeof widget.data.note === "string" ? widget.data.note : "";
  return (
    <section className={`card ${styles.widget}`} aria-label={widget.title}>
      <div className={styles.head}>
        <h2 className={styles.title}>{widget.title}</h2>
        <Pill status="neutral" label="Coming soon" />
      </div>
      {note ? <p className={styles.note}>{note}</p> : null}
    </section>
  );
}
