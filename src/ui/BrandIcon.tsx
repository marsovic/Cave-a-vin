import type { ReactNode } from 'react';

/** Icône de l'application : une grappe dont les grains sont des culots de bouteilles. */
export function BrandIcon({ size = 24, title }: { size?: number; title?: string }): ReactNode {
  return (
    <svg
      className="brand-icon"
      width={size}
      height={size}
      viewBox="0 0 64 64"
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      {title ? <title>{title}</title> : null}
      <rect width="64" height="64" rx="14" fill="#5b1a2b" />
      <path d="M32 22.500V15.500c0-2.200 1.200-3.800 3.200-4.600" fill="none" stroke="#d9a441" strokeWidth="2.600" strokeLinecap="round" />
      <path d="M34.200 17.200c3.400-5.600 10.600-6.600 14.800-2.400-3 5.400-10 7.200-14.800 2.400Z" fill="#d9a441" />
      <g fill="#f3e3c3">
        <circle cx="19.600" cy="29.500" r="6.100" />
        <circle cx="32" cy="29.500" r="6.100" />
        <circle cx="44.400" cy="29.500" r="6.100" />
        <circle cx="25.800" cy="40.300" r="6.100" />
        <circle cx="32" cy="51.100" r="6.100" />
      </g>
      <circle cx="38.200" cy="40.300" r="6.100" fill="#d9a441" />
    </svg>
  );
}
