import type { ReactNode } from 'react';
import { useRoute, type RouteState } from './shared/lib/route';
import { Topbar } from './shared/components/Topbar';
import { EditorScreen } from './features/editor';

/** The shell: the brand bar, then the editor on the pipeline the route names. */
export default function App(): ReactNode {
  const { route }: RouteState = useRoute();

  return (
    <div className="app">
      <Topbar />
      <EditorScreen pipelineId={route.pipelineId} />
    </div>
  );
}
