-- Alert rules. `definition` is the JSON validated by @arena-weather/core's ruleDefinitionSchema.
CREATE TABLE IF NOT EXISTS "rule" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "name" TEXT NOT NULL,
  "definition" TEXT NOT NULL,
  "paused" INTEGER NOT NULL DEFAULT 0,
  -- trigger state: 1 = will fire the next time the rule becomes true
  "armed" INTEGER NOT NULL DEFAULT 1,
  "lastEvaluatedAt" TEXT,
  "lastFiredAt" TEXT,
  "lastError" TEXT,
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS "rule_userId_idx" ON "rule"("userId");
CREATE INDEX IF NOT EXISTS "rule_paused_idx" ON "rule"("paused");

-- Web push subscriptions, one row per browser/device.
CREATE TABLE IF NOT EXISTS "push_subscription" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "endpoint" TEXT NOT NULL UNIQUE,
  "p256dh" TEXT NOT NULL,
  "auth" TEXT NOT NULL,
  "expirationTime" INTEGER,
  "userAgent" TEXT,
  "createdAt" TEXT NOT NULL,
  "lastUsedAt" TEXT,
  "failureCount" INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS "push_subscription_userId_idx" ON "push_subscription"("userId");

-- Notification history (what was sent, when, and whether it went through).
CREATE TABLE IF NOT EXISTS "notification" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "ruleId" TEXT REFERENCES "rule"("id") ON DELETE SET NULL,
  "kind" TEXT NOT NULL, -- 'alert' | 'test'
  "title" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "attempted" INTEGER NOT NULL DEFAULT 0,
  "delivered" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS "notification_userId_idx" ON "notification"("userId", "createdAt");
