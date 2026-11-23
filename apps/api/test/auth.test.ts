import { describe, expect, it } from "vitest";
import { json, makeWorld, signUpAndSignIn } from "./helpers.js";

describe("auth (Better Auth on D1)", () => {
  it("signs up with e-mail + password, sends a verification e-mail, blocks sign-in until verified", async () => {
    const w = makeWorld();
    const api = json(w, null);
    const email = `verify-${crypto.randomUUID().slice(0, 8)}@example.com`;
    const signUp = await api("POST", "/api/auth/sign-up/email", {
      name: "Ada",
      email,
      password: "a very long password",
    });
    expect(signUp.status).toBe(200);
    expect(w.email.sent).toHaveLength(1);
    expect(w.email.sent[0]?.to).toBe(email);
    expect(w.email.sent[0]?.text).toMatch(/\/api\/auth\/verify-email\?token=/);

    const signIn = await api("POST", "/api/auth/sign-in/email", {
      email,
      password: "a very long password",
    });
    expect(signIn.status).toBe(403);
    expect(signIn.data.code).toBe("EMAIL_NOT_VERIFIED");
  });

  it("the verification link verifies the address and signs the user in", async () => {
    const w = makeWorld();
    const api = json(w, null);
    const email = `link-${crypto.randomUUID().slice(0, 8)}@example.com`;
    await api("POST", "/api/auth/sign-up/email", {
      name: "Ada",
      email,
      password: "a very long password",
    });
    const url = new URL(w.email.sent[0]?.text.match(/https?:\/\/\S+/)?.[0] ?? "");
    const res = await w.app.request(url.pathname + url.search, { redirect: "manual" }, w.env);
    expect([200, 302]).toContain(res.status);
    const row = await w.env.DB.prepare('SELECT "emailVerified" FROM "user" WHERE "email" = ?')
      .bind(email)
      .first<{ emailVerified: number }>();
    expect(row?.emailVerified).toBe(1);
  });

  it("GET /api/me reflects the session cookie", async () => {
    const w = makeWorld();
    expect((await json(w, null)("GET", "/api/me")).data.user).toBeNull();
    const { cookie, email } = await signUpAndSignIn(w);
    const me = await json(w, cookie)("GET", "/api/me");
    expect(me.data.user.email).toBe(email);
  });

  it("protected routes need a session", async () => {
    const w = makeWorld();
    const r = await json(w, null)("GET", "/api/rules");
    expect(r.status).toBe(401);
    expect(r.data.error.code).toBe("unauthorized");
  });

  it("Google is listed as a provider only when configured", async () => {
    const without = makeWorld();
    const r1 = await json(without, null)("POST", "/api/auth/sign-in/social", {
      provider: "google",
      callbackURL: "http://localhost:3000/",
    });
    expect(r1.status).toBeGreaterThanOrEqual(400);
    const withGoogle = makeWorld({
      env: { GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "secret" },
    });
    const r2 = await json(withGoogle, null)("POST", "/api/auth/sign-in/social", {
      provider: "google",
      callbackURL: "http://localhost:3000/",
    });
    expect(r2.status).toBe(200);
    expect(r2.data.url).toMatch(/^https:\/\/accounts\.google\.com\//);
    expect(r2.data.url).toContain(
      encodeURIComponent("http://localhost:8787/api/auth/callback/google"),
    );
  });
});
