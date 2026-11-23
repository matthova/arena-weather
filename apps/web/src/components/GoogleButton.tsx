import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "~/lib/api";
import { appUrl, authClient } from "~/lib/auth";

export function useAppConfig() {
  return useQuery({
    queryKey: ["config"],
    queryFn: () => api.config(),
    staleTime: Number.POSITIVE_INFINITY,
  });
}

/** "Continue with Google" — only rendered when the API has Google OAuth configured. */
export function GoogleButton({ redirect }: { redirect: string }) {
  const config = useAppConfig();
  const [error, setError] = useState<string | null>(null);
  if (!config.data?.googleSignIn) return null;
  return (
    <>
      <button
        type="button"
        className="btn block"
        onClick={async () => {
          setError(null);
          const r = await authClient.signIn.social({
            provider: "google",
            callbackURL: appUrl(redirect),
          });
          if (r.error) setError(r.error.message ?? "Google sign-in failed");
        }}
      >
        Continue with Google
      </button>
      {error && <p className="error small">{error}</p>}
      <div className="row" style={{ alignItems: "center" }}>
        <hr className="divider" style={{ flex: 1 }} />
        <span className="muted small">or with e-mail</span>
        <hr className="divider" style={{ flex: 1 }} />
      </div>
    </>
  );
}
