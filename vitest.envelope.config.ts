import { mergeConfig } from "vitest/config";
import contract from "./vitest.contract.config";

/**
 * The contract suite plus the external execution envelope (src/ai/contractTests/envelope.setup.ts, plan §12.33): enforces
 * an approved paid recording's request, token and dollar ceilings on what is actually sent, around frozen code that may
 * not be edited. Inert unless ENVELOPE_RUN_DIR and every ENVELOPE_MAX_* are set.
 */
export default mergeConfig(contract, { test: { setupFiles: ["./src/ai/contractTests/envelope.setup.ts"] } });
