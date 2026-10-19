/**
 * The scenario behind `chatUpdate.test.ts`: a synthetic ChatGPT conversation at three sizes, imported as notes and then updated from the chat and a
 * branch of it, and the checks that must hold afterwards. It runs against whatever decision model it is given:
 *
 *  - `mockJev`: a deterministic stand-in (`chatUpdate.test.ts`, always);
 *  - `replayDecisions`: the answers a real Jev gave to these exact requests, recorded once (`chatUpdateReplay.test.ts`, offline);
 *  - the real Jev (`contractTests/chatUpdateJev.contract.test.ts`, opt-in, spends money, records what `replayDecisions` replays).
 */
import { expect, vi } from "vitest";
import { AIProviderManager } from "@/ai/providerManager";
import { createMockProvider } from "@/ai/providers/mock/mockProvider";
import { createAIRuntime } from "@/ai/runtime";
import { createTaskRegistry } from "@/ai/tasks";
import type { DecisionAnswer, DecisionProvider, DecisionRequest, DecisionResult } from "@/ai/decisions/types";
import { registerMergeTasks } from "@/ai/merge/assign";
import { registerRevisionTasks } from "@/ai/history/revisions";
import { registerVisualizeTasks } from "@/ai/visualize/tasks";
import type { ChatTranscript, ChatTurn } from "@/ai/import/chatShare/types";
import type { AIRequest } from "@/ai/types";
import type { VisualPlan } from "@/ai/visual-plan/types";
import type { ContentSourceRepository } from "@/persistence/repositories/types";
import { accepted, acceptUpdate, context, parse, response, type Accepted } from "@/testUtils/reconcileHarness";
import { ingestContent, type IngestPorts, type IngestResult } from "../ingest";
import { importSharedChats, type FetchLike } from "../sharedChats";

// ---- a synthetic ChatGPT conversation ---------------------------------------------------------------------------------------------------------

const LETTERS = "abcdefghijklmnopqrstuvwxyz";
/** A number as letters, so no digit appears in a fact (digits are reserved for the price sentences a contradiction is made of). */
const word = (n: number): string => (n < 26 ? LETTERS[n]! : word(Math.floor(n / 26) - 1) + LETTERS[n % 26]!);
/** The distinctive word of topic `i`: what the mock decision model recognises a topic by. */
const kw = (i: number) => `kw${word(i)}z`;
export const title = (i: number) => `Topic ${word(i)} ${kw(i)}`;
/** A fact no other topic's facts resemble: its words come from the topic and version (so repeats and neighbours are never mistaken for each other). */
const w = (i: number, v: number, j: number) => word(26 + ((Math.imul(i + 1, 2654435761) ^ Math.imul(v + 1, 40503) ^ Math.imul(j + 1, 9973)) >>> 0) % 17000);
export const fact = (i: number, v: number) => `${w(i, v, 1)} ${kw(i)} ${w(i, v, 2)} ${w(i, v, 3)} ${w(i, v, 4)} ${w(i, v, 5)} ${w(i, v, 6)} ${w(i, v, 7)} ${w(i, v, 8)}.`;
export const price = (i: number, dollars: number) => `${w(i, 9, 1)} ${w(i, 9, 2)} price of ${kw(i)} ${w(i, 9, 3)} is ${dollars} dollars per month.`;

export interface Plan {
  /** Topics the first chat covers, and how many of its answers the branch shares. */
  topics: number;
  shared: number;
  /** In the branch: existing topics that gain a new fact, new subjects, and priced topics whose price it contradicts. */
  extend: number[];
  fresh: number;
  contradict: number[];
  /** Topics that state a price (the first chat says 12 dollars). */
  priced: (k: number) => boolean;
}

export const SIZES: Record<string, Plan> = {
  small: { topics: 3, shared: 2, extend: [1], fresh: 1, contradict: [0], priced: (k) => k === 0 },
  medium: { topics: 20, shared: 12, extend: [1, 3, 7, 13], fresh: 3, contradict: [0, 10], priced: (k) => k % 5 === 0 },
  large: { topics: 80, shared: 50, extend: Array.from({ length: 15 }, (_, n) => 2 + n * 5), fresh: 15, contradict: [0, 16, 40], priced: (k) => k % 8 === 0 },
};

const turn = (id: string, index: number, role: ChatTurn["role"], markdown: string): ChatTurn => ({ id, index, role, markdown, hash: `${role}:${markdown}` });
/** A question and its answer; a follow-up asks about the topic again, in words of its own (a repeated question would itself be a repeat). */
const exchange = (k: number, index: number, markdown: string, followUp = false): ChatTurn[] => [
  turn(`u${index}`, index, "user", followUp ? `Any more on ${title(k)}? (${index})` : `Tell me about ${title(k)}.`),
  turn(`a${index}`, index + 1, "assistant", markdown),
];
const answer = (k: number, body: string[]) => [`## ${title(k)}`, ...body].join("\n\n");

export const URL_A = "https://chatgpt.com/share/6ac75678-829c-83ee-aaf4-badd93c19df4";
export const URL_B = "https://chatgpt.com/share/6ac75691-b3c8-83e8-a831-880f86f446c8";

export function conversations(plan: Plan) {
  const firstTurns: ChatTurn[] = [];
  // A priced topic is long and states its price last: the decision model reads only an excerpt of each topic (800 characters with 20 topics, 400 with
  // many), which does not reach the price, so the change of price is found by its changed number, not by what the relation question saw.
  const long = Array.from({ length: 22 }, (_, v) => v + 2);
  const own = (k: number) => answer(k, plan.priced(k) ? [fact(k, 0), fact(k, 1), ...long.map((v) => fact(k, v)), price(k, 12)] : [fact(k, 0), fact(k, 1)]);
  for (let k = 0; k < plan.topics; k++) firstTurns.push(...exchange(k, k * 2, own(k)));
  const A: ChatTranscript = { provider: "chatgpt", url: URL_A, shareId: "6ac75678-829c-83ee-aaf4-badd93c19df4", conversationId: "c1", title: "Product notes", turns: firstTurns };

  const branchTurns: ChatTurn[] = firstTurns.slice(0, plan.shared * 2);
  let at = branchTurns.length;
  const added: { extend: string[]; fresh: string[]; contradict: { old: string; now: string }[]; newFacts: string[] } = { extend: [], fresh: [], contradict: [], newFacts: [] };
  for (const k of plan.extend) {
    const f = fact(k, 40 + k);
    branchTurns.push(...exchange(k, at, answer(k, [f]), true));
    added.extend.push(f);
    at += 2;
  }
  for (let n = 0; n < plan.fresh; n++) {
    const k = plan.topics + n;
    const body = [fact(k, 0), fact(k, 1)];
    branchTurns.push(...exchange(k, at, answer(k, body)));
    added.fresh.push(...body);
    at += 2;
  }
  for (const k of plan.contradict) {
    const f = fact(k, 80 + k);
    branchTurns.push(...exchange(k, at, answer(k, [f, price(k, 15)]), true));
    added.contradict.push({ old: price(k, 12), now: price(k, 15) });
    added.newFacts.push(f);
    at += 2;
  }
  const B: ChatTranscript = {
    provider: "chatgpt",
    url: URL_B,
    shareId: "6ac75691-b3c8-83e8-a831-880f86f446c8",
    conversationId: "c2",
    title: "Branch · Product notes",
    branchedFrom: { conversationId: "c1", title: "Product notes", atTurnId: firstTurns[plan.shared * 2 - 1]!.id },
    turns: branchTurns,
  };
  return { A, B, added };
}

const fetchOf =
  (known: Record<string, ChatTranscript>): FetchLike =>
  async (_url, init) => {
    const transcript = known[(JSON.parse(init.body) as { url: string }).url];
    return transcript ? { ok: true, json: async () => ({ transcript }) } : { ok: false, json: async () => ({ error: "not found" }) };
  };

// ---- the models -------------------------------------------------------------------------------------------------------------------------------

const KEYWORD = /kw[a-z]+z/;
const sentences = (text: string) => text.split(/\r?\n/).filter((l) => !l.startsWith("#")).join(" ").split(/(?<=\.)\s+/).map((x) => x.trim()).filter(Boolean);
const PRICE = /^(.+) is (\d+) dollars per month\.$/;
/** A price sentence in `text` that says a different number than one in `other`, about the same thing: a contradiction. */
const contradicts = (text: string, other: string) =>
  sentences(text).some((s) => {
    const m = PRICE.exec(s);
    return !!m && sentences(other).some((o) => PRICE.exec(o)?.[1] === m[1] && PRICE.exec(o)![2] !== m[2]);
  });

const choice = (value: string): DecisionAnswer => ({ type: "choice", choice: value, confidence: 0.95, probabilities: { [value]: 0.95 } });

/** A deterministic stand-in for Jev: it answers the typed questions the merge asks, by the topics' distinctive words and the price sentences. */
export function mockJev(): DecisionProvider {
  return {
    id: "openrouter",
    name: "Jev",
    model: "typesafe/jev-1.13",
    decide: async (request: DecisionRequest) => {
      const answers: Record<string, DecisionAnswer> = {};
      const state = request.state as { topics?: { id: string; label: string; text: string }[]; new_content?: string };
      const topicFor = () => {
        const marker = KEYWORD.exec(state.new_content ?? "")?.[0];
        // By the topic's own name: a chat's quoted question sits at the end of the section before it, so its text names the next topic too.
        return marker ? state.topics?.find((t) => t.label.includes(marker)) : undefined;
      };
      for (const [name, q] of Object.entries(request.questions)) {
        const part = /^(p\d+)_/.exec(name)![1]!;
        if (name.endsWith("_topic")) {
          answers[name] = choice(topicFor()?.id ?? "new");
        } else if (name.endsWith("_relation")) {
          const topic = topicFor();
          answers[name] = choice(topic && contradicts(state.new_content ?? "", topic.text) ? "contradicts" : "adds");
        } else if (name.endsWith("_nothing_new")) {
          const topic = topicFor();
          const body = (state.new_content ?? "").split(/\r?\n/).filter((l) => !l.startsWith("#")).join(" ");
          const nothing = !!topic && sentences(body).every((s) => topic.text.includes(s));
          answers[name] = { type: "boolean", probability: nothing ? 0.97 : 0.03 };
        } else if (/_s\d+_contradicts$/.test(name) && q.type === "choice") {
          const statement = /“([^”]+)”/.exec(q.instructions)?.[1] ?? "";
          const hit = q.choices.find((c) => c.description && contradicts(statement, c.description));
          answers[name] = choice(hit?.value ?? "none");
        } else answers[`${part}_unknown`] = choice("unsure");
      }
      return { answers, usage: { provider: "openrouter", model: "jev", promptTokens: 10 } };
    },
  };
}

/** What identifies a decision request: its state and its questions (names and wording), as the merge builds them. */
export const requestKey = (request: DecisionRequest): string => JSON.stringify({ state: request.state, questions: request.questions });

export interface RecordedDecision {
  key: string;
  answers: Record<string, DecisionAnswer>;
  usage: DecisionResult["usage"];
}

/** A decision model that passes every request to `inner` and keeps what it answered. */
export function recordDecisions(inner: DecisionProvider): { provider: DecisionProvider; log: RecordedDecision[] } {
  const log: RecordedDecision[] = [];
  return {
    log,
    provider: {
      id: inner.id,
      name: inner.name,
      model: inner.model,
      decide: async (request, options) => {
        const result = await inner.decide(request, options);
        log.push({ key: requestKey(request), answers: result.answers, usage: result.usage });
        return result;
      },
    },
  };
}

/**
 * A decision model that answers from a recording, by request. A request that was not recorded (the scenario or the questions changed: record
 * again) is listed in `misses` and fails the call, which makes the runtime fall back to the chat task, as it would for a real failure: so
 * `checkChatUpdate` fails on it too, never a silent guess.
 */
export function replayDecisions(log: readonly RecordedDecision[]): { provider: DecisionProvider; misses: string[] } {
  const byKey = new Map(log.map((r) => [r.key, r] as const));
  const misses: string[] = [];
  return {
    misses,
    provider: {
      id: "openrouter",
      name: "Jev (recorded)",
      model: "typesafe/jev-1.13",
      decide: async (request) => {
        const hit = byKey.get(requestKey(request));
        if (!hit) {
          misses.push(Object.keys(request.questions).join(", "));
          throw new Error("No recorded decision for this request: the scenario or the questions changed since it was recorded.");
        }
        return { answers: hit.answers, usage: hit.usage };
      },
    },
  };
}

/** The chat model: outline = one section per unit; plan = the unit's text in one node plus an analysis card; assignment must never be needed. */
function chatModel(seen: { task: string }[]) {
  return (req: AIRequest) => {
    seen.push({ task: req.task });
    if (req.task === "outline_document") {
      const n = Math.max(...[...req.prompt.matchAll(/\[u(\d+)\]/g)].map((m) => Number(m[1])));
      return response(JSON.stringify({ summary: "S", sections: Array.from({ length: n }, (_, i) => ({ id: `s${i + 1}`, label: `Section ${i + 1}`, kind: "notes", parts: [`u${i + 1}`] })) }));
    }
    if (req.task === "generate_section_analysis") return response(JSON.stringify({ takeaway: "T", analysis: [{ id: "an1", type: "text", origin: "analysis", title: "Status", content: { markdown: "A." } }] }));
    if (req.task === "assign_to_topics") return response(JSON.stringify({ assignments: [] }));
    const text = req.prompt.split("Content to visualize:\n\n")[1] ?? ".";
    return response(JSON.stringify({ version: 1, template: "sectioned", nodes: [{ id: "n1", type: "text", content: { markdown: text } }, { id: "an1", type: "text", origin: "analysis", title: "Status", content: { markdown: "What this means." } }], relationships: [], metadata: { takeaway: "T" } }));
  };
}

function buildRuntime(decision: DecisionProvider) {
  const seen: { task: string }[] = [];
  const jev = { requests: 0 };
  const counted: DecisionProvider = { ...decision, decide: async (request, options) => (jev.requests++, decision.decide(request, options)) };
  const manager = new AIProviderManager();
  const registry = createTaskRegistry();
  registerVisualizeTasks(registry);
  registerMergeTasks(registry);
  registerRevisionTasks(registry);
  manager.registerProvider(createMockProvider({ id: "mock", respond: vi.fn(chatModel(seen)) }));
  manager.setPrimary("mock");
  manager.setTypedDecisionProvider(counted);
  return { runtime: createAIRuntime({ manager, registry }), seen, jev };
}

// ---- the scenario -----------------------------------------------------------------------------------------------------------------------------

const portsFor = (a: Accepted, runtime: IngestPorts["runtime"]): IngestPorts => {
  const repo: ContentSourceRepository = {
    get: async (id) => (id === a.source.id ? a.source : null),
    getVersion: async (id, version) => (id === a.source.id && version === a.previous.version ? a.previous : null),
    append: async () => undefined,
    listByCanvas: async () => [a.source],
    delete: async () => undefined,
  };
  return { runtime, contentSources: repo, renderContext: () => context, sourceObjects: () => ({ existing: a.existing, connections: [] }) };
};

export interface ChatUpdateRun {
  conversations: ReturnType<typeof conversations>;
  notes: Accepted;
  /** The notes' paragraphs before the update. */
  earlier: string[];
  /** What the share-link service returned for the chat and its branch. */
  chatsKept: number[];
  merged: IngestResult;
  /** The second merge of the same chats, after the first was accepted. */
  again: IngestResult;
  chatTasks: { task: string }[];
  decisionRequests: number;
}

const paragraphs = (md: string) => md.split(/\n{2,}/).map((p) => p.trim()).filter((p) => p && !p.startsWith("#") && !p.startsWith(">") && !p.startsWith("Source:") && p !== "---");

/** The first chat becomes notes, then the chat and its branch are merged into them (the AI chat's "Update from ChatGPT chats"), then merged again. */
export async function runChatUpdate(plan: Plan, decision: DecisionProvider): Promise<ChatUpdateRun> {
  const world = conversations(plan);
  const fetch = fetchOf({ [URL_A]: world.A, [URL_B]: world.B });
  const { runtime, seen, jev } = buildRuntime(decision);

  const first = await importSharedChats(URL_A, { fetch });
  const created = await ingestContent({ mode: "new", text: first.markdown }, { runtime, contentSources: {} as ContentSourceRepository, renderContext: () => context, sourceObjects: () => ({ existing: [], connections: [] }) }, { parseMarkdown: parse });
  const notes = accepted(created.changeSet!);

  seen.length = 0;
  const second = await importSharedChats(`${URL_A}\n${URL_B}`, { fetch });
  const merged = await ingestContent({ mode: "merge", sourceId: notes.source.id, text: second.markdown, economy: false }, portsFor(notes, runtime), { parseMarkdown: parse });
  const chatTasks = [...seen];
  const decisionRequests = jev.requests;
  const next = merged.changeSet ? acceptUpdate(notes, merged.changeSet) : notes;
  const again = await ingestContent({ mode: "merge", sourceId: notes.source.id, text: second.markdown, economy: false }, portsFor(next, runtime), { parseMarkdown: parse });
  return { conversations: world, notes, earlier: paragraphs(notes.previous.text), chatsKept: second.chats.map((c) => c.kept), merged, again, chatTasks, decisionRequests };
}

// ---- what must hold ---------------------------------------------------------------------------------------------------------------------------

const count = (haystack: string, needle: string) => haystack.split(needle).length - 1;
/** The notes without their "Needs your call" choices (a choice quotes both versions of what it is about). */
const withoutChoices = (md: string) => md.split(/\r?\n\r?\n/).filter((b) => !b.includes("[!choice]")).join("\n\n");
const strings = (v: unknown): string[] => (typeof v === "string" ? [v] : Array.isArray(v) ? v.flatMap(strings) : v && typeof v === "object" ? Object.values(v).flatMap(strings) : []);
/** The notes text of `heading`'s section: up to the next heading of the same or a higher level. */
const sectionOf = (md: string, heading: string) => {
  const at = md.indexOf(`### ${heading}`);
  if (at < 0) return "";
  const rest = md.slice(at + 4);
  const end = rest.search(/\n#{1,3} /);
  return end < 0 ? rest : rest.slice(0, end);
};

/**
 * Every guarantee of an update from a chat, asserted. `guaranteesOnly`, for a real model whose judgement is not fixed: only what the code must
 * guarantee whatever the model says (nothing lost or removed, nothing duplicated, new facts where they belong, questions with their answers, a
 * second import adds nothing twice); not that it found every contradiction or answered every assignment itself.
 */
export function checkChatUpdate(plan: Plan, run: ChatUpdateRun, options: { guaranteesOnly?: boolean } = {}): void {
  const { A, B, added } = run.conversations;
  const { merged, earlier } = run;
  expect(run.chatsKept).toEqual([A.turns.length, B.turns.length - plan.shared * 2]); // the branch keeps only its own turns
  expect(earlier.length).toBeGreaterThanOrEqual(plan.topics * 2);
  expect(merged.changeSet, merged.notices.join(" ")).not.toBeNull();
  const set = merged.changeSet!;
  const text = set.contentSource!.text;

  // Nothing lost: every earlier passage is still in the notes, and in what the canvas will show; nothing is removed.
  for (const p of earlier) expect(text, `lost: ${p.slice(0, 60)}`).toContain(p);
  expect(set.changes.filter((c) => c.kind === "remove")).toEqual([]);
  const shown = strings((set.contentSource!.plan as VisualPlan).nodes).join("\n\n");
  for (const p of earlier) expect(shown, `not on the canvas: ${p.slice(0, 60)}`).toContain(p);

  // Nothing duplicated: a repeated passage once, a new one once.
  const prose = withoutChoices(text);
  for (const p of earlier) expect(count(prose, p), `repeated: ${p.slice(0, 60)}`).toBe(1);
  for (const f of [...added.extend, ...added.fresh, ...added.newFacts]) expect(count(prose, f), `new fact: ${f.slice(0, 60)}`).toBe(1);

  // New facts join their own topic; a new subject is a section of its own.
  for (const k of plan.extend) expect(sectionOf(text, title(k)), `topic ${k}`).toContain(fact(k, 40 + k));
  // A question stays with its own answer: the follow-up question of each extended topic is the block just above its new fact, and the question
  // of each new subject is just under its heading (not under another topic, away from its answer).
  const blocks = text.split(/\r?\n\r?\n/);
  for (const k of plan.extend) {
    const at = blocks.indexOf(fact(k, 40 + k));
    expect(at, `topic ${k}`).toBeGreaterThan(0);
    expect(blocks[at - 1], `question of topic ${k}`).toMatch(new RegExp(`^> Any more on ${title(k)}\\? \\(\\d+\\)$`));
  }
  for (let n = 0; n < plan.fresh; n++) {
    const k = plan.topics + n;
    const at = blocks.findIndex((b) => new RegExp(`^#{2,3} ${title(k)}$`).test(b));
    expect(blocks[at + 1], `question of new topic ${k}`).toBe(`> Tell me about ${title(k)}.`);
    // A new subject is a section of its own (under the branch's heading), once.
    expect(text.match(new RegExp(`^#{2,3} ${title(k)}\\s*$`, "gm"))?.length ?? 0, `new topic ${k}`).toBe(1);
  }

  if (!options.guaranteesOnly) checkConflicts(plan, run, text, prose);

  // Importing the same chats again: nothing is removed, nothing is added twice.
  if (run.again.changeSet) {
    const t2 = run.again.changeSet.contentSource!.text;
    expect(run.again.changeSet.changes.filter((c) => c.kind === "remove")).toEqual([]);
    const prose2 = withoutChoices(t2);
    for (const p of earlier) expect(count(prose2, p), `again: ${p.slice(0, 60)}`).toBe(1);
    for (const f of [...added.extend, ...added.fresh, ...added.newFacts]) expect(count(prose2, f), `again: ${f.slice(0, 60)}`).toBe(1);
  }
}

/** What depends on the decision model's judgement: contradictions are found and left for the user, and the model answered the assignments. */
function checkConflicts(plan: Plan, run: ChatUpdateRun, text: string, prose: string): void {
  const { added } = run.conversations;
  const { merged } = run;
  // A contradiction is not applied: the old price stays, the new one is only an option, and the user is asked.
  expect(merged.choices.length).toBe(plan.contradict.length);
  for (const { old, now } of added.contradict) {
    expect(count(text, old), `the notes' own statement stays: ${old}`).toBeGreaterThanOrEqual(1);
    expect(count(text, now), `${now} only as an option`).toBe(1);
    expect(count(prose, now), `${now} not filed as a fact`).toBe(0);
    const block = text.split("\n\n").find((b) => b.includes("[!choice]") && b.includes(now));
    expect(block, `a choice holds ${now}`).toBeDefined();
    expect(block).toContain(old);
  }
  expect(merged.notices.join(" ")).toContain("Needs your call");
  expect(text.match(/\[!choice\]/g)?.length ?? 0).toBe(plan.contradict.length);

  // The decision model answered the assignments: the chat fallback was never asked.
  expect(run.decisionRequests).toBeGreaterThan(0);
  expect(run.chatTasks.filter((c) => c.task === "assign_to_topics")).toEqual([]);
}
