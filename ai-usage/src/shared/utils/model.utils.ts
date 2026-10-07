/**
 * Normalizes provider model identifiers so rate cards can be matched across
 * spellings: "claude-opus-4.6" == "claude-opus-4-6" == "claude-opus-4-6-20260101" == "claude-opus-4-6[1m]".
 */
export const normalizeModelId = (model: string): string =>
  model
    .trim()
    .toLowerCase()
    .replace(/\[.*?\]$/, "")
    .replace(/@.*$/, "")
    .replace(/-\d{8}$/, "")
    .replace(/(\d)\.(\d)/g, "$1-$2")
    .replace(/^(?:anthropic|openai|github)\//, "");
