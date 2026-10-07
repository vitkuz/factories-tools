import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type ReactNode,
} from 'react';
import {
  Background,
  BackgroundVariant,
  Controls,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  type Connection,
  type FinalConnectionState,
  type EdgeChange,
  type Node,
  type NodeChange,
  type EdgeTypes,
  type NodeTypes,
} from '@xyflow/react';

import { isApiError, toApiError, type ApiError } from '../../adapters/http/api-error.utils';
import { navigate } from '../../shared/lib/route';
import { isEditingShortcutTarget, isTypingTarget } from '../../shared/lib/keys';
import {
  DocOpenContext,
  LazyDocModal,
  type DocRef,
  type DocScope,
  type OpenDoc,
} from '../../shared/document-viewer';
import {
  AutoMiniMap,
  dimOutsideFocus,
  EndNode,
  FIT,
  FlowEdge as FlowEdgeComponent,
  MAX_ZOOM,
  MIN_ZOOM,
  StartNode,
  isTerminalId,
  useFitGraph,
  type EdgeRouteRef,
} from '../../shared/graph';
import { StepNode } from './components/StepNode';
import { Toolbar } from './components/Toolbar';
import { CanvasStrip } from './components/CanvasStrip';
import { IssuesPanel } from './components/IssuesPanel';
import { PipelineInspector } from './components/PipelineInspector';
import { StepInspector } from './components/StepInspector';
import { EdgeInspector } from './components/EdgeInspector';
import { EditorContext, type EditorActions } from './components/EditorContext';
import { Wizard } from './components/wizard/Wizard';
import { Library } from './components/Library';
import { PipelinePicker } from './components/PipelinePicker';
import { SaveNotice } from './components/SaveNotice';
import { usePipelineSource, type PipelineSource } from './hooks/use-pipeline-source';
import { describeSaveFailure } from './editor.utils';
import type { LoadState, PipelineListEntry, SaveState } from './editor.types';
import { importAll, importStep, referenceKey } from './lib/library.utils';
import { parsePipeline, type ParseResult } from './lib/pipeline.schema';
import { buildEditorGraph, dimOffHappyPath, layoutKey, type EditorGraph } from './lib/graph.utils';
import { validatePipeline } from './lib/validate.utils';
import { downloadText, exportPng } from './lib/export.utils';
import * as historyService from './lib/history.utils';
import {
  connectStep,
  deleteStep,
  disconnect,
  duplicateStep,
  freeName,
  insertStep,
  moveEdge,
  nextEventName,
  renameStep,
  serialisePipeline,
  setStart,
} from './lib/pipeline.utils';
import {
  BLOCK_DRAG_TYPE,
  END,
  END_NODE_ID,
  START_NODE_ID,
  type BlockDrag,
  type ImportResult,
  type ProvenanceMap,
  type Reference,
  type Density,
  type FlowEdge,
  type FlowNode,
  type History,
  type Issue,
  type Mode,
  type Pipeline,
  type Selection,
  type WizardMode,
} from './lib/pipeline.types';

const APP_NAME = 'Factory Studio';

// Declared once: re-creating these objects on every render remounts every node.
const nodeTypes: NodeTypes = { step: StepNode, start: StartNode, end: EndNode };
const edgeTypes: EdgeTypes = { flow: FlowEdgeComponent };

const minimapClass = (node: Node): string =>
  node.type === 'step' ? 'mm mm-none' : 'mm mm-terminal';

/**
 * Whether the editor holds unsaved edits, readable by the shell so a click on another
 * screen's link can ask first. A module-level ref, not context: the shell is above the
 * screen and the value is a single boolean.
 */
export const editorDirty: { current: boolean } = { current: false };

export const LEAVE_MESSAGE = 'Leave the editor? Unsaved changes will be lost.';

const failureMessage = (error: unknown): string =>
  isApiError(error) ? error.message : error instanceof Error ? error.message : String(error);

/** The step name an edge end points at: END on the canvas is `END` in the file. */
const targetNameOf = (nodeId: string): string => (nodeId === END_NODE_ID ? END : nodeId);

interface EditorBodyProps {
  /** The factory the file belongs to (`factories/<id>/`) — what the API keys reads and writes on. */
  skillId: string;
  initial: Pipeline;
  source: PipelineSource;
  picker: ReactNode;
  /** A notice to flash on mount: what the previous body did just before it handed over (a create). */
  initialNotice: string | null;
  /** The body created a factory and moves to it; the screen carries the notice across the remount. */
  onCreated: (id: string, message: string) => void;
}

/** The editor proper: viz's state machine over one loaded pipeline. Remounted per skill id. */
const EditorBody = ({
  skillId,
  initial,
  source,
  picker,
  initialNotice,
  onCreated,
}: EditorBodyProps): ReactNode => {
  const [history, setHistory] = useState<History<Pipeline>>(() =>
    historyService.historyOf(initial),
  );
  const pipeline: Pipeline = history.present;
  const [mode, setMode] = useState<Mode>('view');
  const [density, setDensity] = useState<Density>('compact');
  const [focusPath, setFocusPath] = useState<boolean>(false);
  const [hovered, setHovered] = useState<string | null>(null);
  const [wizardOpen, setWizardOpen] = useState<boolean>(false);
  const [libraryOpen, setLibraryOpen] = useState<boolean>(false);
  const [references, setReferences] = useState<Reference[]>([]);
  const [provenance, setProvenance] = useState<ProvenanceMap>({});
  const [dropping, setDropping] = useState<boolean>(false);
  const [selection, setSelection] = useState<Selection | null>({ kind: 'pipeline' });
  const [notice, setNotice] = useState<string | null>(initialNotice);
  const [saveState, setSaveState] = useState<SaveState>({ status: 'clean' });
  const dirty = useRef<boolean>(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  const compact: boolean = density === 'compact';
  const editing: boolean = mode === 'edit';

  const markDirty = useCallback((value: boolean): void => {
    dirty.current = value;
    editorDirty.current = value;
  }, []);
  // Leaving the screen (another screen, another skill) never leaves a stale flag behind.
  useEffect(() => (): void => markDirty(false), [markDirty]);

  // The document modal. The stack is the trail of docs opened from inside other docs, so
  // Back walks it; empty means no modal. Only `knowledge` paths have a file behind them —
  // `input` and `output` are written by a run, and open on a notice saying so.
  const [docStack, setDocStack] = useState<DocRef[]>([]);

  const issues: Issue[] = useMemo((): Issue[] => validatePipeline(pipeline), [pipeline]);
  const errorCount: number = issues.filter(
    (issue: Issue): boolean => issue.level === 'error',
  ).length;

  // The graph is the Runs screen's: the shared layout over the definition, with the happy
  // path lit. Positions come from the pipeline alone, so every edit lays out again.
  const graph: EditorGraph = useMemo(
    (): EditorGraph => buildEditorGraph(pipeline, { detailed: !compact, issues, selection }),
    [pipeline, compact, issues, selection],
  );

  // Hovering a node keeps it and its neighbours and dims the rest; the happy-path switch
  // dims every retry, escape and alternative route. Both are class-name overlays, so the
  // graph itself is not rebuilt.
  const { nodes, edges }: { nodes: FlowNode[]; edges: FlowEdge[] } = useMemo(() => {
    const focused: { nodes: FlowNode[]; edges: FlowEdge[] } = dimOutsideFocus(
      graph.nodes,
      graph.edges,
      hovered,
    );
    return focusPath ? dimOffHappyPath(focused.nodes, focused.edges) : focused;
  }, [graph, hovered, focusPath]);

  // Fit the whole graph whenever its structure changes (a step added, removed or rewired,
  // the card mode switched); the hook also refits when the canvas changes size, as when
  // the library opens. The short wait lets react flow commit the new nodes first.
  const fitGraph = useFitGraph(wrapRef, !compact);
  const structure: string = layoutKey(graph.nodes);
  useEffect((): (() => void) => {
    const timer: number = window.setTimeout((): void => fitGraph(true), 60);
    return (): void => window.clearTimeout(timer);
  }, [structure, fitGraph]);

  useEffect((): (() => void) => {
    const warn = (event: BeforeUnloadEvent): void => {
      if (!dirty.current) return;
      event.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return (): void => window.removeEventListener('beforeunload', warn);
  }, []);

  const flash = useCallback((message: string): void => {
    setNotice(message);
    window.setTimeout((): void => setNotice(null), 4000);
  }, []);
  // The notice this body was mounted with fades like one it flashed itself.
  useEffect((): (() => void) => {
    const timer: number = window.setTimeout((): void => setNotice(null), 4000);
    return (): void => window.clearTimeout(timer);
  }, []);

  /** Whether `id` is a factory the API lists — one Save must not silently overwrite. */
  const isListed = useCallback(
    (id: string): boolean =>
      source.entries.some((entry: PipelineListEntry): boolean => entry.id === id),
    [source.entries],
  );

  /** Where Save will write `id`: its own file, or a new factory when the id is free. */
  const saveTarget = useCallback(
    (id: string): string =>
      id === skillId || isListed(id)
        ? `factories/${id}/pipeline.json`
        : `a new factories/${id}/pipeline.json (+ factories-skills/${id}/SKILL.md, linked into .claude/skills)`,
    [skillId, isListed],
  );

  const edit = useCallback(
    (next: Pipeline): void => {
      markDirty(true);
      setSaveState((current: SaveState): SaveState =>
        current.status === 'saving' || current.status === 'failed' ? current : { status: 'dirty' },
      );
      setHistory((current: History<Pipeline>): History<Pipeline> =>
        next === current.present ? current : historyService.push(current, next),
      );
    },
    [markDirty],
  );

  const replacePipeline = useCallback(
    (next: Pipeline): void => {
      setHistory(historyService.reset(next));
      setSelection({ kind: 'pipeline' });
      markDirty(false);
      setSaveState({ status: 'clean' });
    },
    [markDirty],
  );

  const undo = useCallback((): void => {
    setHistory((current: History<Pipeline>): History<Pipeline> => historyService.undo(current));
  }, []);

  const redo = useCallback((): void => {
    setHistory((current: History<Pipeline>): History<Pipeline> => historyService.redo(current));
  }, []);

  const duplicate = useCallback(
    (name: string): void => {
      const [next, copy]: [Pipeline, string] = duplicateStep(pipeline, name);
      if (next === pipeline) return;
      edit(next);
      setSelection({ kind: 'step', name: copy });
    },
    [edit, pipeline],
  );

  const editorActions: EditorActions = useMemo(
    (): EditorActions => ({
      editing,
      duplicate,
      remove: (name: string): void => {
        edit(deleteStep(pipeline, name));
        setSelection({ kind: 'pipeline' });
      },
      rename: (from: string, to: string): void => {
        const next: Pipeline = renameStep(pipeline, from, to);
        if (next === pipeline) {
          flash(pipeline.steps[to] ? `'${to}' is already a step` : `Could not rename '${from}'`);
          return;
        }
        edit(next);
        setSelection({ kind: 'step', name: to });
      },
      addEdge: (name: string): void => {
        const event: string = nextEventName(pipeline, name);
        edit(connectStep(pipeline, name, event, END));
        setSelection({ kind: 'edge', source: name, event });
      },
    }),
    [editing, duplicate, edit, pipeline, flash],
  );

  /**
   * A path on a card opens the document; the trail starts fresh. Knowledge is read from
   * the skill through the API; an input/output path is an artifact a run writes, shown as
   * a notice with no request.
   */
  const openDoc = useCallback<OpenDoc>(
    (scope: DocScope, path: string): void => {
      setDocStack([
        scope === 'knowledge'
          ? { scope: 'pipeline', pipelineId: skillId, path }
          : { scope: 'artifact', pipelineId: skillId, path },
      ]);
    },
    [skillId],
  );

  /** A link or a folder entry inside a doc opens on top of it, so Back returns here. */
  const pushDoc = useCallback((ref: DocRef): void => {
    setDocStack((stack: DocRef[]): DocRef[] => [...stack, ref]);
  }, []);

  const popDoc = useCallback((): void => {
    setDocStack((stack: DocRef[]): DocRef[] => stack.slice(0, -1));
  }, []);

  const closeDoc = useCallback((): void => setDocStack([]), []);

  const toggleDensity = useCallback((): void => {
    setDensity((current: Density): Density => (current === 'compact' ? 'full' : 'compact'));
  }, []);

  // `d` grows every card to its documents, and shrinks it again — the shortcut the Runs
  // screen uses for the same toggle. Ctrl+D stays the duplicate below.
  useEffect((): (() => void) => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (isTypingTarget(event.target)) return;
      if (event.key.toLowerCase() !== 'd') return;
      event.preventDefault();
      toggleDensity();
    };
    window.addEventListener('keydown', onKey);
    return (): void => window.removeEventListener('keydown', onKey);
  }, [toggleDensity]);

  useEffect((): (() => void) => {
    const onKey = (event: KeyboardEvent): void => {
      if (mode !== 'edit' || isEditingShortcutTarget(event.target)) return;
      const combo: boolean = event.ctrlKey || event.metaKey;
      if (!combo) return;
      const key: string = event.key.toLowerCase();
      if (key === 'z' && event.shiftKey) {
        event.preventDefault();
        redo();
      } else if (key === 'z') {
        event.preventDefault();
        undo();
      } else if (key === 'y') {
        event.preventDefault();
        redo();
      } else if (key === 'd' && selection?.kind === 'step') {
        event.preventDefault();
        duplicate(selection.name);
      }
    };
    window.addEventListener('keydown', onKey);
    return (): void => window.removeEventListener('keydown', onKey);
  }, [mode, undo, redo, selection, duplicate]);

  // Nodes are laid out, never dragged, and sized up front, so the only change the editor
  // acts on is a deletion (Delete / Backspace on a selected step, in Edit mode).
  const onNodesChange = useCallback(
    (changes: NodeChange<FlowNode>[]): void => {
      if (mode !== 'edit') return;
      const removed: string[] = changes
        .filter(
          (change): change is NodeChange<FlowNode> & { id: string } => change.type === 'remove',
        )
        .map((change): string => change.id)
        .filter((id: string): boolean => !isTerminalId(id));

      if (removed.length > 0) {
        edit(
          removed.reduce((acc: Pipeline, id: string): Pipeline => deleteStep(acc, id), pipeline),
        );
        setSelection({ kind: 'pipeline' });
      }
    },
    [edit, mode, pipeline],
  );

  /** Deleting an edge removes every `transitions` entry it drew (a START edge: the START entry). */
  const onEdgesChange = useCallback(
    (changes: EdgeChange<FlowEdge>[]): void => {
      if (mode !== 'edit') return;
      const removed: string[] = changes
        .filter(
          (change): change is EdgeChange<FlowEdge> & { id: string } => change.type === 'remove',
        )
        .map((change): string => change.id);
      if (removed.length === 0) return;

      const next: Pipeline = removed.reduce((acc: Pipeline, id: string): Pipeline => {
        const edge: FlowEdge | undefined = graph.edges.find(
          (candidate: FlowEdge): boolean => candidate.id === id,
        );
        if (!edge?.data) return acc;
        if (edge.source === START_NODE_ID) {
          return setStart(
            acc,
            acc.START.filter((name: string): boolean => name !== edge.target),
          );
        }
        return edge.data.routes.reduce(
          (inner: Pipeline, ref: EdgeRouteRef): Pipeline =>
            disconnect(inner, edge.source, ref.event, ref.target, ref.isFallback),
          acc,
        );
      }, pipeline);

      edit(next);
      setSelection({ kind: 'pipeline' });
    },
    [graph.edges, edit, mode, pipeline],
  );

  const onConnect = useCallback(
    (connection: Connection): void => {
      const { source, target } = connection;
      if (!source || !target || target === START_NODE_ID || source === END_NODE_ID) return;

      if (source === START_NODE_ID) {
        if (target === END_NODE_ID || pipeline.START.includes(target)) return;
        edit(setStart(pipeline, [...pipeline.START, target]));
        setSelection({ kind: 'pipeline' });
        return;
      }

      const event: string = nextEventName(pipeline, source);
      edit(connectStep(pipeline, source, event, targetNameOf(target)));
      setSelection({ kind: 'edge', source, event });
    },
    [edit, pipeline],
  );

  /** Dropping a connection on empty canvas creates a step, already wired; the layout places it. */
  const onConnectEnd = useCallback(
    (_event: MouseEvent | TouchEvent, state: FinalConnectionState): void => {
      if (state.isValid || !state.fromNode || state.fromHandle?.type !== 'source') return;
      const source: string = state.fromNode.id;
      if (source === END_NODE_ID) return;
      const name: string = freeName(pipeline, 'new-step');
      if (source === START_NODE_ID) {
        edit(setStart(insertStep(pipeline, name, null, ''), [...pipeline.START, name]));
      } else {
        edit(insertStep(pipeline, name, source, nextEventName(pipeline, source)));
      }
      setSelection({ kind: 'step', name });
    },
    [edit, pipeline],
  );

  /** Dragging an edge's end onto another node moves that end — every event the edge drew goes with it. */
  const onReconnect = useCallback(
    (oldEdge: FlowEdge, connection: Connection): void => {
      const { source, target } = connection;
      if (!oldEdge.data || !source || !target || target === START_NODE_ID) return;
      if (source === END_NODE_ID) return;
      if (oldEdge.source === START_NODE_ID) {
        if (source !== START_NODE_ID || target === END_NODE_ID) return;
        edit(
          setStart(
            pipeline,
            pipeline.START.map((name: string): string => (name === oldEdge.target ? target : name)),
          ),
        );
        return;
      }
      if (source === START_NODE_ID) return;
      const routes: EdgeRouteRef[] = oldEdge.data.routes;
      const next: Pipeline = routes.reduce(
        (acc: Pipeline, ref: EdgeRouteRef): Pipeline =>
          moveEdge(
            acc,
            oldEdge.source,
            ref.event,
            ref.target,
            ref.isFallback,
            source,
            targetNameOf(target),
          ),
        pipeline,
      );
      if (next === pipeline) return;
      edit(next);
      const first: EdgeRouteRef | undefined = routes[0];
      if (first) setSelection({ kind: 'edge', source, event: first.event });
    },
    [edit, pipeline],
  );

  const onAddStep = useCallback((): void => {
    const name: string = freeName(pipeline, 'new-step');
    edit(insertStep(pipeline, name, null, ''));
    setSelection({ kind: 'step', name });
  }, [edit, pipeline]);

  const onLoadText = useCallback(
    (text: string, filename: string): void => {
      const result: ParseResult = parsePipeline(text);
      if (!result.ok) {
        flash(`${filename}: ${result.message}`);
        return;
      }
      replacePipeline(result.pipeline);
      // A file from the person's computer is not what is on disk under this factory yet.
      markDirty(true);
      setSaveState({ status: 'dirty' });
      flash(`Loaded ${filename} — Save writes it to ${saveTarget(result.pipeline.id)}`);
    },
    [flash, replacePipeline, markDirty, saveTarget],
  );

  /**
   * Write the pipeline back. Its id names the factory: the one in the route is overwritten
   * (E4); a free id becomes a new `factories/<id>/pipeline.json` with its wrapper skill (E4b)
   * and the editor moves there; another factory's id is refused here, so a save never lands
   * on a factory that is not open. The API is the gate for everything else.
   */
  const onSave = useCallback(async (): Promise<void> => {
    if (saveState.status === 'saving') return;
    const id: string = pipeline.id;
    if (id !== skillId && isListed(id)) {
      setSaveState({
        status: 'failed',
        message: `'${id}' is another factory on disk — open it from the picker to overwrite it, or give this pipeline a free id`,
        issues: [],
      });
      return;
    }
    setSaveState({ status: 'saving' });
    try {
      if (id === skillId) {
        const saved = await source.save(skillId, serialisePipeline(pipeline));
        markDirty(false);
        setSaveState({ status: 'saved', bytes: saved.bytes });
        flash(`Saved ${saveTarget(skillId)} (${saved.bytes} bytes)`);
        return;
      }
      const created = await source.create(serialisePipeline(pipeline));
      markDirty(false);
      setSaveState({ status: 'saved', bytes: created.bytes });
      source.reloadList();
      onCreated(created.id, `Created ${created.path} and ${created.skill}`);
    } catch (error: unknown) {
      const apiError: ApiError = isApiError(error) ? error : toApiError(error);
      setSaveState({ status: 'failed', ...describeSaveFailure(apiError) });
    }
  }, [
    saveState.status,
    source,
    skillId,
    pipeline,
    markDirty,
    flash,
    isListed,
    saveTarget,
    onCreated,
  ]);

  const onCopy = useCallback((): void => {
    void navigator.clipboard
      .writeText(serialisePipeline(pipeline))
      .then((): void => flash('pipeline.json copied to the clipboard'))
      .catch((): void => flash('Clipboard blocked — use Export instead'));
  }, [flash, pipeline]);

  const onExport = useCallback((): void => {
    downloadText('pipeline.json', serialisePipeline(pipeline), 'application/json');
    flash('Exported pipeline.json');
  }, [flash, pipeline]);

  const onExportPng = useCallback((): void => {
    void exportPng(graph.nodes, `${pipeline.id}.png`)
      .then((): void => flash(`Exported ${pipeline.id}.png`))
      .catch((error: unknown): void => flash(`PNG export failed: ${(error as Error).message}`));
  }, [flash, pipeline.id, graph.nodes]);

  const onLoadReferences = useCallback(
    (files: { text: string; filename: string }[]): void => {
      const loaded: Reference[] = [];
      const failed: string[] = [];
      for (const file of files) {
        const result: ParseResult = parsePipeline(file.text);
        if (!result.ok) {
          failed.push(`${file.filename}: ${result.message}`);
          continue;
        }
        loaded.push({
          key: referenceKey([...references, ...loaded], result.pipeline.id),
          filename: file.filename,
          pipeline: result.pipeline,
        });
      }
      if (loaded.length > 0) setReferences([...references, ...loaded]);
      flash(
        failed.length > 0
          ? failed.join(' · ')
          : `Loaded ${loaded.length} reference${loaded.length === 1 ? '' : 's'}`,
      );
    },
    [flash, references],
  );

  /** References from the API's list: each id's file, read as text and parsed like a dropped file. */
  const onLoadFromApi = useCallback(
    (ids: string[]): void => {
      void Promise.all(
        ids.map(async (id: string): Promise<{ text: string; filename: string }> => ({
          text: await source.readText(id),
          filename: `${id}/pipeline.json`,
        })),
      )
        .then(onLoadReferences)
        .catch((error: unknown): void =>
          flash(`Could not load a reference: ${failureMessage(error)}`),
        );
    },
    [source, onLoadReferences, flash],
  );

  const placeImported = useCallback(
    (result: ImportResult): void => {
      if (result.pipeline === pipeline) return;
      setProvenance(result.provenance);
      edit(result.pipeline);
      setSelection({ kind: 'step', name: result.name });
    },
    [edit, pipeline],
  );

  const onAddBlock = useCallback(
    (key: string, step: string): void => {
      const reference: Reference | undefined = references.find(
        (candidate: Reference): boolean => candidate.key === key,
      );
      if (!reference) return;
      placeImported(importStep(pipeline, reference, step, provenance));
    },
    [pipeline, provenance, references, placeImported],
  );

  const onAddAllBlocks = useCallback(
    (key: string): void => {
      const reference: Reference | undefined = references.find(
        (candidate: Reference): boolean => candidate.key === key,
      );
      if (!reference) return;
      placeImported(importAll(pipeline, reference, provenance));
      flash(`Added every step of ${key} — wire START and END to finish`);
    },
    [flash, pipeline, provenance, references, placeImported],
  );

  const onCanvasDragOver = useCallback((event: DragEvent<HTMLDivElement>): void => {
    if (!event.dataTransfer.types.includes(BLOCK_DRAG_TYPE)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    setDropping(true);
  }, []);

  /** A block dropped anywhere on the canvas is added; the layout decides where it goes. */
  const onCanvasDrop = useCallback(
    (event: DragEvent<HTMLDivElement>): void => {
      setDropping(false);
      const raw: string = event.dataTransfer.getData(BLOCK_DRAG_TYPE);
      if (!raw) return;
      event.preventDefault();
      const block: BlockDrag = JSON.parse(raw) as BlockDrag;
      onAddBlock(block.reference, block.step);
    },
    [onAddBlock],
  );

  const onWizardFinish = useCallback(
    (next: Pipeline, wizardMode: WizardMode): void => {
      setWizardOpen(false);
      setMode('edit');
      if (wizardMode === 'new') {
        replacePipeline(next);
        markDirty(true);
        setSaveState({ status: 'dirty' });
        flash(`Built ${next.id} — Save writes it to ${saveTarget(next.id)}`);
      } else {
        edit(next);
        flash('Step added — Ctrl+Z takes it back out');
      }
    },
    [edit, flash, replacePipeline, markDirty, saveTarget],
  );

  // the tab reads like the Runs screen's: what you are looking at, then the app
  useEffect((): void => {
    document.title = `${pipeline.id} — ${APP_NAME}`;
  }, [pipeline.id]);

  const doc: DocRef | undefined = docStack[docStack.length - 1];

  return (
    <EditorContext.Provider value={editorActions}>
      <DocOpenContext.Provider value={openDoc}>
        <Toolbar
          picker={picker}
          pipelineId={pipeline.id}
          errorCount={errorCount}
          warningCount={issues.length - errorCount}
          mode={mode}
          focusPath={focusPath}
          canUndo={history.past.length > 0}
          canRedo={history.future.length > 0}
          saveState={saveState}
          canSave
          onMode={setMode}
          onFocusPath={setFocusPath}
          onUndo={undo}
          onRedo={redo}
          onAddStep={onAddStep}
          onWizard={(): void => setWizardOpen(true)}
          libraryOpen={libraryOpen}
          onLibrary={(): void => setLibraryOpen(!libraryOpen)}
          onLoadText={onLoadText}
          onSave={(): void => void onSave()}
          onExport={onExport}
          onExportPng={onExportPng}
          onCopy={onCopy}
        />
        <SaveNotice state={saveState} />

        <main className="workspace">
          {libraryOpen ? (
            <Library
              references={references}
              apiReferences={source.entries}
              onLoad={onLoadReferences}
              onLoadFromApi={onLoadFromApi}
              onRemove={(key: string): void =>
                setReferences(references.filter((r: Reference): boolean => r.key !== key))
              }
              onAddStep={onAddBlock}
              onAddAll={onAddAllBlocks}
              onClose={(): void => setLibraryOpen(false)}
            />
          ) : null}
          <div
            ref={wrapRef}
            className={[
              'graph-wrap',
              'canvas',
              editing ? 'is-editing' : '',
              dropping ? 'is-drop-target' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            onDragOver={onCanvasDragOver}
            onDragLeave={(): void => setDropping(false)}
            onDrop={onCanvasDrop}
          >
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onConnectEnd={onConnectEnd}
              onReconnect={onReconnect}
              onNodeClick={(_, node: FlowNode): void =>
                setSelection(
                  isTerminalId(node.id) ? { kind: 'pipeline' } : { kind: 'step', name: node.id },
                )
              }
              onNodeMouseEnter={(_, node: FlowNode): void => setHovered(node.id)}
              onNodeMouseLeave={(): void => setHovered(null)}
              onEdgeClick={(_, edge: FlowEdge): void => {
                const first: EdgeRouteRef | undefined = edge.data?.routes[0];
                setSelection(
                  !first || edge.source === START_NODE_ID
                    ? { kind: 'pipeline' }
                    : { kind: 'edge', source: edge.source, event: first.event },
                );
              }}
              onPaneClick={(): void => setSelection({ kind: 'pipeline' })}
              nodesDraggable={false}
              nodesConnectable={editing}
              edgesReconnectable={editing}
              elementsSelectable
              selectNodesOnDrag={false}
              autoPanOnNodeFocus={false}
              fitView
              fitViewOptions={FIT}
              minZoom={MIN_ZOOM}
              maxZoom={MAX_ZOOM}
              deleteKeyCode={editing ? ['Delete', 'Backspace'] : null}
              colorMode="dark"
            >
              <Background variant={BackgroundVariant.Dots} gap={24} size={1} />
              <Controls showInteractive={false} position="top-right" orientation="horizontal" />
              <AutoMiniMap nodeClassName={minimapClass} />
              <Panel position="bottom-left">
                <CanvasStrip detailed={!compact} onToggle={toggleDensity} />
              </Panel>
            </ReactFlow>
            {notice ? <div className="notice">{notice}</div> : null}
          </div>

          <aside className="sidebar">
            <h2 className="panel-heading">
              {selection?.kind === 'step'
                ? `Step · ${selection.name}`
                : selection?.kind === 'edge'
                  ? `Edge · ${selection.event}`
                  : 'Pipeline'}
            </h2>

            <div className="sidebar-scroll">
              {/* `readonly` only while viewing: it hides the add, remove and delete buttons. */}
              <fieldset
                disabled={!editing}
                className={editing ? 'inspector-fields' : 'inspector-fields readonly'}
              >
                {selection?.kind === 'step' ? (
                  <StepInspector
                    pipeline={pipeline}
                    name={selection.name}
                    onChange={edit}
                    onSelect={setSelection}
                  />
                ) : selection?.kind === 'edge' ? (
                  <EdgeInspector
                    pipeline={pipeline}
                    source={selection.source}
                    event={selection.event}
                    onChange={edit}
                    onSelect={setSelection}
                  />
                ) : (
                  <PipelineInspector pipeline={pipeline} onChange={edit} />
                )}
              </fieldset>

              <IssuesPanel issues={issues} onSelect={setSelection} />
            </div>
          </aside>
        </main>

        {wizardOpen ? (
          <Wizard
            current={pipeline}
            onCancel={(): void => setWizardOpen(false)}
            onFinish={onWizardFinish}
          />
        ) : null}

        {doc ? (
          <Suspense fallback={null}>
            <LazyDocModal
              key={skillId}
              doc={doc}
              editable={false}
              canBack={docStack.length > 1}
              onBack={popDoc}
              onClose={closeDoc}
              onOpen={pushDoc}
            />
          </Suspense>
        ) : null}
      </DocOpenContext.Provider>
    </EditorContext.Provider>
  );
};

interface EditorScreenProps {
  /** The skill id in the route, or `null` for `/editor` — the first listed pipeline is opened then. */
  pipelineId: string | null;
}

/**
 * The Editor screen: the API's pipeline list in a picker, the file of the chosen id loaded
 * and drawn, and `Save` writing it back. Nothing is bundled: an empty list is a screen, not
 * an error.
 */
export const EditorScreen = ({ pipelineId }: EditorScreenProps): ReactNode => {
  const source: PipelineSource = usePipelineSource();
  const [loadState, setLoadState] = useState<LoadState>({ status: 'idle' });
  const [loaded, setLoaded] = useState<Pipeline | null>(null);
  // What the body that just created a factory wants the next body to say.
  const pendingNotice = useRef<string | null>(null);

  const onCreated = useCallback((id: string, message: string): void => {
    pendingNotice.current = message;
    navigate({ screen: 'editor', pipelineId: id });
  }, []);

  // `/editor` alone: open the first pipeline the API lists.
  useEffect((): void => {
    if (pipelineId !== null || source.listState !== 'ready') return;
    const first: string | undefined = source.entries[0]?.id;
    if (first) navigate({ screen: 'editor', pipelineId: first });
  }, [pipelineId, source.listState, source.entries]);

  useEffect((): (() => void) | undefined => {
    if (pipelineId === null) return undefined;
    const id: string = pipelineId;
    const controller: AbortController = new AbortController();
    setLoadState({ status: 'loading', id });
    source
      .load(id, controller.signal)
      .then((result: ParseResult): void => {
        if (controller.signal.aborted) return;
        if (result.ok) {
          setLoaded(result.pipeline);
          setLoadState({ status: 'ready', id });
        } else {
          setLoadState({ status: 'failed', id, message: result.message });
        }
      })
      .catch((error: unknown): void => {
        if (controller.signal.aborted) return;
        setLoadState({ status: 'failed', id, message: failureMessage(error) });
      });
    return (): void => controller.abort();
  }, [pipelineId, source.load]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect((): void => {
    if (loadState.status !== 'ready') document.title = `Editor — ${APP_NAME}`;
  }, [loadState.status]);

  const choose = (id: string): void => {
    if (id === pipelineId) return;
    if (editorDirty.current && !window.confirm(LEAVE_MESSAGE)) return;
    navigate({ screen: 'editor', pipelineId: id });
  };

  const picker: ReactNode = (
    <PipelinePicker
      entries={source.entries}
      value={pipelineId}
      loading={source.listState === 'loading'}
      onChange={choose}
    />
  );

  const readyId: string | null = loadState.status === 'ready' ? loadState.id : null;

  return (
    <div className="screen screen-editor">
      {readyId !== null && loaded ? (
        <ReactFlowProvider>
          <EditorBody
            key={readyId}
            skillId={readyId}
            initial={loaded}
            source={source}
            picker={picker}
            initialNotice={pendingNotice.current}
            onCreated={onCreated}
          />
        </ReactFlowProvider>
      ) : (
        <>
          <header className="toolbar">
            {picker}
            <div className="toolbar-title">
              <strong className="mono">{pipelineId ?? 'Editor'}</strong>
              <span className="toolbar-subtitle">
                {loadState.status === 'loading' ? 'loading' : ''}
              </span>
            </div>
          </header>
          <div className="empty editor-empty" aria-busy={loadState.status === 'loading'}>
            {source.listState === 'failed' ? (
              <p>Could not list the pipelines: {source.listError}.</p>
            ) : source.listState === 'ready' && source.entries.length === 0 ? (
              <p>
                No pipelines found. A pipeline is a folder under{' '}
                <code className="mono">factories/</code> holding a{' '}
                <code className="mono">pipeline.json</code>.
              </p>
            ) : loadState.status === 'failed' ? (
              <p>
                Could not open <code className="mono">{loadState.id}</code>: {loadState.message}.
              </p>
            ) : (
              <p className="muted">
                {pipelineId ? `Loading ${pipelineId}…` : 'Loading the pipeline list…'}
              </p>
            )}
            {source.listState === 'failed' ? (
              <button type="button" onClick={source.reloadList}>
                Try again
              </button>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
};
