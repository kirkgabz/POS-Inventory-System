import { useId } from 'react';

/**
 * TapBenta mark — a hanging price tag ("benta") with a "T" cut in, and
 * contactless "tap" waves coming off the tag hole.
 * `animated` turns it into the loading indicator (tag sways, waves pulse).
 */
export function LogoMark({ size = 40, animated = false, className = '' }: { size?: number; animated?: boolean; className?: string }) {
  const id = useId().replace(/:/g, '');
  return (
    <svg
      className={`tb-logo ${animated ? 'is-animated' : ''} ${className}`}
      width={size}
      height={size}
      viewBox="0 0 64 64"
      role="img"
      aria-label="TapBenta"
    >
      <defs>
        <linearGradient id={`tag-${id}`} x1="0.15" y1="0" x2="0.85" y2="1">
          <stop offset="0" stopColor="#ecf3a6" />
          <stop offset="0.55" stopColor="#d9dcf3" />
          <stop offset="1" stopColor="#bdb6f4" />
        </linearGradient>
        <linearGradient id={`bg-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1f1f22" />
          <stop offset="1" stopColor="#0f0f10" />
        </linearGradient>
      </defs>

      <rect width="64" height="64" rx="18" fill={`url(#bg-${id})`} />

      {/* tap waves */}
      <g className="tb-waves" fill="none" stroke="#d6e26b" strokeLinecap="round">
        <path className="w1" d="M39.5 7.0 A15 15 0 0 1 45.6 13.7" strokeWidth="3" />
        <path className="w2" d="M42.5 1.8 A21 21 0 0 1 51.0 11.1" strokeWidth="3" opacity="0.55" />
      </g>

      {/* hanging tag */}
      <g className="tb-tag" transform="rotate(-10 32 20)">
        <path
          d="M29.9 10.7 Q32 8.7 34.1 10.7 L44.6 21.2 Q46 22.7 46 24.8 V47 Q46 53 40 53 H24 Q18 53 18 47 V24.8 Q18 22.7 19.4 21.2 Z"
          fill={`url(#tag-${id})`}
        />
        <circle cx="32" cy="20" r="3.3" fill="#141414" />
        <path d="M24.6 30.5 H39.4 M32 30.5 V45" stroke="#141414" strokeWidth="4.4" strokeLinecap="round" fill="none" />
      </g>
    </svg>
  );
}

/** Two-tone wordmark next to the mark. */
export function Logo({ size = 40, tagline }: { size?: number; tagline?: string }) {
  return (
    <span className="tb-lockup">
      <LogoMark size={size} />
      <span className="tb-lockup-text">
        <span className="tb-word">
          Tap<em>Benta</em>
        </span>
        {tagline && <span className="tb-lockup-tag">{tagline}</span>}
      </span>
    </span>
  );
}

/** Full-screen / inline loading indicator. */
export function LogoLoader({ size = 72, label }: { size?: number; label?: string }) {
  return (
    <div className="tb-loader" role="status" aria-live="polite">
      <LogoMark size={size} animated />
      <span className="tb-loader-label">{label ?? 'Loading…'}</span>
    </div>
  );
}
