import type { PushMessage } from "./push/sender.js";
import type { Services } from "./services.js";

export interface NotifyResult {
  attempted: number;
  delivered: number;
  failed: number;
}

/** Push `message` to every subscription of a user; prunes subscriptions the push service reports gone. */
export async function notifyUser(
  services: Services,
  userId: string,
  message: PushMessage,
  meta: { ruleId: string | null; kind: "alert" | "test" },
): Promise<NotifyResult> {
  const subs = await services.repo.push.listByUser(userId);
  const result: NotifyResult = { attempted: 0, delivered: 0, failed: 0 };
  for (const sub of subs) {
    result.attempted++;
    try {
      const r = await services.push.send(
        { endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth },
        message,
      );
      if (r.ok) result.delivered++;
      else {
        result.failed++;
        console.warn(
          `push service answered ${r.status} for subscription ${sub.id}${r.body ? `: ${r.body.slice(0, 300)}` : ""}`,
        );
      }
      if (r.gone) await services.repo.push.deleteById(sub.id);
      else await services.repo.push.markResult(sub.id, r.ok);
    } catch (e) {
      result.failed++;
      console.error(`push failed for subscription ${sub.id}`, e);
      await services.repo.push.markResult(sub.id, false);
    }
  }
  await services.repo.notifications.record({
    userId,
    ruleId: meta.ruleId,
    kind: meta.kind,
    title: message.title,
    body: message.body,
    attempted: result.attempted,
    delivered: result.delivered,
  });
  return result;
}
