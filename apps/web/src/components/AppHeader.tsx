import { Link, useNavigate } from "@tanstack/react-router";
import { authClient, useSession } from "~/lib/auth";

export function AppHeader() {
  const { data: session, isPending } = useSession();
  const navigate = useNavigate();
  const signOut = async () => {
    await authClient.signOut();
    navigate({ to: "/" });
  };
  return (
    <header className="app-header">
      <div className="bar">
        <Link to="/" className="brand">
          <img src="/favicon.svg" alt="" width={24} height={24} />
          Weather alerts
        </Link>
        <nav className="nav" aria-label="Main">
          <Link to="/" activeOptions={{ exact: true }}>
            Forecast
          </Link>
          <Link to="/rules">Rules</Link>
          <Link to="/notifications">Notifications</Link>
        </nav>
        <div className="account">
          {isPending ? null : session ? (
            <>
              <span title={session.user.email}>{session.user.name || session.user.email}</span>
              <button type="button" className="btn sm" onClick={signOut}>
                Sign out
              </button>
            </>
          ) : (
            <Link to="/sign-in" className="btn sm primary">
              Sign in
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
