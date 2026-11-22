import type { Rule, RuleDefinition } from "@arena-weather/core";
import { newId, nowIso } from "../lib/http.js";

interface RuleRow {
  id: string;
  userId: string;
  name: string;
  definition: string;
  paused: number;
  armed: number;
  lastEvaluatedAt: string | null;
  lastFiredAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StoredRule extends Rule {
  userId: string;
  lastError: string | null;
}

function rowToRule(row: RuleRow): StoredRule {
  const definition = JSON.parse(row.definition) as RuleDefinition;
  return {
    ...definition,
    id: row.id,
    userId: row.userId,
    name: row.name,
    paused: row.paused === 1,
    armed: row.armed === 1,
    lastEvaluatedAt: row.lastEvaluatedAt,
    lastFiredAt: row.lastFiredAt,
    lastError: row.lastError,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** Strip server fields so a StoredRule can be returned to clients as a Rule. */
export function publicRule(rule: StoredRule): Rule {
  const { userId: _u, lastError: _e, ...rest } = rule;
  return rest;
}

export interface PushSubscriptionRow {
  id: string;
  userId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  expirationTime: number | null;
  userAgent: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  failureCount: number;
}

export function createRepo(db: D1Database) {
  return {
    rules: {
      async listByUser(userId: string): Promise<StoredRule[]> {
        const { results } = await db
          .prepare('SELECT * FROM "rule" WHERE "userId" = ? ORDER BY "createdAt" DESC')
          .bind(userId)
          .all<RuleRow>();
        return results.map(rowToRule);
      },
      async get(id: string, userId: string): Promise<StoredRule | null> {
        const row = await db
          .prepare('SELECT * FROM "rule" WHERE "id" = ? AND "userId" = ?')
          .bind(id, userId)
          .first<RuleRow>();
        return row ? rowToRule(row) : null;
      },
      async listActive(): Promise<StoredRule[]> {
        const { results } = await db
          .prepare('SELECT * FROM "rule" WHERE "paused" = 0 ORDER BY "createdAt"')
          .all<RuleRow>();
        return results.map(rowToRule);
      },
      async create(userId: string, definition: RuleDefinition): Promise<StoredRule> {
        const id = newId();
        const now = nowIso();
        await db
          .prepare(
            'INSERT INTO "rule" ("id","userId","name","definition","paused","armed","createdAt","updatedAt") VALUES (?,?,?,?,0,1,?,?)',
          )
          .bind(id, userId, definition.name, JSON.stringify(definition), now, now)
          .run();
        return (await this.get(id, userId)) as StoredRule;
      },
      /** Replace the definition; re-arms the rule since its meaning changed. */
      async update(
        id: string,
        userId: string,
        definition: RuleDefinition,
      ): Promise<StoredRule | null> {
        const r = await db
          .prepare(
            'UPDATE "rule" SET "name" = ?, "definition" = ?, "armed" = 1, "lastError" = NULL, "updatedAt" = ? WHERE "id" = ? AND "userId" = ?',
          )
          .bind(definition.name, JSON.stringify(definition), nowIso(), id, userId)
          .run();
        if (!r.meta.changes) return null;
        return this.get(id, userId);
      },
      async setPaused(id: string, userId: string, paused: boolean): Promise<StoredRule | null> {
        // resuming re-arms so a condition that is already true fires once right away
        const r = await db
          .prepare(
            'UPDATE "rule" SET "paused" = ?, "armed" = CASE WHEN ? = 0 THEN 1 ELSE "armed" END, "updatedAt" = ? WHERE "id" = ? AND "userId" = ?',
          )
          .bind(paused ? 1 : 0, paused ? 1 : 0, nowIso(), id, userId)
          .run();
        if (!r.meta.changes) return null;
        return this.get(id, userId);
      },
      async delete(id: string, userId: string): Promise<boolean> {
        const r = await db
          .prepare('DELETE FROM "rule" WHERE "id" = ? AND "userId" = ?')
          .bind(id, userId)
          .run();
        return r.meta.changes > 0;
      },
      async recordEvaluation(
        id: string,
        state: { armed: boolean; fired: boolean; error?: string | null; at?: string },
      ): Promise<void> {
        const at = state.at ?? nowIso();
        await db
          .prepare(
            'UPDATE "rule" SET "armed" = ?, "lastEvaluatedAt" = ?, "lastFiredAt" = CASE WHEN ? THEN ? ELSE "lastFiredAt" END, "lastError" = ? WHERE "id" = ?',
          )
          .bind(state.armed ? 1 : 0, at, state.fired ? 1 : 0, at, state.error ?? null, id)
          .run();
      },
    },

    push: {
      async listByUser(userId: string): Promise<PushSubscriptionRow[]> {
        const { results } = await db
          .prepare('SELECT * FROM "push_subscription" WHERE "userId" = ? ORDER BY "createdAt"')
          .bind(userId)
          .all<PushSubscriptionRow>();
        return results;
      },
      async upsert(
        userId: string,
        sub: { endpoint: string; p256dh: string; auth: string; expirationTime?: number | null },
        userAgent: string | null,
      ): Promise<PushSubscriptionRow> {
        const now = nowIso();
        await db
          .prepare(
            `INSERT INTO "push_subscription" ("id","userId","endpoint","p256dh","auth","expirationTime","userAgent","createdAt")
             VALUES (?,?,?,?,?,?,?,?)
             ON CONFLICT("endpoint") DO UPDATE SET "userId" = excluded."userId", "p256dh" = excluded."p256dh",
               "auth" = excluded."auth", "expirationTime" = excluded."expirationTime", "userAgent" = excluded."userAgent", "failureCount" = 0`,
          )
          .bind(
            newId(),
            userId,
            sub.endpoint,
            sub.p256dh,
            sub.auth,
            sub.expirationTime ?? null,
            userAgent,
            now,
          )
          .run();
        return (await db
          .prepare('SELECT * FROM "push_subscription" WHERE "endpoint" = ?')
          .bind(sub.endpoint)
          .first<PushSubscriptionRow>()) as PushSubscriptionRow;
      },
      async deleteByEndpoint(userId: string, endpoint: string): Promise<boolean> {
        const r = await db
          .prepare('DELETE FROM "push_subscription" WHERE "userId" = ? AND "endpoint" = ?')
          .bind(userId, endpoint)
          .run();
        return r.meta.changes > 0;
      },
      async deleteById(id: string): Promise<void> {
        await db.prepare('DELETE FROM "push_subscription" WHERE "id" = ?').bind(id).run();
      },
      async markResult(id: string, ok: boolean): Promise<void> {
        await db
          .prepare(
            'UPDATE "push_subscription" SET "lastUsedAt" = ?, "failureCount" = CASE WHEN ? THEN 0 ELSE "failureCount" + 1 END WHERE "id" = ?',
          )
          .bind(nowIso(), ok ? 1 : 0, id)
          .run();
      },
    },

    notifications: {
      async record(n: {
        userId: string;
        ruleId: string | null;
        kind: "alert" | "test";
        title: string;
        body: string;
        attempted: number;
        delivered: number;
      }): Promise<void> {
        await db
          .prepare(
            'INSERT INTO "notification" ("id","userId","ruleId","kind","title","body","attempted","delivered","createdAt") VALUES (?,?,?,?,?,?,?,?,?)',
          )
          .bind(
            newId(),
            n.userId,
            n.ruleId,
            n.kind,
            n.title,
            n.body,
            n.attempted,
            n.delivered,
            nowIso(),
          )
          .run();
      },
      async listByUser(userId: string, limit = 50) {
        const { results } = await db
          .prepare(
            'SELECT * FROM "notification" WHERE "userId" = ? ORDER BY "createdAt" DESC LIMIT ?',
          )
          .bind(userId, limit)
          .all();
        return results;
      },
    },
  };
}

export type Repo = ReturnType<typeof createRepo>;
