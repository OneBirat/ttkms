import type { ReactElement } from "react";
import type { Widget } from "@/lib/api";
import { ATTENDANCE_WIDGETS } from "@/components/attendance/widgets";
import { PAYROLL_WIDGETS } from "@/app/people/_components/widgets";
import styles from "./widgets.module.css";

export type WidgetComponent = (props: { widget: Widget }) => ReactElement;

/** Dashboard widget renderers keyed by the API's `kind`. */
const WIDGETS: Record<string, WidgetComponent> = {
  ...ATTENDANCE_WIDGETS,
  ...PAYROLL_WIDGETS,
};

export function registerWidget(kind: string, component: WidgetComponent): void {
  WIDGETS[kind] = component;
}

function UnknownWidget({ widget }: { widget: Widget }) {
  return (
    <section className={`card ${styles.widget} ${styles.unknown}`}>
      <h2 className={styles.title}>{widget.title}</h2>
      <p className={styles.note}>
        Unknown widget <code className="mono">{widget.kind}</code>
      </p>
    </section>
  );
}

export function WidgetRenderer({ widget }: { widget: Widget }) {
  const Component = WIDGETS[widget.kind] ?? UnknownWidget;
  return <Component widget={widget} />;
}
