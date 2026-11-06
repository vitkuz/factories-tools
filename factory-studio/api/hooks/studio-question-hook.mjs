#!/usr/bin/env node
// Factory Studio hook for Claude Code (SessionStart, and PreToolUse and PostToolUse on
// AskUserQuestion).
//
// SessionStart: tells the studio API where Claude writes this session's transcript, so the app
// can show the session live as a chat. Prints nothing: a SessionStart hook's stdout would be
// added to Claude's context.
// PreToolUse: posts the question to the studio API and blocks until a person answers it in the
// app. The answers go back to Claude as `updatedInput.answers`, so Claude's own dialog never
// opens. The API holds one request for a while and then says `wait`: the hook posts the same
// question again at once and gets the same pending question back. An API that cannot be
// reached (restarting after a deploy, not up yet) is asked again every few seconds for as
// long as the hook lives: the question is on the API's disk, so nothing is lost meanwhile.
// A dismissal, or an API that refuses the request, prints nothing and exits 0, which makes
// Claude open its normal dialog in the terminal.
// PostToolUse: tells the API the question is over, however it was answered.
//
// Plain ESM, no dependencies. `node:http` rather than fetch: undici's 5 minute header timeout
// would cut a long wait short.
import http from 'node:http';
import https from 'node:https';
import { pathToFileURL } from 'node:url';

/** How long to wait before asking an unreachable API again. */
export const RETRY_MS = 3000;

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

/**
 * What to do after one ask request. `done`: the reply is final (an answer, a dismissal).
 * `again`: the API cut the long poll (`wait`), ask again at once. `retry`: the API could not
 * be reached or failed (no response, a 5xx), ask again after `RETRY_MS`. `give-up`: the API
 * refused the request (a 4xx: a bad body, a wrong key) and would again.
 */
export const decideNext = (result) => {
  if (result.status === 0 || result.status >= 500) return 'retry';
  if (result.status !== 200) return 'give-up';
  return result.body && result.body.action === 'wait' ? 'again' : 'done';
};

const readStdin = async () => {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
};

/**
 * POST JSON, wait as long as it takes. Resolves with `{ status, body }`: `status` 0 when the
 * request never got a response, `body` the parsed JSON or `null`.
 */
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
            try {
              resolve({
                status: res.statusCode ?? 0,
                body: JSON.parse(Buffer.concat(parts).toString('utf8')),
              });
            } catch {
              resolve({ status: res.statusCode ?? 0, body: null });
            }
          });
          res.on('error', () => resolve({ status: 0, body: null }));
        },
      );
      req.on('error', () => resolve({ status: 0, body: null }));
      req.end(payload);
    } catch {
      resolve({ status: 0, body: null });
    }
  });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Asks until the API gives a final reply or refuses; `null` when the dialog should open. */
export const askUntilAnswered = async (post, body, retryMs = RETRY_MS) => {
  for (;;) {
    const result = await post(body);
    const next = decideNext(result);
    if (next === 'done') return result.body;
    if (next === 'give-up') return null;
    if (next === 'retry') await sleep(retryMs);
  }
};

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
    const reply = await askUntilAnswered(
      (body) => postJson(baseUrl, '/api/v1/hooks/ask-user-question', body, apiKey),
      buildAskBody(event, sessionId),
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
