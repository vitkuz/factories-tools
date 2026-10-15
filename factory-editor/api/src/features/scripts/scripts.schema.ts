import { z } from 'zod';

/**
 * The raw URL remainder after `/scripts/`: never empty, never absurdly long. Everything
 * else about it — encoding, `..`, separators — is the document path parser's to refuse.
 */
export const scriptRawPathSchema = z.string().min(1).max(1024);
