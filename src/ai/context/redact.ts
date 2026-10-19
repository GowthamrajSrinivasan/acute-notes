/**
 * Defense in depth for the standing invariant "secrets never enter AI
 * context" (tracker §1, PRD §13.15.13). The app's own secrets (BYOK keys,
 * GitHub/OAuth tokens) live only in the credential store, which neither the
 * search index nor the context builder can reach. This pass covers the other
 * way one could leak: a credential pasted into a note. Anything shaped like a
 * well-known token or key is replaced before it is indexed or sent.
 *
 * Deliberately conservative: only distinctive shapes (vendor prefixes,
 * PEM blocks, JWTs, `api_key = …` assignments), so ordinary prose and code
 * are left alone.
 */
export const REDACTED = "[redacted]";

const PATTERNS: readonly [RegExp, string][] = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g, `-----BEGIN PRIVATE KEY----- ${REDACTED}`],
  [/\b(gh[opusr]_|github_pat_)[A-Za-z0-9_]{10,}/g, `$1${REDACTED}`],
  [/\b(sk-(?:ant-|proj-|live-|test-|or-)?)[A-Za-z0-9_-]{16,}/g, `$1${REDACTED}`],
  [/\bAIza[0-9A-Za-z_-]{30,}/g, `AIza${REDACTED}`],
  [/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, REDACTED],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}/g, REDACTED],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, REDACTED],
  [/(\bBearer\s+)[A-Za-z0-9._~+/-]{16,}=*/gi, `$1${REDACTED}`],
  [
    /(\b(?:api[_-]?key|secret[_-]?key|client[_-]?secret|access[_-]?token|auth[_-]?token|password|passwd)\b["']?\s*[:=]\s*["']?)[^\s"'`,;]{8,}/gi,
    `$1${REDACTED}`,
  ],
];

/** `text` with anything credential-shaped replaced by `[redacted]`. */
export function redactSecrets(text: string): string {
  let out = text;
  for (const [pattern, replacement] of PATTERNS) out = out.replace(pattern, replacement);
  return out;
}
