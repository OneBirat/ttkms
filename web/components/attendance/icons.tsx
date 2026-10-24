import type { SVGProps } from "react";

type Props = Omit<SVGProps<SVGSVGElement>, "name"> & { size?: number };

function Svg({ size = 18, children, ...rest }: Props) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

/** Staff-card barcode (design/attendance/*.dc.html). */
export function ScanIcon(props: Props) {
  return (
    <Svg {...props}>
      <path d="M4 7V5a1 1 0 011-1h2M17 4h2a1 1 0 011 1v2M20 17v2a1 1 0 01-1 1h-2M7 20H5a1 1 0 01-1-1v-2M7 8v8M10 8v8M13 8v8M16 8v8" />
    </Svg>
  );
}

export function SearchIcon(props: Props) {
  return (
    <Svg size={16} {...props}>
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" />
    </Svg>
  );
}

export function CalendarIcon(props: Props) {
  return (
    <Svg size={16} {...props}>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </Svg>
  );
}

export function MenuIcon(props: Props) {
  return (
    <Svg size={22} {...props}>
      <path d="M4 7h16M4 12h16M4 17h16" />
    </Svg>
  );
}

export function CheckIcon(props: Props) {
  return (
    <Svg strokeWidth="2.6" {...props}>
      <path d="M5 12l5 5L19 7" />
    </Svg>
  );
}

export function TorchIcon(props: Props) {
  return (
    <Svg size={20} {...props}>
      <path d="M9 2h6l-1 7h-4zM10 9h4v13h-4z" />
    </Svg>
  );
}

export function ChevronDownIcon(props: Props) {
  return (
    <Svg size={14} {...props}>
      <path d="M6 9l6 6 6-6" />
    </Svg>
  );
}
