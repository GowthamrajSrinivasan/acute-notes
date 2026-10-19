/**
 * The tab's side of the MCP bridge (`src/mcp/bridge/protocol.ts`): `GET` opens the NDJSON stream of client messages
 * for **one workspace**, `POST` delivers one reply. Only this app's own pages may use it (same-origin, an allowed
 * host), and only with the workspace's owner secret. A tab can only ever attach to — or answer for — the workspace
 * it proved ownership of; nothing in a client message or reply can name another one.
 */
import type { NextRequest } from "next/server";
import { type BridgeFrame, type BridgeReply } from "@/mcp/bridge/protocol";
import { ownerFrom, ownerGate, ownerKey, requireOwner } from "@/mcp/bridge/owner";
import { PING_INTERVAL_MS } from "@/mcp/bridge/relay";
import { getMcpServices } from "@/mcp/bridge/store";

export function GET(req: NextRequest): Response {
  const services = getMcpServices();
  const refused = ownerGate(req, services);
  if (refused) return refused;
  const owner = ownerFrom(req);
  const denied = requireOwner(req, owner, services);
  if (denied) return denied;

  const relay = services.relays.relayFor(ownerKey(owner!));
  const encoder = new TextEncoder();
  let cleanup = () => {};
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      let open = true;
      const close = () => {
        if (!open) return;
        open = false;
        cleanup();
        try {
          controller.close();
        } catch {
          // already closed by the client
        }
      };
      const send = (frame: BridgeFrame) => {
        if (open) controller.enqueue(encoder.encode(`${JSON.stringify(frame)}\n`));
      };
      const attached = relay.attachTab(send, close);
      const ping = setInterval(() => send({ type: "ping" }), PING_INTERVAL_MS);
      cleanup = () => {
        clearInterval(ping);
        attached.detach();
      };
      req.signal.addEventListener("abort", close, { once: true });
    },
    cancel() {
      cleanup();
    },
  });
  return new Response(body, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" } });
}

export async function POST(req: NextRequest): Promise<Response> {
  const services = getMcpServices();
  const refused = ownerGate(req, services);
  if (refused) return refused;
  let reply: BridgeReply;
  try {
    reply = (await req.json()) as BridgeReply;
  } catch {
    return new Response("Bad Request", { status: 400 });
  }
  const owner = ownerFrom(req, reply);
  const denied = requireOwner(req, owner, services);
  if (denied) return denied;
  // The reply is delivered to this owner's own workspace relay; a bridge id from another owner's or workspace's tab matches nothing there.
  const accepted = services.relays.existing(ownerKey(owner!))?.fromTab(String(reply.bridgeId), String(reply.sessionId), reply.message) ?? false;
  return new Response(null, { status: accepted ? 204 : 409 });
}
