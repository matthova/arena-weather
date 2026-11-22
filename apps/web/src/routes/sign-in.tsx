import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { GoogleButton } from "~/components/GoogleButton";
import { appUrl, authClient } from "~/lib/auth";

type Search = { redirect?: string };

export const Route = createFileRoute("/sign-in")({
  validateSearch: (raw: Record<string, unknown>): Search => ({
    redirect:
      typeof raw.redirect === "string" && raw.redirect.startsWith("/") ? raw.redirect : undefined,
  }),
  component: SignInPage,
});

function SignInPage() {
  const { redirect = "/rules" } = Route.useSearch();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unverified, setUnverified] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setUnverified(false);
    const r = await authClient.signIn.email({ email, password, callbackURL: appUrl(redirect) });
    setBusy(false);
    if (r.error) {
      if (r.error.code === "EMAIL_NOT_VERIFIED") {
        setUnverified(true);
        navigate({ to: "/check-email", search: { email, redirect } });
        return;
      }
      setError(r.error.message ?? "Sign-in failed");
      return;
    }
    navigate({ href: redirect });
  };

  return (
    <div className="card" style={{ maxWidth: 460, margin: "0 auto" }}>
      <h1>Sign in</h1>
      <form className="form" onSubmit={submit}>
        <GoogleButton redirect={redirect} />
        <div className="field">
          <label htmlFor="email">E-mail</label>
          <input
            id="email"
            className="input"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="password">Password</label>
          <input
            id="password"
            className="input"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        {error && <p className="error small">{error}</p>}
        {unverified && (
          <p className="notice warn small">Please confirm your e-mail address first.</p>
        )}
        <button type="submit" className="btn primary" disabled={busy}>
          {busy ? <span className="spinner" /> : null} Sign in
        </button>
        <p className="small muted">
          New here?{" "}
          <Link to="/sign-up" search={{ redirect }}>
            Create an account
          </Link>
        </p>
      </form>
    </div>
  );
}
