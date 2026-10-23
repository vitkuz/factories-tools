import { Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import type { RunsFeed } from '../hooks/use-runs-feed';
import type { GraphResult, ViewMode } from '../lib/graph';
import type { Pipeline, RunRecord } from '../runs.types';
import { runRelativePath } from '../runs.utils';
import { isTypingTarget } from '../../../shared/lib/keys';
import type { RunRef } from '../../../shared/lib/route';
import {
  DocOpenContext,
  LazyDocModal,
  type DocRef,
  type DocScope,
  type OpenDoc,
  type OpenDocOptions,
} from '../../../shared/document-viewer';
import GraphCanvas from './GraphCanvas';
import Inspector from './Inspector';
import NoPipeline from './NoPipeline';
import { PlainView } from './PlainView';
import { RunHeader } from './RunHeader';
import { RunQuestionPanel } from '../../sessions';
import { LiveSessionPanel } from '../../chat';

const withClass = (cls: string | undefined, extra: string): string =>
  [cls, extra].filter(Boolean).join(' ');

export interface RunViewProps {
  feed: RunsFeed;
  run: RunRecord;
  pipeline: Pipeline | null;
  graph: GraphResult;
  /** The run the link asked for when it is not on disk — `run` is then the one shown instead. */
  missing: RunRef | null;
  view: ViewMode;
  /** Claude's question for this run waits in the studio: the inspector opens with it on top. */
  asking: boolean;
  onToggleView: () => void;
}

/**
 * One run: its header line in the top bar, then the graph with the plain view under it, the
 * inspector and the document modal. The run is chosen in the app's sidebar; a different run
 * arrives as new props, and the selection and any open document are dropped with the old one.
 */
export const RunView = ({
  feed,
  run,
  pipeline,
  graph,
  missing,
  view,
  asking,
  onToggleView,
}: RunViewProps): ReactNode => {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // `All routes`: every untaken loop, escape and jump in full. A viewing preference, so it
  // survives a run switch (unlike the selection) and is not written anywhere.
  const [allRoutes, setAllRoutes] = useState<boolean>(false);
  const toggleAllRoutes = useCallback((): void => setAllRoutes((on: boolean): boolean => !on), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'a' || e.metaKey || e.ctrlKey || e.altKey || isTypingTarget(e.target)) return;
      toggleAllRoutes();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggleAllRoutes]);

  // The document modal: a stack so a link inside one doc opens on top of it (Back pops).
  const [docStack, setDocStack] = useState<DocRef[]>([]);
  // Editing is granted to the document the link opened, never to one reached from inside it.
  const [editable, setEditable] = useState<boolean>(false);
  const runRef = useRef<RunRecord>(run);
  runRef.current = run;

  // A new run: the selection and the document stack belong to the old one. Adjusted during
  // render (React's pattern for state derived from a prop), so nothing of the old run is drawn.
  const runKey: string = `${run.pipelineId}/${run.runId}`;
  const [shownKey, setShownKey] = useState<string>(runKey);
  if (shownKey !== runKey) {
    setShownKey(runKey);
    setSelectedId(null);
    setDocStack([]);
    setEditable(false);
  }

  const openDoc: OpenDoc = useCallback(
    (scope: DocScope, path: string, options?: OpenDocOptions): void => {
      const r: RunRecord = runRef.current;
      setEditable(scope === 'run' && options?.editable === true);
      setDocStack([
        scope === 'run'
          ? {
              scope: 'run',
              pipelineId: r.pipelineId,
              runId: r.runId,
              path: runRelativePath(r, path),
            }
          : { scope: 'pipeline', pipelineId: r.pipelineId, path },
      ]);
    },
    [],
  );
  // A ref the plain view built itself (a hook script, an inline prompt): a fresh, read-only stack.
  const openRef = useCallback((ref: DocRef): void => {
    setEditable(false);
    setDocStack([ref]);
  }, []);
  const pushDoc = useCallback((ref: DocRef): void => setDocStack((s) => [...s, ref]), []);
  const backDoc = useCallback((): void => setDocStack((s) => s.slice(0, -1)), []);
  const closeDoc = useCallback((): void => setDocStack([]), []);
  const doc: DocRef | undefined = docStack[docStack.length - 1];

  return (
    <>
      <RunHeader run={run} feed={feed} />

      <DocOpenContext.Provider value={openDoc}>
        <main className="main">
          <div className="run-column">
            <div
              className={withClass('graph-wrap', view === 'detailed' ? 'is-detailed' : '')}
              ref={wrapRef}
            >
              {pipeline ? (
                <ReactFlowProvider>
                  <GraphCanvas
                    graph={graph}
                    runKey={runKey}
                    view={view}
                    onToggleView={onToggleView}
                    allRoutes={allRoutes}
                    onToggleAllRoutes={toggleAllRoutes}
                    stateless={!run.state}
                    selectedId={selectedId}
                    onSelect={setSelectedId}
                    wrapRef={wrapRef}
                  />
                </ReactFlowProvider>
              ) : (
                <NoPipeline
                  pipelineId={run.pipelineId}
                  knownPipelineIds={Object.keys(feed.data.pipelines)}
                />
              )}
            </div>
            {pipeline && (
              <PlainView
                pipeline={pipeline}
                run={run}
                graph={graph}
                selectedId={selectedId}
                onSelectStep={setSelectedId}
                onOpenRef={openRef}
              />
            )}
          </div>
          <Inspector
            pipeline={pipeline}
            run={run}
            missing={missing}
            selectedId={selectedId}
            onSelectStep={setSelectedId}
            question={
              asking ? (
                <RunQuestionPanel run={{ pipelineId: run.pipelineId, runId: run.runId }} />
              ) : null
            }
            live={<LiveSessionPanel run={run} />}
          />
        </main>
      </DocOpenContext.Provider>

      {doc && (
        <Suspense fallback={null}>
          <LazyDocModal
            key={runKey}
            doc={doc}
            editable={editable && docStack.length === 1}
            canBack={docStack.length > 1}
            onBack={backDoc}
            onClose={closeDoc}
            onOpen={pushDoc}
          />
        </Suspense>
      )}
    </>
  );
};
