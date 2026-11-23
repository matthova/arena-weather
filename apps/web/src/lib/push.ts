import { api } from "./api";

export type PushSupport = "unsupported" | "denied" | "default" | "granted";

export function pushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

export function permissionState(): PushSupport {
  if (!pushSupported()) return "unsupported";
  return Notification.permission;
}

/** Registers /sw.js (idempotent) and resolves once it is active. */
export async function readyServiceWorker(): Promise<ServiceWorkerRegistration> {
  await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  return navigator.serviceWorker.ready;
}

export function registerServiceWorker(): void {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
  navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch((e) => {
    console.warn("service worker registration failed", e);
  });
}

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration("/");
  if (!reg) return null;
  return reg.pushManager.getSubscription();
}

/** Asks for permission, subscribes with the API's VAPID key and registers the subscription. */
export async function subscribeToPush(): Promise<PushSubscription> {
  if (!pushSupported()) throw new Error("This browser does not support web push");
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("Notification permission was not granted");
  const { publicKey } = await api.pushPublicKey();
  const reg = await readyServiceWorker();
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });
  }
  const json = sub.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth)
    throw new Error("Browser returned an incomplete push subscription");
  await api.registerPush(
    {
      endpoint: json.endpoint,
      expirationTime: json.expirationTime ?? null,
      keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
    },
    navigator.userAgent,
  );
  return sub;
}

/** Unregisters at the API and unsubscribes in the browser. */
export async function unsubscribeFromPush(): Promise<void> {
  const sub = await currentSubscription();
  if (!sub) return;
  try {
    await api.unregisterPush(sub.endpoint);
  } catch (e) {
    // 404 = the API already forgot it (e.g. pruned after a failed push): still unsubscribe locally
    if (!(e && typeof e === "object" && "status" in e && e.status === 404)) throw e;
  }
  await sub.unsubscribe();
}

/** Shows a local notification through the service worker (no push round trip). */
export async function showLocalNotification(title: string, body: string): Promise<void> {
  const reg = await readyServiceWorker();
  await reg.showNotification(title, { body, icon: "/icons/icon-192.png", tag: "local-test" });
}
