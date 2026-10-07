/**
 * The URL of every endpoint the app calls, as absolute same-origin paths. One place, so a
 * `<img src>` inside a document and the adapter's own request see the same string.
 */

export const API_PREFIX = '/api/v1';

/**
 * A document path with each segment URL-encoded and a trailing `/` kept, so a folder stays
 * a folder on the wire. Safety (`..`, absolute paths) is the API's to refuse, not ours.
 */
export const encodeDocPath = (path: string): string =>
  path
    .split('/')
    .filter((seg: string, i: number, all: string[]): boolean => seg !== '' || i === all.length - 1)
    .map(encodeURIComponent)
    .join('/');

export const pipelinesPath = (): string => `${API_PREFIX}/pipelines`;

export const pipelinePath = (id: string): string =>
  `${API_PREFIX}/pipelines/${encodeURIComponent(id)}`;

export const knowledgeDocPath = (id: string, path: string): string =>
  `${pipelinePath(id)}/knowledge/${encodeDocPath(path)}`;

export const runsPath = (): string => `${API_PREFIX}/runs`;

export const runDocPath = (pipelineId: string, runId: string, path: string): string =>
  `${API_PREFIX}/runs/${encodeURIComponent(pipelineId)}/${encodeURIComponent(runId)}/${encodeDocPath(path)}`;

/** A hook script of the repository (`scripts/<path>`), read-only. */
export const scriptPath = (path: string): string => `${API_PREFIX}/scripts/${encodeDocPath(path)}`;

export const sessionsPath = (): string => `${API_PREFIX}/sessions`;

export const stopSessionPath = (): string => `${API_PREFIX}/sessions/stop`;
