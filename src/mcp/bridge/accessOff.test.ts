/**
 * What a client sees when the user switches MCP access off (Lane M): the switch revokes the workspace's credentials on
 * the server (`setMcpAccess(…, false)` → `revoke-all`), so the old token is refused with 401 and a pointer to the
 * setting. A 503 "not connected" is only for a credential that is still valid while no tab serves its workspace.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { connectTab, initialize, OWNER_A, ownerRequest, request } from "@/testUtils/mcpBridge";
import { handleClientRequest, UNAUTHORIZED_MESSAGE } from "./http";
import { ownerKey } from "./owner";
import { NOT_CONNECTED_MESSAGE } from "./relay";
import { createMcpServices, getMcpServices } from "./store";

const asNext = (req: Request) => new NextRequest(req.url, { method: req.method, headers: req.headers, body: req.body, duplex: "half" } as ConstructorParameters<typeof NextRequest>[1]);
const access = async (body: unknown) => {
  const { POST } = await import("@/app/api/mcp/access/route");
  return POST(asNext(ownerRequest("/api/mcp/access", "ws_a", OWNER_A, body)));
};
const call = (token: string, services = getMcpServices()) =>
  handleClientRequest(request("/api/mcp", { headers: { authorization: `Bearer ${token}` }, body: initialize() }), { token, kinds: ["bearer", "oauth"] }, services);
const errorOf = async (res: Response) => ((await res.json()) as { error: { code: number; message: string } }).error;

describe("MCP access switched off", () => {
  // The access route uses the process-wide services; give each test a fresh set.
  beforeEach(() => void delete (globalThis as Record<string, unknown>).__acuteMcpServices);
  afterEach(() => void delete (globalThis as Record<string, unknown>).__acuteMcpServices);

  it("refuses the revoked token with 401 and says where to get a current one, without echoing it", async () => {
    const { bearer } = (await (await access({ action: "ensure" })).json()) as { bearer: { token: string } };
    connectTab(getMcpServices(), ownerKey({ workspaceId: "ws_a", secret: OWNER_A }));
    expect((await call(bearer.token)).status).toBe(200);

    expect((await access({ action: "revoke-all" })).status).toBe(200); // what turning access off sends

    const refused = await call(bearer.token);
    expect(refused.status).toBe(401);
    expect(refused.headers.get("www-authenticate")).toMatch(/^Bearer/);
    const error = await errorOf(refused);
    expect(error).toEqual({ code: -32001, message: UNAUTHORIZED_MESSAGE });
    expect(error.message).toContain("MCP access");
    expect(JSON.stringify(error)).not.toContain(bearer.token);
  });

  it("turning access on again issues a new token; the old one stays refused", async () => {
    const first = ((await (await access({ action: "ensure" })).json()) as { bearer: { id: string; token: string } }).bearer;
    await access({ action: "revoke-all" });
    // The tab forgot its credentials when access went off, so it asks without a bearer id.
    const second = ((await (await access({ action: "ensure", bearerId: null })).json()) as { bearer: { token: string } }).bearer;
    expect(second.token).not.toBe(first.token);
    connectTab(getMcpServices(), ownerKey({ workspaceId: "ws_a", secret: OWNER_A }));
    expect((await call(first.token)).status).toBe(401);
    expect((await call(second.token)).status).toBe(200);
  });

  it("a wrong token gets the same answer as a revoked one", async () => {
    const services = createMcpServices();
    const res = await call("nope", services);
    expect(res.status).toBe(401);
    expect((await errorOf(res)).message).toBe(UNAUTHORIZED_MESSAGE);
  });

  it("a valid credential with no tab serving its workspace gets 503 with instructions", async () => {
    const services = createMcpServices();
    const credential = services.credentials.issue("ws_a", { kind: "bearer", scope: "propose" });
    const res = await call(credential.token, services);
    expect(res.status).toBe(503);
    expect(res.headers.get("retry-after")).toBe("5");
    expect((await errorOf(res)).message).toBe(NOT_CONNECTED_MESSAGE);
  });
});
