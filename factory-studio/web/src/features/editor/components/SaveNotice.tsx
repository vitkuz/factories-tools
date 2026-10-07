import type { ReactNode } from 'react';
import type { SaveState } from '../editor.types';

/** Under the toolbar, only when a save was refused: the API's message and its issues. The edits stay on screen. */
export const SaveNotice = ({ state }: { state: SaveState }): ReactNode => {
  if (state.status !== 'failed') return null;
  return (
    <div className="save-notice" role="alert">
      <strong>Not saved: {state.message}</strong>
      {state.issues.length > 0 ? (
        <ul className="save-notice-issues">
          {state.issues.map((issue: string) => (
            <li key={issue} className="mono">
              {issue}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
};
