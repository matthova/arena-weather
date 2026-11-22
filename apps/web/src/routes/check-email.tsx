import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useAppConfig } from "~/components/GoogleButton";
import { api } from "~/lib/api";
import { appUrl, authClient } from "~/lib/auth";

type Search = { email?: string; redirect?: string };

export const Route = createFileRoute("/check-email")({
  validateSearch: (raw: Record<string, unknown>): Search => ({
    email: typeof raw.email === "string" ? raw.email : undefined,
    redirect:
      typeof raw.redirect === "string" && raw.redirect.startsWith("/") ? raw.redirect : undefined,
  }),
  component: CheckEmailPage,
});

/** Turns the absolute link from the e-mail into a same-origin path, so it goes through the /api proxy. */
export function sameOriginLink(link: string): string {
  try {
    const u = new URL(link);
    return u.pathname + u.search;
  } catch {
    return link;
  }
}

function CheckEmailPage() {
  const { email, redirect = "/rules" } = Route.useSearch();
  const config = useAppConfig();
  const [resent, setResent] = useState<string | null>(null);

  // Local development: the API keeps "sent" e-mails in memory; offer the link right here.
  const outbox = useQuery({
    queryKey: ["dev-outbox", email],
    queryFn: () => api.devOutbox(email),
    enabled: Boolean(config.data?.devMailbox && email),
    refetchInterval: 2000,
  });
  const verification = outbox.data?.messages.find((m) => /verify-email\?token=/.test(m.text));
  const link = verification?.text.match(/https?:\/\/\S+/)?.[0];

  const resend = async () => {
    if (!email) return;
    const r = await authClient.sendVerificationEmail({ email, callbackURL: appUrl(redirect) });
    setResent(r.error ? (r.error.message ?? "Could not resend") : "Sent again.");
  };

  return (
    <div className="card" style={{ maxWidth: 520, margin: "0 auto" }}>
      <h1>Confirm your e-mail</h1>
      <p>
        We sent a confirmation link to <strong>{email ?? "your address"}</strong>. Open it to finish
        signing up; it signs you in and brings you back here.
      </p>
      {config.data?.devMailbox && (
        <div className="notice warn small">
          <strong>Local development:</strong> no e-mail provider is configured, so the API keeps the
          message instead of sending it.{" "}
          {link ? (
            <a href={sameOriginLink(link)} className="btn sm primary" data-testid="dev-verify-link">
              Open the verification link
            </a>
          ) : (
            <span>
              <span className="spinner" /> waiting for the e-mail…
            </span>
          )}
        </div>
      )}
      <div className="row" style={{ marginTop: "0.75rem" }}>
        <button type="button" className="btn" onClick={resend} disabled={!email}>
          Send the e-mail again
        </button>
        {resent && <span className="small muted">{resent}</span>}
      </div>
      <p className="small muted" style={{ marginTop: "0.75rem" }}>
        Already confirmed?{" "}
        <Link to="/sign-in" search={{ redirect }}>
          Sign in
        </Link>
      </p>
    </div>
  );
}
