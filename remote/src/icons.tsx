// The handful of icons this app needs, drawn inline.
//
// Hand-written rather than pulled from a set: it is eight shapes, they ship as part of the page
// instead of another 100 KB download over mobile data, and they can be drawn on the same 24-unit
// grid and 1.75 stroke as the desktop app's, so the two look like one family.
//
// Every icon is decorative — the control around it carries the label — so they are aria-hidden.

type IconProps = { size?: number; className?: string };

function Svg({ size = 18, className, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
      focusable="false"
    >
      {children}
    </svg>
  );
}

export const ChevronLeft = (p: IconProps) => (
  <Svg {...p}>
    <path d="M15 18l-6-6 6-6" />
  </Svg>
);

export const ChevronRight = (p: IconProps) => (
  <Svg {...p}>
    <path d="M9 18l6-6-6-6" />
  </Svg>
);

export const ChevronDown = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 9l6 6 6-6" />
  </Svg>
);

export const Refresh = (p: IconProps) => (
  <Svg {...p}>
    <path d="M21 12a9 9 0 11-2.64-6.36" />
    <path d="M21 3v6h-6" />
  </Svg>
);

export const Branch = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="6" cy="6" r="2.5" />
    <circle cx="6" cy="18" r="2.5" />
    <circle cx="18" cy="8" r="2.5" />
    <path d="M6 8.5v7M8.5 7.2h4A3 3 0 0115.5 10v.5" />
  </Svg>
);

export const Download = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 4v11" />
    <path d="M7.5 10.5L12 15l4.5-4.5" />
    <path d="M5 19h14" />
  </Svg>
);

export const Upload = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 20V9" />
    <path d="M7.5 13.5L12 9l4.5 4.5" />
    <path d="M5 5h14" />
  </Svg>
);

export const Sync = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 10a8 8 0 0113.7-5.2L20 7" />
    <path d="M20 14a8 8 0 01-13.7 5.2L4 17" />
    <path d="M20 3v4h-4M4 21v-4h4" />
  </Svg>
);

export const Computer = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3" y="4" width="18" height="12" rx="2" />
    <path d="M8 20h8M12 16v4" />
  </Svg>
);

export const Check = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 13l4.5 4.5L19 7" />
  </Svg>
);

export const Plus = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);

export const Minus = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 12h14" />
  </Svg>
);

export const Close = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 6l12 12M18 6L6 18" />
  </Svg>
);

export const Trash = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 7h16M10 7V5h4v2M6 7l1 12h10l1-12" />
  </Svg>
);
