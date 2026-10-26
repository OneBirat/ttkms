import { initials } from "./helpers";
import type { EmployeeRef } from "./types";

/**
 * What goes inside an attendance avatar circle: the employee's 128 px photo thumbnail when there
 * is one (versioned URL, cached by the browser), else their initials. The circle (size, tint,
 * status colour) stays the caller's span.
 */
export function FaceContent({ employee }: { employee: Pick<EmployeeRef, "name" | "photo_url"> }) {
  if (!employee.photo_url) return <>{initials(employee.name)}</>;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- authenticated API image, no optimiser
    <img
      src={employee.photo_url}
      alt=""
      loading="lazy"
      decoding="async"
      style={{ display: "block", width: "100%", height: "100%", objectFit: "cover", borderRadius: "inherit" }}
    />
  );
}
