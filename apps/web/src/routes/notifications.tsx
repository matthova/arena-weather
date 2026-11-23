import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { useAppConfig } from "~/components/GoogleButton";
import { RequireAuth } from "~/components/RequireAuth";
import { api, errorMessage } from "~/lib/api";
import {
  currentSubscription,
  type PushSupport,
  permissionState,
  showLocalNotification,
  subscribeToPush,
  unsubscribeFromPush,
} from "~/lib/push";

export const Route = createFileRoute("/notifications")({
  ssr: false,
  component: () => (
    <RequireAuth what="manage notifications">
      <NotificationsPage />
    </RequireAuth>
  ),
});

function NotificationsPage() {
  const [permission, setPermission] = useState<PushSupport>("default");
  const [endpoint, setEndpoint] = useState<string | null>(null);
  const refreshLocal = useCallback(async () => {
    setPermission(permissionState());
    setEndpoint((await currentSubscription())?.endpoint ?? null);
  }, []);
  const qc = useQueryClient();
  const config = useAppConfig();
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    void refreshLocal();
  }, [refreshLocal]);

  const subs = useQuery({
    queryKey: ["push-subscriptions"],
    queryFn: () => api.listPushSubscriptions(),
  });
  const thisDeviceRegistered = Boolean(
    endpoint && subs.data?.subscriptions.some((s) => s.endpoint === endpoint),
  );

  const enable = useMutation({
    mutationFn: subscribeToPush,
    onSuccess: async () => {
      setMessage("This device will now receive your alerts.");
      await refreshLocal();
      qc.invalidateQueries({ queryKey: ["push-subscriptions"] });
    },
    onError: (e) => setMessage(errorMessage(e)),
  });
  const disable = useMutation({
    mutationFn: unsubscribeFromPush,
    onSuccess: async () => {
      setMessage("This device no longer receives alerts.");
      await refreshLocal();
      qc.invalidateQueries({ queryKey: ["push-subscriptions"] });
    },
    onError: (e) => setMessage(errorMessage(e)),
  });
  const forget = useMutation({
    mutationFn: (ep: string) => api.unregisterPush(ep),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["push-subscriptions"] }),
    onError: (e) => setMessage(errorMessage(e)),
  });
  const local = useMutation({
    mutationFn: () =>
      showLocalNotification("Weather alerts", "Notifications are working on this device."),
    onError: (e) => setMessage(errorMessage(e)),
  });

  const pushConfigured = config.data?.push !== false;

  return (
    <div className="stack">
      <h1>Notifications</h1>
      <section className="card stack">
        <h2>This device</h2>
        {permission === "unsupported" && (
          <div className="notice warn">
            This browser does not support web push. On iPhone/iPad, add the app to the Home Screen
            first (iOS 16.4+); then open it from there.
          </div>
        )}
        {!pushConfigured && (
          <div className="notice warn">
            Web push is not configured on the server (VAPID keys missing). See the README.
          </div>
        )}
        <div className="row between">
          <div>
            <div>
              Permission: <strong>{permission}</strong>
            </div>
            <div className="muted small">
              {thisDeviceRegistered
                ? "Registered: alerts for your rules arrive here."
                : endpoint
                  ? "Subscribed in the browser but not registered with your account."
                  : "Not subscribed."}
            </div>
          </div>
          <div className="row">
            {thisDeviceRegistered ? (
              <button
                type="button"
                className="btn"
                disabled={disable.isPending}
                onClick={() => disable.mutate()}
              >
                Turn off on this device
              </button>
            ) : (
              <button
                type="button"
                className="btn primary"
                disabled={
                  permission === "unsupported" ||
                  permission === "denied" ||
                  !pushConfigured ||
                  enable.isPending
                }
                onClick={() => enable.mutate()}
                data-testid="enable-push"
              >
                {enable.isPending ? <span className="spinner" /> : null} Turn on notifications
              </button>
            )}
            {permission === "granted" && (
              <button
                type="button"
                className="btn"
                onClick={() => local.mutate()}
                title="Shows a notification locally, without the server"
              >
                Show a test notification
              </button>
            )}
          </div>
        </div>
        {permission === "denied" && (
          <p className="small muted">
            Notifications are blocked for this site. Allow them in the browser's site settings, then
            reload.
          </p>
        )}
        {message && <div className="notice small">{message}</div>}
        <p className="small muted">
          To test the whole path, press <strong>Test this rule now</strong> on a{" "}
          <Link to="/rules">rule</Link>: the server evaluates it against the live forecast and
          pushes the result to every registered device.
        </p>
      </section>

      <section className="card">
        <h2>Registered devices</h2>
        {subs.isPending && (
          <p className="muted">
            <span className="spinner" /> Loading…
          </p>
        )}
        {subs.isError && <div className="notice error">{errorMessage(subs.error)}</div>}
        {subs.data && subs.data.subscriptions.length === 0 && (
          <p className="muted">No devices yet.</p>
        )}
        {subs.data && subs.data.subscriptions.length > 0 && (
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }} className="stack">
            {subs.data.subscriptions.map((s) => (
              <li key={s.id} className="row between">
                <span>
                  <strong>
                    {s.endpoint === endpoint ? "This device" : describeAgent(s.userAgent)}
                  </strong>
                  <span className="muted small">
                    {" "}
                    · added {new Date(s.createdAt).toLocaleDateString()}
                  </span>
                  <br />
                  <span className="muted small" style={{ wordBreak: "break-all" }}>
                    {new URL(s.endpoint).host}
                  </span>
                </span>
                <button
                  type="button"
                  className="btn sm danger"
                  disabled={forget.isPending}
                  onClick={() =>
                    s.endpoint === endpoint ? disable.mutate() : forget.mutate(s.endpoint)
                  }
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function describeAgent(ua: string | null): string {
  if (!ua) return "Unknown device";
  const browser = /Firefox\//.test(ua)
    ? "Firefox"
    : /Edg\//.test(ua)
      ? "Edge"
      : /Chrome\//.test(ua)
        ? "Chrome"
        : /Safari\//.test(ua)
          ? "Safari"
          : "Browser";
  const os = /Android/.test(ua)
    ? "Android"
    : /iPhone|iPad/.test(ua)
      ? "iOS"
      : /Mac OS X/.test(ua)
        ? "macOS"
        : /Windows/.test(ua)
          ? "Windows"
          : /Linux/.test(ua)
            ? "Linux"
            : "";
  return [browser, os].filter(Boolean).join(" on ");
}
