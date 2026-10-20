/** GitPilot mark: a branch line with a fork, drawn to sit on the 4px grid. */
export function Logo({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      <rect width="24" height="24" rx="5" fill="var(--accent)" />
      <path d="M9 5.5v13M9 15c0-3.2 6.5-2.6 6.5-6.2" stroke="#fff" strokeWidth="1.8" fill="none" strokeLinecap="round" />
      <circle cx="9" cy="18.5" r="1.9" fill="#fff" />
      <circle cx="9" cy="5.5" r="1.9" fill="#fff" />
      <circle cx="15.5" cy="8.3" r="1.9" fill="#fff" />
    </svg>
  );
}
