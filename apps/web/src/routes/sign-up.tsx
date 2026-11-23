import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { GoogleButton } from "~/components/GoogleButton";
import { appUrl, authClient } from "~/lib/auth";

type Search = { redirect?: string };

export const Route = createFileRoute("/sign-up")({
  validateSearch: (raw: Record<string, unknown>): Search => ({
    redirect:
      typeof raw.redirect === "string" && raw.redirect.startsWith("/") ? raw.redirect : undefined,
  }),
  component: SignUpPage,
});

function SignUpPage() {
  const { redirect = "/rules" } = Route.useSearch();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    // The verification link signs the user in and then lands on callbackURL (an absolute URL on
    // this origin, which the API trusts).
    const r = await authClient.signUp.email({
      name,
      email,
      password,
      callbackURL: appUrl(redirect),
    });
    setBusy(false);
    if (r.error) {
      setError(r.error.message ?? "Sign-up failed");
      return;
    }
    navigate({ to: "/check-email", search: { email, redirect } });
  };

  return (
    <div className="card" style={{ maxWidth: 460, margin: "0 auto" }}>
      <h1>Create an account</h1>
      <form className="form" onSubmit={submit}>
        <GoogleButton redirect={redirect} />
        <div className="field">
          <label htmlFor="name">Name</label>
          <input
            id="name"
            className="input"
            autoComplete="name"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
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
          <label htmlFor="password">Password (8+ characters)</label>
          <input
            id="password"
            className="input"
            type="password"
            autoComplete="new-password"
            minLength={8}
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        {error && <p className="error small">{error}</p>}
        <button type="submit" className="btn primary" disabled={busy}>
          {busy ? <span className="spinner" /> : null} Create account
        </button>
        <p className="small muted">
          Already have one?{" "}
          <Link to="/sign-in" search={{ redirect }}>
            Sign in
          </Link>
        </p>
      </form>
    </div>
  );
}
