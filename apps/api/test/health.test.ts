import { describe, expect, it } from "vitest";
import { json, makeWorld } from "./helpers.js";

describe("meta", () => {
  it("GET /api/health", async () => {
    const w = makeWorld();
    const r = await json(w, null)("GET", "/api/health");
    expect(r.status).toBe(200);
    expect(r.data.ok).toBe(true);
  });
  it("GET /api/variables lists hourly and daily variables", async () => {
    const w = makeWorld();
    const r = await json(w, null)("GET", "/api/variables");
    expect(r.status).toBe(200);
    expect(r.data.variables.some((v: { name: string }) => v.name === "temperature_2m")).toBe(true);
  });
  it("unknown routes are JSON 404s", async () => {
    const w = makeWorld();
    const r = await json(w, null)("GET", "/api/nope");
    expect(r.status).toBe(404);
    expect(r.data.error.code).toBe("not_found");
  });
});

describe("config and dev outbox", () => {
  it("GET /api/config reports what is configured", async () => {
    const w = makeWorld();
    const r = await json(w, null)("GET", "/api/config");
    expect(r.status).toBe(200);
    expect(r.data).toMatchObject({ googleSignIn: false, push: true, devMailbox: true });
  });
  it("GET /api/dev/outbox collects dev e-mails on localhost without a mail provider", async () => {
    const w = makeWorld();
    const { devOutbox } = await import("../src/lib/email.js");
    const { createEmailSender } = await import("../src/lib/email.js");
    const to = `outbox-${crypto.randomUUID().slice(0, 8)}@example.com`;
    await createEmailSender(w.env).send({ to, subject: "Hello", text: "https://x.test/verify" });
    expect(devOutbox[0]?.to).toBe(to);
    const r = await json(w, null)("GET", `/api/dev/outbox?to=${encodeURIComponent(to)}`);
    expect(r.status).toBe(200);
    expect(r.data.messages).toHaveLength(1);
    expect(r.data.messages[0].subject).toBe("Hello");
  });
  it("the dev outbox is a 404 when a mail provider is configured or the API is not local", async () => {
    const withResend = makeWorld({ env: { RESEND_API_KEY: "re_test" } });
    expect((await json(withResend, null)("GET", "/api/dev/outbox")).status).toBe(404);
    const remote = makeWorld({ env: { API_URL: "https://api.example.com" } });
    expect((await json(remote, null)("GET", "/api/dev/outbox")).status).toBe(404);
  });
});
