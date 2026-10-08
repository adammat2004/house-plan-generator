/** Small product drawings for the opening inspector. Decorative only. */

export function WindowArt() {
  return (
    <svg viewBox="0 0 64 64" width="72" height="72" aria-hidden>
      <defs>
        <linearGradient id="window-glass" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#c9d8e3" />
          <stop offset="0.55" stopColor="#8fa6b8" />
          <stop offset="1" stopColor="#6d8597" />
        </linearGradient>
      </defs>
      {/* Reveal depth on the left, then the frame face. */}
      <path d="M10 12 16 8v48l-6-4z" fill="#d9dcdf" />
      <rect x="16" y="8" width="40" height="48" rx="1.5" fill="#f4f5f6" stroke="#c9cdd1" />
      <rect x="20" y="12" width="32" height="40" fill="url(#window-glass)" />
      <path d="M20 12h32v6H20z" fill="#ffffff" opacity="0.25" />
      <path d="M24 46 46 16" stroke="#ffffff" strokeOpacity="0.35" strokeWidth="2" />
      <rect x="16" y="54" width="40" height="3" fill="#e6e8ea" />
    </svg>
  );
}

export function DoorArt() {
  return (
    <svg viewBox="0 0 64 64" width="72" height="72" aria-hidden>
      <rect x="16" y="6" width="34" height="52" rx="1" fill="#eceef0" stroke="#c9cdd1" />
      {/* The leaf, swung slightly open. */}
      <path d="M19 9 40 13v46l-21 -2z" fill="#f7f7f8" stroke="#c4c8cc" />
      <path d="M23 16 36 18.5v13L23 30z M23 35 36 36.5v15L23 51z" fill="none" stroke="#d6d9dc" />
      <circle cx="36.5" cy="35" r="1.4" fill="#8b9096" />
      <path d="M40 13 47 9v49l-7 1z" fill="#d9dcdf" />
    </svg>
  );
}
