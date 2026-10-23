import type { ReactNode } from 'react';
import { shortSessionName } from '../sessions.utils';

interface CardHeadProps {
  session: string;
  /** Drawn under the name; left out when not known. */
  factoryId?: string | null;
  /** The right end of the name line: a wait time, a status word. */
  children?: ReactNode;
}

/** A board card's first lines: the session name (without `factory-`), what is on its right, the factory. */
export const CardHead = ({ session, factoryId, children }: CardHeadProps): ReactNode => (
  <>
    <div className="board-card-head">
      <span className="mono board-card-name" title={session}>
        {shortSessionName(session)}
      </span>
      {children}
    </div>
    {factoryId ? <span className="mono board-card-factory">{factoryId}</span> : null}
  </>
);
