/** The per-import "Add new text as plain cards, no AI" option as the merge reads it (one definition, with the ingest service the MCP tools also use). */
export { withEconomy } from "@/ai/ingest/ingest";

export const ECONOMY_LABEL = "Add new text as plain cards, no AI";
export const ECONOMY_NOTICE =
  "Text that joins an existing topic is kept word for word as plain cards. AI does not organise or link it, and the review says which passages were left that way. New topics are still organised by AI.";
