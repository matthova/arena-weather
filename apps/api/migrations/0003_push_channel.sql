-- Native push channels. A row is still "one device of one user"; `channel` says how to reach it:
--   webpush: `endpoint` is the push-service URL, `p256dh`/`auth` the browser's keys (unchanged)
--   fcm:     `endpoint` is the Firebase registration token, `p256dh`/`auth` are empty
--   apns:    `endpoint` is the APNs device token, `p256dh`/`auth` are empty
ALTER TABLE "push_subscription" ADD COLUMN "channel" TEXT NOT NULL DEFAULT 'webpush';
CREATE INDEX IF NOT EXISTS "push_subscription_channel_idx" ON "push_subscription"("channel");
