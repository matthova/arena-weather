import { newId, nowIso } from "../lib/http.js";
import type { PushSubscriptionRow } from "./repo.js";

/** Push channels the API can deliver to. `webpush` rows carry keys; native rows carry a device token in `endpoint`. */
export type PushChannel = "webpush" | "fcm" | "apns";
export const NATIVE_PUSH_CHANNELS = ["fcm", "apns"] as const;
export type NativePushChannel = (typeof NATIVE_PUSH_CHANNELS)[number];

/**
 * Native device tokens share the `push_subscription` table with web push (see migration 0003), so
 * `notifyUser` fans out to every device of a user in one loop. These helpers are the native half of
 * `repo.push` (register by token, forget by token).
 */
export function createPushDevices(db: D1Database) {
  return {
    /** Register (or re-register, idempotently) a native device token for a user. */
    async upsert(
      userId: string,
      device: { channel: NativePushChannel; token: string },
      userAgent: string | null,
    ): Promise<PushSubscriptionRow> {
      await db
        .prepare(
          `INSERT INTO "push_subscription" ("id","userId","channel","endpoint","p256dh","auth","expirationTime","userAgent","createdAt")
           VALUES (?,?,?,?,'','',NULL,?,?)
           ON CONFLICT("endpoint") DO UPDATE SET "userId" = excluded."userId", "channel" = excluded."channel",
             "userAgent" = excluded."userAgent", "failureCount" = 0`,
        )
        .bind(newId(), userId, device.channel, device.token, userAgent, nowIso())
        .run();
      return (await db
        .prepare('SELECT * FROM "push_subscription" WHERE "endpoint" = ?')
        .bind(device.token)
        .first<PushSubscriptionRow>()) as PushSubscriptionRow;
    },
    async deleteByToken(userId: string, token: string): Promise<boolean> {
      const r = await db
        .prepare(
          'DELETE FROM "push_subscription" WHERE "userId" = ? AND "endpoint" = ? AND "channel" != \'webpush\'',
        )
        .bind(userId, token)
        .run();
      return r.meta.changes > 0;
    },
  };
}

export type PushDevices = ReturnType<typeof createPushDevices>;
