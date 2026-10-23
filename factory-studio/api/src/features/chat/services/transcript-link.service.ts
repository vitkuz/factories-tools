import path from 'node:path';
import type { ZodSafeParseResult } from 'zod';
import type { FsClient } from '../../../clients/fs/fs.types.js';
import type { HerdrClient, HerdrPane, HerdrWorkspace } from '../../../clients/herdr/herdr.types.js';
import type { TranscriptClient } from '../../../clients/transcript/transcript.types.js';
import { isSafeSegment } from '../../documents/documents.utils.js';
import { transcriptLinkSchema } from '../chat.schema.js';
import type { ResolvedTranscript, SessionStartPayload, TranscriptLink } from '../chat.types.js';
import { isTranscriptPath, transcriptLinkFileName, transcriptPathFor } from '../chat.utils.js';

export interface TranscriptLinkSettings {
  fs: FsClient;
  promptDir: string;
  /** `~/.claude/projects`: the only folder a transcript is read from. */
  projectsDir: string;
  now?: () => Date;
}

/**
 * `<PROMPT_DIR>/<session>.transcript.json`, 0600, written when the SessionStart hook reports
 * where Claude writes the session. A new start (`/clear`, a resume) writes it again. `false`
 * when the session name or the path is not one this API reads.
 */
export const recordTranscriptLinkFactory =
  ({ fs, promptDir, projectsDir, now = (): Date => new Date() }: TranscriptLinkSettings) =>
  async (payload: SessionStartPayload): Promise<boolean> => {
    if (!isSafeSegment(payload.sessionId)) return false;
    if (!isTranscriptPath(projectsDir, payload.transcriptPath)) return false;
    const link: TranscriptLink = {
      claudeSessionId: payload.claudeSessionId,
      transcriptPath: path.resolve(payload.transcriptPath),
      at: now().toISOString(),
    };
    await fs.writePrivateText(
      promptDir,
      transcriptLinkFileName(payload.sessionId),
      JSON.stringify(link),
    );
    return true;
  };

export const readTranscriptLinkFactory =
  ({ fs, promptDir, projectsDir }: Omit<TranscriptLinkSettings, 'now'>) =>
  async (session: string): Promise<TranscriptLink | null> => {
    if (!isSafeSegment(session)) return null;
    const read = await fs.readJson(path.join(promptDir, transcriptLinkFileName(session)));
    if (!read.ok) return null;
    const parsed: ZodSafeParseResult<TranscriptLink> = transcriptLinkSchema.safeParse(read.value);
    return parsed.success && isTranscriptPath(projectsDir, parsed.data.transcriptPath)
      ? parsed.data
      : null;
  };

export interface ResolveTranscriptSettings {
  readLink: (session: string) => Promise<TranscriptLink | null>;
  herdr: Pick<HerdrClient, 'listWorkspaces' | 'listPanes'>;
  transcripts: Pick<TranscriptClient, 'size'>;
  projectsDir: string;
  /** Where studio sessions start, for a pane that reports no cwd. */
  workDir: string;
}

export type ResolveTranscriptResult =
  | { ok: true; transcript: ResolvedTranscript }
  | { ok: false; reason: 'unknown-session' | 'no-transcript' };

/**
 * Where a studio session's transcript is: what its SessionStart hook reported, else (a session
 * started before the hook, or a hook that failed) the Claude session id herdr's integration
 * saw in its pane, under the project folder of the pane's working directory. A path counts
 * only once the file is there.
 */
export const resolveTranscriptFactory =
  ({ readLink, herdr, transcripts, projectsDir, workDir }: ResolveTranscriptSettings) =>
  async (session: string): Promise<ResolveTranscriptResult> => {
    const [workspaces, panes]: [HerdrWorkspace[], HerdrPane[]] = await Promise.all([
      herdr.listWorkspaces(),
      herdr.listPanes(),
    ]);
    const workspace: HerdrWorkspace | undefined = workspaces.find(
      (candidate: HerdrWorkspace): boolean => candidate.label === session,
    );
    if (workspace === undefined) return { ok: false, reason: 'unknown-session' };
    const link: TranscriptLink | null = await readLink(session);
    if (link !== null && (await transcripts.size(link.transcriptPath)) !== null) {
      return {
        ok: true,
        transcript: { claudeSessionId: link.claudeSessionId, path: link.transcriptPath },
      };
    }
    const pane: HerdrPane | undefined = panes.find(
      (candidate: HerdrPane): boolean =>
        candidate.workspaceId === workspace.workspaceId && candidate.agentSessionId !== undefined,
    );
    if (pane?.agentSessionId === undefined) return { ok: false, reason: 'no-transcript' };
    const agentSessionId: string = pane.agentSessionId;
    // The project folder is named after the directory Claude started in: the pane's, or the
    // studio's work dir when the pane has moved on.
    const candidates: string[] = [...new Set([pane.cwd, workDir].filter(Boolean))].map(
      (cwd: string): string => transcriptPathFor(projectsDir, cwd, agentSessionId),
    );
    const sizes: (number | null)[] = await Promise.all(
      candidates.map((file: string): Promise<number | null> => transcripts.size(file)),
    );
    const found: string | undefined = candidates.find(
      (_file: string, i: number): boolean => sizes[i] !== null && sizes[i] !== undefined,
    );
    return found === undefined
      ? { ok: false, reason: 'no-transcript' }
      : { ok: true, transcript: { claudeSessionId: agentSessionId, path: found } };
  };
