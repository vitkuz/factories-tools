import type { ReactNode } from 'react';
import { BrandMark } from './BrandMark';

const BRAND_LEAD = 'FACTORY';
const BRAND_TAG = 'EDITOR';

/** The top bar: the brand only — the editor is the one screen, so there is nothing to navigate. */
export const Topbar = (): ReactNode => (
  <header className="topbar">
    <h1 className="brand">
      <BrandMark />
      <span className="brand-lead">{BRAND_LEAD}</span>
      <span className="brand-tag">{BRAND_TAG}</span>
    </h1>
  </header>
);
