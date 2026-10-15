import type { ReactNode } from 'react';

interface NoticeProps {
  tone: 'ok' | 'refusal' | 'plain';
  children: ReactNode;
}

/** A short message over the content, in the sessions' notice look. */
export const Notice = ({ tone, children }: NoticeProps): ReactNode => (
  <div className={`notice notice--${tone}`} role={tone === 'refusal' ? 'alert' : 'status'}>
    {children}
  </div>
);
