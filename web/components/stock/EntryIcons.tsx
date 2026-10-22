import type { SVGProps } from "react";

/** Icons the Stock entry screens need that the shared set does not have (design/stock/StockEntry*.dc.html). */

type Props = Omit<SVGProps<SVGSVGElement>, "stroke"> & { size?: number };

function Svg({ size = 16, strokeWidth = 2, children, ...rest }: Props) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
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

export const ChevronDown = (p: Props) => (
  <Svg {...p}>
    <path d="M6 9l6 6 6-6" />
  </Svg>
);

export const ChevronUp = (p: Props) => (
  <Svg {...p}>
    <path d="M18 15l-6-6-6 6" />
  </Svg>
);

export const Lock = (p: Props) => (
  <Svg {...p}>
    <rect x="5" y="11" width="14" height="10" rx="2" />
    <path d="M8 11V7a4 4 0 018 0v4" />
  </Svg>
);

export const Warning = (p: Props) => (
  <Svg {...p}>
    <path d="M12 9v4M12 17h.01M10.3 3.9L2 18a2 2 0 001.7 3h16.6a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z" />
  </Svg>
);

export const Tick = (p: Props) => (
  <Svg {...p}>
    <path d="M5 12l5 5L19 7" />
  </Svg>
);

export const Pencil = (p: Props) => (
  <Svg {...p}>
    <path d="M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z" />
  </Svg>
);

export const Package = (p: Props) => (
  <Svg {...p}>
    <path d="M21 8l-9-5-9 5 9 5 9-5zM3 8v8l9 5 9-5V8M12 13v8" />
  </Svg>
);

export const ArrowRight = (p: Props) => (
  <Svg {...p}>
    <path d="M9 6l6 6-6 6" />
  </Svg>
);
