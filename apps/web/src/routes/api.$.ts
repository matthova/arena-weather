import { env } from "cloudflare:workers";
import { createFileRoute } from "@tanstack/react-router";

/**
 * Same-origin gateway to the API Worker. The browser only ever talks to this origin, so Better
 * Auth's session cookie is a plain first-party cookie and no CORS is involved.
 *
 * - Production: over the `API` service binding (wrangler.jsonc "services"), Worker to Worker.
 * - Local dev (`vite dev`): plain fetch to API_ORIGIN (http://localhost:8787, the API's `wrangler dev`),
 *   so the two dev servers need no shared registry and either can be restarted on its own.
 */
type Bindings = { API?: Fetcher; API_ORIGIN?: string };

const HOP_BY_HOP = ["connection", "keep-alive", "transfer-encoding", "te", "trailer", "upgrade"];

async function forward({ request }: { request: Request }): Promise<Response> {
  const bindings = env as unknown as Bindings;
  const origin = (bindings.API_ORIGIN ?? "http://localhost:8787").replace(/\/$/, "");
  const incoming = new URL(request.url);
  const target = new URL(incoming.pathname + incoming.search, origin);

  const headers = new Headers(request.headers);
  for (const h of HOP_BY_HOP) headers.delete(h);
  // Tell the API who the browser is talking to, like a reverse proxy would.
  headers.set("x-forwarded-host", incoming.host);
  headers.set("x-forwarded-proto", incoming.protocol.replace(":", ""));

  const init: RequestInit = {
    method: request.method,
    headers,
    body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
    redirect: "manual",
  };
  // Streaming bodies need duplex on fetch implementations that enforce it.
  (init as RequestInit & { duplex?: "half" }).duplex = "half";

  const useBinding = Boolean(bindings.API) && !import.meta.env.DEV;
  const fetcher = useBinding && bindings.API ? bindings.API.fetch.bind(bindings.API) : fetch;
  let upstream: Response;
  try {
    upstream = await fetcher(target.toString(), init);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return Response.json(
      {
        error: {
          code: "api_unreachable",
          message: `The API at ${origin} is not reachable (${message}). In local development start it with \`pnpm dev\` at the repo root.`,
        },
      },
      { status: 502 },
    );
  }
  const out = new Headers(upstream.headers);
  for (const h of HOP_BY_HOP) out.delete(h);
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: out,
  });
}

export const Route = createFileRoute("/api/$")({
  server: {
    handlers: {
      GET: forward,
      POST: forward,
      PUT: forward,
      PATCH: forward,
      DELETE: forward,
      OPTIONS: forward,
      HEAD: forward,
    },
  },
});
