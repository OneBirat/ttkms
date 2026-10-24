import { initials } from "./helpers";
import styles from "./payroll.module.css";

export interface AvatarProps {
  name: string;
  photoUrl: string | null;
  size?: number;
  tone?: "default" | "selected" | "profile";
  className?: string;
}

/** Photo (object-fit cover) or initials in a circle, with alt text. */
export function Avatar({ name, photoUrl, size = 34, tone = "default", className }: AvatarProps) {
  const cls = className ? `${styles.avatar} ${className}` : styles.avatar;
  const style = { width: size, height: size, fontSize: Math.max(11, Math.round(size * 0.34)) };
  if (photoUrl) {
    return (
      <span className={cls} data-tone={tone} style={style}>
        {/* eslint-disable-next-line @next/next/no-img-element -- data: URLs from the capture flow */}
        <img src={photoUrl} alt={`Photo of ${name}`} width={size} height={size} />
      </span>
    );
  }
  return (
    <span className={cls} data-tone={tone} style={style} role="img" aria-label={`${name}, no photo`}>
      {initials(name)}
    </span>
  );
}
