import { Suspense, useCallback, useRef, useState, type ReactNode } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import type { RunsFeed } from '../hooks/use-runs-feed';
import type { GraphResult, ViewMode } from '../lib/graph';
import type { Pipeline, RunRecord } from '../runs.types';
import { runRelativePath } from '../runs.utils';
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
import { RunSidebar } from './RunSidebar';

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
  onToggleView: () => void;
  onChooseRun: (ref: RunRef) => void;
  onBackToIndex: () => void;
}

/** One run: the runs sidebar on the left; on the right its header line, the graph, the inspector and the document modal. */
export const RunView = ({
  feed,
  run,
  pipeline,
  graph,
  missing,
  view,
  onToggleView,
  onChooseRun,
  onBackToIndex,
}: RunViewProps): ReactNode => {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // The document modal: a stack so a link inside one doc opens on top of it (Back pops).
  const [docStack, setDocStack] = useState<DocRef[]>([]);
  // Editing is granted to the document the link opened, never to one reached from inside it.
  const [editable, setEditable] = useState<boolean>(false);
  const runRef = useRef<RunRecord>(run);
  runRef.current = run;
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

  const chooseRun = (ref: RunRef): void => {
    setSelectedId(null);
    setDocStack([]);
    onChooseRun(ref);
  };

  const runKey: string = `${run.pipelineId}/${run.runId}`;

  return (
    <>
      <div className="runs-layout">
        <RunSidebar
          runs={feed.data.runs}
          current={{ pipelineId: run.pipelineId, runId: run.runId }}
          onChoose={chooseRun}
        />
        <div className="run-main">
          <RunHeader run={run} feed={feed} onBackToIndex={onBackToIndex} />

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
                feed={feed}
                onSelectStep={setSelectedId}
              />
            </main>
          </DocOpenContext.Provider>
        </div>
      </div>

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
