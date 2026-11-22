import { Link, useLocation } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useSession } from "~/lib/auth";

/** Renders children for signed-in users; otherwise a sign-in prompt (no redirect loop, no SSR flash). */
export function RequireAuth({ children, what }: { children: ReactNode; what: string }) {
  const { data: session, isPending } = useSession();
  const location = useLocation();
  if (isPending)
    return (
      <p className="muted">
        <span className="spinner" /> Checking your session…
      </p>
    );
  if (!session)
    return (
      <div className="card hero">
        <h1>Sign in to {what}</h1>
        <p className="muted">Rules and notifications belong to your account.</p>
        <div className="row" style={{ justifyContent: "center" }}>
          <Link to="/sign-in" search={{ redirect: location.href }} className="btn primary">
            Sign in
          </Link>
          <Link to="/sign-up" search={{ redirect: location.href }} className="btn">
            Create an account
          </Link>
        </div>
      </div>
    );
  return <>{children}</>;
}
