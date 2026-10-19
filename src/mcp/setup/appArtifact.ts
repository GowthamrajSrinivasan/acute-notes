/**
 * The setup artifact for the app's "Agent instructions" Copy / Download (plan D49; setup plan §A1): generated from a
 * server built exactly as the bridge builds it, so the text names the tools the user's agent will actually see.
 * Loaded on demand (the MCP SDK isn't in the initial bundle).
 */
import { getPersistence } from "@/persistence";
import { createAcuteMcpServer } from "../server";
import { liveRegistry } from "../tools";
import { buildSetupInstructions, type SetupArtifact, type SetupClient } from "./instructions";

export function appSetupArtifact(workspaceId: string, client: SetupClient, writesAllowed: boolean): SetupArtifact {
  const services = getPersistence();
  const server = createAcuteMcpServer({
    services,
    workspaceId,
    toolPolicy: { allowWrites: writesAllowed },
    repoMap: { services: { store: services.repoMaps, contentSources: services.contentSources } },
    agentState: services.agentState,
  });
  return buildSetupInstructions(client, { registry: liveRegistry(server), writesAllowed });
}
