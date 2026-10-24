import type { RunsFeed } from '../runs/hooks/use-runs-feed';
import type { DashboardData, Pipeline, RunRecord } from '../runs/runs.types';
import type { Workspace, WorkspaceOption } from './workspaces.types';

/** Every factory is in All (`null`); otherwise only the workspace's own ids. */
export const inWorkspace =
  (workspace: Workspace | null) =>
  (pipelineId: string): boolean =>
    workspace === null || workspace.pipelines.includes(pipelineId);

/** The runs of the workspace's factories; the same array for All. */
export const filterRuns =
  (workspace: Workspace | null) =>
  (runs: RunRecord[]): RunRecord[] =>
    workspace === null
      ? runs
      : runs.filter((run: RunRecord): boolean => inWorkspace(workspace)(run.pipelineId));

/**
 * The feed as a workspace sees it: its runs, and the pipelines record narrowed to its ids.
 * For All the feed object itself is returned, so memoised children keep their identity.
 */
export const filterFeed =
  (workspace: Workspace | null) =>
  (feed: RunsFeed): RunsFeed => {
    if (workspace === null) return feed;
    const keep: (pipelineId: string) => boolean = inWorkspace(workspace);
    const pipelines: Record<string, Pipeline> = Object.fromEntries(
      Object.entries(feed.data.pipelines).filter(([id]: [string, Pipeline]): boolean => keep(id)),
    );
    const data: DashboardData = {
      ...feed.data,
      runs: filterRuns(workspace)(feed.data.runs),
      pipelines,
    };
    return { ...feed, data };
  };

/** The wanted workspace when it is listed; else `null` (All). */
export const pickWorkspace =
  (wantedId: string | null) =>
  (list: Workspace[]): Workspace | null =>
    wantedId === null ? null : (list.find((w: Workspace): boolean => w.id === wantedId) ?? null);

/**
 * The factories the dialog offers, sorted by id: every pipeline the feed knows (on disk),
 * every pipeline a run names, and the workspace's own ids, so one that is gone can still be
 * unticked.
 */
export const factoryOptions = (
  workspace: Workspace | null,
  feed: DashboardData,
): WorkspaceOption[] => {
  const ids: Set<string> = new Set<string>([
    ...Object.keys(feed.pipelines),
    ...feed.runs.map((run: RunRecord): string => run.pipelineId),
    ...(workspace?.pipelines ?? []),
  ]);
  return [...ids]
    .sort((a: string, b: string): number => a.localeCompare(b))
    .map((id: string): WorkspaceOption => ({ id, onDisk: id in feed.pipelines }));
};

/** "3 factories", "1 factory", "no factories". */
export const describeFactoryCount = (workspace: Workspace): string => {
  const n: number = workspace.pipelines.length;
  if (n === 0) return 'no factories';
  return n === 1 ? '1 factory' : `${n} factories`;
};

/** The list with one workspace put in (replacing the one with its id) or taken out. */
export const withWorkspace =
  (workspace: Workspace) =>
  (list: Workspace[]): Workspace[] =>
    list.some((w: Workspace): boolean => w.id === workspace.id)
      ? list.map((w: Workspace): Workspace => (w.id === workspace.id ? workspace : w))
      : [...list, workspace];

export const withoutWorkspace =
  (id: string) =>
  (list: Workspace[]): Workspace[] =>
    list.filter((w: Workspace): boolean => w.id !== id);
