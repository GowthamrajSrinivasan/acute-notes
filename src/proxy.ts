/**
 * Next.js Proxy (formerly middleware): the HTTP exposure filter (src/config/httpExposure.ts). No matcher, so it runs
 * for every request — pages, `_next` assets, API routes. A request that is not demonstrably local reaches only the
 * MCP client endpoints; everything else gets a 404 before any route code runs. Local requests pass untouched.
 */
import { NextResponse, type NextRequest } from "next/server";
import { exposureRefusal } from "@/config/httpExposure";

export function proxy(request: NextRequest): Response {
  return exposureRefusal(request.nextUrl.pathname, request.method, request.headers) ?? NextResponse.next();
}
