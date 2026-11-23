import { createAuthClient } from "better-auth/react";

/** Better Auth client against the same origin (the /api proxy forwards /api/auth/* to the API). */
export const authClient = createAuthClient({ basePath: "/api/auth" });

export const { useSession } = authClient;

/** Absolute URL on this origin, for Better Auth callbackURLs (they must be trusted origins). */
export function appUrl(path: string): string {
  if (typeof window === "undefined") return path;
  return new URL(path, window.location.origin).toString();
}
