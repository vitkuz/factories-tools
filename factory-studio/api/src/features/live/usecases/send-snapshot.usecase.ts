import type { AppLogger } from '../../../shared/types.js';
import type { WsClient } from '../../../shared/ws/ws.types.js';
import type { RunRecord, RunsPayload } from '../../runs/runs.types.js';
import type { FactorySession } from '../../sessions/sessions.types.js';
import type { SystemMemoryResponse } from '../../system/system.types.js';
import type { WorkspacesListResponse } from '../../workspaces/workspaces.types.js';
import type { LiveServerMessage, LiveTopic, SendSnapshot } from '../live.types.js';

export interface SendSnapshotSettings {
  listRuns: () => Promise<RunsPayload>;
  listSessions: () => Promise<FactorySession[]>;
  listWorkspaces: () => Promise<WorkspacesListResponse>;
  readMemory: () => Promise<SystemMemoryResponse>;
  /** Every run list read here (the sweep learns the active runs from it). */
  onRuns?: (runs: readonly RunRecord[]) => void;
  logger?: AppLogger;
}

/**
 * The first frame of a topic, read fresh for the one client that subscribed: the same bodies
 * the GET routes answer, so a reconnect is a full resync without a single HTTP poll.
 */
export const sendSnapshotFactory = ({
  listRuns,
  listSessions,
  listWorkspaces,
  readMemory,
  onRuns,
  logger,
}: SendSnapshotSettings): SendSnapshot => {
  const snapshotOf = async (topic: LiveTopic): Promise<LiveServerMessage> => {
    switch (topic) {
      case 'runs': {
        const payload: RunsPayload = await listRuns();
        onRuns?.(payload.runs);
        return { type: 'runs.snapshot', ...payload };
      }
      case 'sessions':
        return { type: 'sessions.changed', sessions: await listSessions() };
      case 'workspaces':
        return { type: 'workspaces.snapshot', ...(await listWorkspaces()) };
      case 'system':
        return { type: 'system.memory', ...(await readMemory()) };
    }
  };

  return async (topic: LiveTopic, client: WsClient): Promise<void> => {
    try {
      client.send(await snapshotOf(topic));
    } catch (error: unknown) {
      logger?.warn('snapshot failed', {
        topic,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  };
};
