/**
 * The `possible_secret` backstop (F43). The agent is told never to send
 * secrets; as a second line, text matching one of these high-confidence
 * patterns rejects the whole call. Patterns are deliberately narrow (real key
 * formats, private-key blocks, literal credential assignments) so ordinary
 * code descriptions ("reads GITHUB_TOKEN from the environment") pass.
 * A match is reported by pattern name only — never with the matched value.
 */

export interface SecretPattern {
  name: string;
  test: RegExp;
}

/** Values that are clearly not a real secret: env lookups, templates, placeholders. */
const PLACEHOLDER = /^(?:process\.env|import\.meta\.env|os\.environ|env[.(\[]|\$\{?|<|\{\{|%|your|xxx|changeme|change_me|example|placeholder|dummy|redacted|replace|todo|secret$|password$|token$|\*{3,}|\.{3})/i;

export const SECRET_PATTERNS: readonly SecretPattern[] = [
  { name: "private key block", test: /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----/ },
  { name: "AWS access key id", test: /\b(?:AKIA|ASIA|ABIA|ACCA)[0-9A-Z]{16}\b/ },
  { name: "AWS secret access key", test: /aws_?secret_?access_?key\s*["']?\s*[:=]\s*["']?[A-Za-z0-9/+=]{40}\b/i },
  { name: "GitHub token", test: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{50,})\b/ },
  { name: "GitLab token", test: /\bglpat-[A-Za-z0-9_-]{20,}\b/ },
  { name: "Slack token", test: /\bxox[abposr]-[A-Za-z0-9-]{10,}\b/ },
  { name: "Stripe key", test: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\b/ },
  { name: "sk- prefixed API key", test: /\bsk-(?:ant-|proj-|svcacct-)?[A-Za-z0-9_-]{32,}\b/ },
  { name: "Google API key", test: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { name: "npm token", test: /\bnpm_[A-Za-z0-9]{36}\b/ },
  { name: "JSON web token", test: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/ },
  { name: "Azure storage key", test: /\bAccountKey=[A-Za-z0-9+/=]{40,}/ },
  { name: "connection string with a password", test: /\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:[^\s@/]{6,}@[^\s/]+/i },
];

/**
 * A `.env`-style or code assignment of a literal to a credential-named variable, e.g. `DB_PASSWORD=s3cr3t-value`
 * or `apiKey: "abcd1234efgh"` — unless the value is an env lookup or a placeholder.
 */
const ASSIGNMENT = /(?:^|[\s{,;(])["']?([A-Za-z0-9_.-]*(?:secret|token|passwd|password|pwd|api[_-]?key|apikey|private[_-]?key|access[_-]?key|client[_-]?secret|auth[_-]?key)[A-Za-z0-9_]*)["']?\s*[:=]\s*(["']?)([^\s"'`,;)]{8,})\2/gim;

/** The first secret-looking thing in `text`, by pattern name; null when there is none. */
export function findSecret(text: string): string | null {
  for (const p of SECRET_PATTERNS) if (p.test.test(text)) return p.name;
  ASSIGNMENT.lastIndex = 0;
  for (let m = ASSIGNMENT.exec(text); m; m = ASSIGNMENT.exec(text)) {
    const value = m[3]!;
    if (PLACEHOLDER.test(value)) continue;
    // A value made only of letters is a word or identifier (`token = refreshed`), not a credential.
    if (/^[A-Za-z_]+$/.test(value) || /^[A-Za-z_][\w.]*\(/.test(value) || /^[\w.]+\.[A-Za-z_]+$/.test(value)) continue;
    return "credential assignment";
  }
  return null;
}
