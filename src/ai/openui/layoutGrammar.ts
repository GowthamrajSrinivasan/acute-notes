/**
 * The layout grammar an MCP client reads before composing a card (`get_layout_grammar`, note-taking-modes plan §4.3):
 * the card library's own syntax rules and component signatures (`acuteCardLibrary.prompt`), the limits and rules the
 * canvas checks (`layoutCheck.ts`), and one worked example per layout. Any client can compose from this alone.
 */
import { LAYOUT_LIMITS } from "./layoutCheck";
import { acuteCardLibrary } from "./library";

export const LAYOUT_EXAMPLES: readonly { layout: string; use: string; lang: string }[] = [
  {
    layout: "IdeaCard",
    use: "one idea with its sources (the default)",
    lang: [`root = IdeaCard("Retry policy", "Jobs retry 5 times, then give up.", "high", [c1])`, `c1 = CitationChip("u3")`].join("\n"),
  },
  {
    layout: "Timeline",
    use: "dated or ordered events",
    lang: [`root = Timeline("Release", [e1, e2])`, `e1 = TimelineEvent("Monday", "Build")`, `e2 = TimelineEvent("Tuesday", "Deploy", "Only after QA sign-off")`].join("\n"),
  },
  {
    layout: "FlowDiagram",
    use: "steps in order",
    lang: `root = FlowDiagram("Release pipeline", ["Build", "QA sign-off", "Deploy"], ["CI builds and tests", "A QA engineer signs off", "The release manager deploys"])`,
  },
  {
    layout: "DecisionCard",
    use: "a question, its options and the choice",
    lang: [`root = DecisionCard("Which database?", [o1, o2], "Postgres", "The team already runs it.")`, `o1 = DecisionOption("Postgres", ["Team knows it"], ["Needs tuning"])`, `o2 = DecisionOption("MySQL")`].join("\n"),
  },
  {
    layout: "ComparisonTable",
    use: "a few entities by the same attributes",
    lang: `root = ComparisonTable(["", "Free", "Team"], [["Storage", "5 GB", "200 GB"], ["Price", "$0", "$10 per user"]])`,
  },
];

const RULES = [
  "A layout is how the card is DRAWN; its Markdown stays the card's text (search, export and study read the Markdown). Write the Markdown first, then a layout that shows the same facts.",
  "`root` may be any component above, not only IdeaCard.",
  "Static only: the only calls are the components above. No Query, Mutation, Action, OpenUrl, builtin functions or $state — they are refused.",
  "Every number the layout shows must appear in the card's Markdown or in a passage it cites; a new number is refused.",
  "Cite passages only with `sourceId` (one of the open canvas's content sources) and that source's unit ids, e.g. CitationChip(\"u3\"); an id the source doesn't have is refused.",
  "A phrase mostly in words the Markdown doesn't use is accepted but flagged to the user in the review.",
  `Limits: ${LAYOUT_LIMITS.chars} characters of Lang, ${LAYOUT_LIMITS.statements} statements, ${LAYOUT_LIMITS.components} components, ${LAYOUT_LIMITS.textChars} characters of visible text.`,
  "Passing these checks means nothing mechanical was found — not that the layout is right. Every layout waits for the user's review; nothing changes until they accept.",
];

/** The grammar text, bounded. */
export function layoutGrammar(): string {
  const library = acuteCardLibrary.prompt({
    preamble: "Compose ONE canvas card as OpenUI Lang for Acute-Notes. The card's Markdown is its text; this layout is how it is drawn.",
    additionalRules: RULES,
  });
  const examples = LAYOUT_EXAMPLES.map((e) => `### ${e.layout} — ${e.use}\n\n${e.lang}`).join("\n\n");
  return `${library}\n\n## Examples\n\n${examples}`;
}
