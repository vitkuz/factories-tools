import type { ReactNode } from 'react';

/** The brand mark: the favicon's two dots and ring, inline so it takes the ink colour of the wordmark. */
export const BrandMark = (): ReactNode => (
  <svg className="brand-mark" viewBox="0 0 32 32" width="18" height="18" aria-hidden="true">
    <rect width="32" height="32" rx="7" fill="var(--raised)" />
    <path d="M8 16h16" stroke="var(--st-completed)" strokeWidth="2.5" strokeLinecap="round" />
    <circle cx="8" cy="16" r="3.5" fill="var(--st-completed)" />
    <circle cx="16" cy="16" r="3.5" fill="var(--st-completed)" />
    <circle
      cx="24"
      cy="16"
      r="3"
      fill="var(--raised)"
      stroke="var(--st-completed)"
      strokeWidth="2"
    />
  </svg>
);
