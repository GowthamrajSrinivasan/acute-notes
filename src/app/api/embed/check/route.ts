/**
 * Framing check for web embeds. The browser hides why a cross-origin frame is
 * blank, so the canvas asks here for the page's framing headers
 * (`X-Frame-Options`, CSP) and decides with `allowsFraming`. Only those two
 * headers are returned — never the page body.
 */
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { isRefusedNonLocal, notFound } from "@/config/httpExposure";
import { isWebLink } from "@/domain/canvas/webEmbed";

const TIMEOUT_MS = 5000;

export async function GET(req: NextRequest): Promise<Response> {
  // Defence in depth behind src/proxy.ts: this route fetches any URL it is given from the server, so it answers only
  // this machine (unless the deployment is deliberately public). Full SSRF hardening (private ranges, redirects to
  // them) is still a tracked defect — .ai/docs/chatgpt-mcp-architecture-and-test-plan.md, "HTTP exposure filter".
  if (isRefusedNonLocal(req.headers)) return notFound();
  const url = req.nextUrl.searchParams.get("url");
  if (!isWebLink(url)) return NextResponse.json({ error: "Expected an http(s) url." }, { status: 400 });

  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { "user-agent": "Mozilla/5.0 (compatible; AcuteNotes embed check)", accept: "text/html,*/*" },
    });
    // Headers are all we need; don't download the body.
    void res.body?.cancel();
    return NextResponse.json({
      finalUrl: res.url || url,
      xFrameOptions: res.headers.get("x-frame-options"),
      contentSecurityPolicy: res.headers.get("content-security-policy"),
    });
  } catch {
    return NextResponse.json({ error: "Could not reach the page." }, { status: 502 });
  }
}
