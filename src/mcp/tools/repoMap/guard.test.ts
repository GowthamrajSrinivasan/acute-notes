/**
 * Standing invariants of F43: the repo-map tools never read the repository,
 * run git, or call a model — "the IDE agent pays for understanding; Acute
 * pays for nothing but local CPU". Checked on the module's whole static and
 * dynamic import graph (through `@/` and relative imports), not only its own
 * files. And auto-accept is the user's alone: no MCP code turns it on.
 */
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { findSecret } from "./secrets";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, "../../..");

/** Module specifiers the map must never reach, directly or transitively. */
const FORBIDDEN: RegExp[] = [
  /^(node:)?fs(\/promises)?$/,
  /^(node:)?child_process$/,
  /^(node:)?(net|http|https|worker_threads)$/,
  /^@\/ai\/runtime$/,
  /^@\/ai\/providerManager$/,
  /^@\/ai\/providers(\/|$)/,
  /^@\/ai\/host(\/|$)/,
  /^@\/ai\/tasks$/,
  /^@\/ai\/visualize(\/|$)/,
  /^@\/ai\/credentials(\/|$)/,
  /^@github\/copilot-sdk/,
];

const code = (file: string) =>
  readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

/** Runtime imports only: `import type` / `export type` are erased and load nothing. */
function specifiers(file: string): string[] {
  const src = code(file);
  const out: string[] = [];
  const statements = /(?:^|[;\n])\s*(?:import|export)\s+(type\s+)?(?:[^;]*?\s+from\s+)?["']([^"']+)["']/g;
  for (let m = statements.exec(src); m; m = statements.exec(src)) if (!m[1]) out.push(m[2]!);
  const dynamic = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;
  for (let m = dynamic.exec(src); m; m = dynamic.exec(src)) out.push(m[1]!);
  return out;
}

function resolveFile(spec: string, from: string): string | null {
  const base = spec.startsWith("@/") ? join(SRC, spec.slice(2)) : spec.startsWith(".") ? resolve(dirname(from), spec) : null;
  if (!base) return null;
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

/** Every module the repo-map files reach, with the chain that reaches each forbidden one. */
function walk(entries: string[]): { visited: Set<string>; offenders: string[] } {
  const visited = new Set<string>();
  const offenders: string[] = [];
  const queue: { file: string; chain: string[] }[] = entries.map((f) => ({ file: f, chain: [relative(SRC, f)] }));
  while (queue.length) {
    const { file, chain } = queue.shift()!;
    if (visited.has(file)) continue;
    visited.add(file);
    for (const spec of specifiers(file)) {
      if (FORBIDDEN.some((re) => re.test(spec))) offenders.push(`${chain.join(" → ")} → ${spec}`);
      const next = resolveFile(spec, file);
      if (next && !visited.has(next)) queue.push({ file: next, chain: [...chain, relative(SRC, next)] });
    }
  }
  return { visited, offenders };
}

const repoMapFiles = readdirSync(HERE)
  .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f))
  .map((f) => join(HERE, f));

describe("F43 guard: no repository reading, git or model calls from the repo-map tools", () => {
  it("the module and everything it imports reach no file system, process, network, AI runtime or provider", () => {
    expect(repoMapFiles.length).toBeGreaterThan(4);
    const { visited, offenders } = walk(repoMapFiles);
    expect(visited.size).toBeGreaterThan(repoMapFiles.length); // the walk really follows imports
    expect(offenders).toEqual([]);
  });

  it("the guard itself catches a forbidden import", () => {
    expect(FORBIDDEN.some((re) => re.test("node:child_process"))).toBe(true);
    expect(FORBIDDEN.some((re) => re.test("@/ai/runtime"))).toBe(true);
    expect(FORBIDDEN.some((re) => re.test("@/ai/providers/copilot"))).toBe(true);
    // e.g. "Update from new content" calls the AI runtime: reachable from it, so it must stay out of the map's graph.
    expect(walk([join(SRC, "ai", "reconcile", "update.ts")]).offenders.length).toBeGreaterThan(0);
  });

  it("no MCP code can turn on auto-accept (only the review bar calls `enable`)", () => {
    const files: string[] = [];
    const collect = (dir: string) => {
      for (const e of readdirSync(dir)) {
        const full = join(dir, e);
        if (statSync(full).isDirectory()) collect(full);
        else if (/\.tsx?$/.test(e) && !/\.test\.tsx?$/.test(e)) files.push(full);
      }
    };
    collect(join(SRC, "mcp"));
    const callers = files.filter((f) => /sessionAutoAccept\s*\.\s*enable\b/.test(code(f))).map((f) => relative(SRC, f).split(sep).join("/"));
    expect(callers).toEqual([]);
    const everywhere: string[] = [];
    const all: string[] = [];
    const collectAll = (dir: string) => {
      for (const e of readdirSync(dir)) {
        const full = join(dir, e);
        if (statSync(full).isDirectory()) collectAll(full);
        else if (/\.tsx?$/.test(e) && !/\.test\.tsx?$/.test(e)) all.push(full);
      }
    };
    collectAll(SRC);
    for (const f of all) if (/sessionAutoAccept\s*\.\s*enable\b/.test(code(f))) everywhere.push(relative(SRC, f).split(sep).join("/"));
    expect(everywhere).toEqual(["components/ai/ChangeSetReview.tsx"]);
  });
});

describe("F43 possible_secret patterns", () => {
  const secrets = [
    "-----BEGIN OPENSSH PRIVATE KEY-----",
    "-----BEGIN PRIVATE KEY-----",
    "key AKIAIOSFODNN7EXAMPLE",
    "aws_secret_access_key = wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
    `ghp_${"A1".repeat(18)}`,
    `github_pat_${"a".repeat(60)}`,
    "xoxb-123456789012-abcdefghij",
    `sk_live_${"a".repeat(24)}`,
    `sk-${"x".repeat(40)}`,
    `AIza${"B".repeat(35)}`,
    "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U",
    "DefaultEndpointsProtocol=https;AccountName=x;AccountKey=" + "a".repeat(44),
    "postgres://admin:hunter22pass@db.internal:5432/app",
    "DB_PASSWORD=Sup3r-S3cret!",
    'const apiKey = "a8f5f167f44f4964e6c998dee827110c";',
    "client_secret: 9d8f7a6b5c4d3e2f1a0b",
  ];
  const fine = [
    "Reads GITHUB_TOKEN from the environment and retries once.",
    "const token = process.env.GITHUB_TOKEN;",
    "API_KEY=${API_KEY}",
    "password: <your password>",
    "DB_PASSWORD=changeme",
    "token = refreshToken(session)",
    "The secret manager rotates keys nightly.",
    "sk-short",
    "Uses https://example.com/docs for reference.",
    "apiKey: config.apiKey",
  ];
  it.each(secrets)("flags %s", (s) => expect(findSecret(s)).not.toBeNull());
  it.each(fine)("lets through %s", (s) => expect(findSecret(s)).toBeNull());
});
