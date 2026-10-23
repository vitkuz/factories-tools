#!/usr/bin/env node
// Factory Studio hook for Claude Code (SessionStart, and PreToolUse and PostToolUse on
// AskUserQuestion).
//
// SessionStart: tells the studio API where Claude writes this session's transcript, so the app
// can show the session live as a chat. Prints nothing: a SessionStart hook's stdout would be
// added to Claude's context.
// PreToolUse: posts the question to the studio API and blocks until a person answers it in the
// app. The answers go back to Claude as `updatedInput.answers`, so Claude's own dialog never
// opens. Any failure, a dismissal or no studio around prints nothing and exits 0, which makes
// Claude open its normal dialog in the terminal.
// PostToolUse: tells the API the question is over, however it was answered.
//
// Plain ESM, no dependencies. `node:http` rather than fetch: undici's 5 minute header timeout
// would cut a long wait short.
import http from 'node:http';
import https from 'node:https';
import { pathToFileURL } from 'node:url';

/** The PreToolUse stdout that makes Claude take `answers` and skip its dialog. */
export const buildAllowOutput = (toolInput, answers) => ({
  hookSpecificOutput: {
    hookEventName: 'PreToolUse',
    permissionDecision: 'allow',
    updatedInput: { ...toolInput, answers },
  },
});

/** The body the API's ask-user-question route takes. */
export const buildAskBody = (event, sessionId) => ({
  sessionId,
  claudeSessionId: event.session_id,
  transcriptPath: event.transcript_path,
  toolUseId: event.tool_use_id ?? '',
  toolInput: event.tool_input ?? {},
});

/** The body the API's session-start route takes. */
export const buildSessionStartBody = (event, sessionId) => ({
  sessionId,
  claudeSessionId: event.session_id ?? '',
  transcriptPath: event.transcript_path ?? '',
  source: event.source ?? '',
});

export const buildResolvedBody = (event, sessionId) => ({
  sessionId,
  toolUseId: event.tool_use_id ?? '',
  answers: event.tool_response?.answers,
});

/** `{action:'answer', answers}` -> stdout JSON; anything else -> `null` (print nothing). */
export const decideOutput = (toolInput, reply) =>
  reply && reply.action === 'answer' && reply.answers && typeof reply.answers === 'object'
    ? buildAllowOutput(toolInput, reply.answers)
    : null;

const readStdin = async () => {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
};

/** POST JSON, wait as long as it takes. Resolves with the parsed body, or `null` on any error. */
export const postJson = (baseUrl, path, body, apiKey) =>
  new Promise((resolve) => {
    try {
      const url = new URL(`${baseUrl.replace(/\/$/, '')}${path}`);
      const payload = JSON.stringify(body);
      const transport = url.protocol === 'https:' ? https : http;
      const req = transport.request(
        url,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'content-length': Buffer.byteLength(payload),
            ...(apiKey ? { 'x-api-key': apiKey } : {}),
          },
        },
        (res) => {
          const parts = [];
          res.on('data', (part) => parts.push(part));
          res.on('end', () => {
            if (res.statusCode !== 200) return resolve(null);
            try {
              resolve(JSON.parse(Buffer.concat(parts).toString('utf8')));
            } catch {
              resolve(null);
            }
          });
          res.on('error', () => resolve(null));
        },
      );
      req.on('error', () => resolve(null));
      req.end(payload);
    } catch {
      resolve(null);
    }
  });

const main = async () => {
  const sessionId = process.env.STUDIO_SESSION_ID;
  const baseUrl = process.env.STUDIO_API_URL;
  if (!sessionId || !baseUrl) return;
  const apiKey = process.env.STUDIO_API_KEY;
  const event = JSON.parse(await readStdin());

  if (event.hook_event_name === 'SessionStart') {
    await postJson(
      baseUrl,
      '/api/v1/hooks/session-start',
      buildSessionStartBody(event, sessionId),
      apiKey,
    );
    return;
  }
  if (event.hook_event_name === 'PreToolUse') {
    const reply = await postJson(
      baseUrl,
      '/api/v1/hooks/ask-user-question',
      buildAskBody(event, sessionId),
      apiKey,
    );
    const output = decideOutput(event.tool_input ?? {}, reply);
    if (output) process.stdout.write(`${JSON.stringify(output)}\n`);
    return;
  }
  if (event.hook_event_name === 'PostToolUse') {
    await postJson(
      baseUrl,
      '/api/v1/hooks/question-resolved',
      buildResolvedBody(event, sessionId),
      apiKey,
    );
  }
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(
    () => process.exit(0),
    () => process.exit(0),
  );
}
