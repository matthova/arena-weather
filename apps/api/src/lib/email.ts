import type { Env } from "../env.js";

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface EmailSender {
  send(message: EmailMessage): Promise<void>;
}

export interface DevOutboxMessage extends EmailMessage {
  sentAt: string;
}

const DEV_OUTBOX_LIMIT = 50;

/**
 * E-mails "sent" while no RESEND_API_KEY is set, newest first. Lives in the isolate's memory only,
 * so it is useful for local development (`GET /api/dev/outbox`) and nothing else.
 */
export const devOutbox: DevOutboxMessage[] = [];

/** The dev outbox is only served on a localhost API without a mail provider. */
export function devMailboxEnabled(env: Pick<Env, "RESEND_API_KEY" | "API_URL">): boolean {
  if (env.RESEND_API_KEY) return false;
  try {
    const host = new URL(env.API_URL).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "::1";
  } catch {
    return false;
  }
}

/** Resend over its REST API. Without RESEND_API_KEY (local dev / tests) the e-mail is logged instead. */
export function createEmailSender(
  env: Pick<Env, "RESEND_API_KEY" | "EMAIL_FROM" | "API_URL">,
): EmailSender {
  return {
    async send(message) {
      if (!env.RESEND_API_KEY) {
        console.log(
          `[email:dev] to=${message.to} subject=${JSON.stringify(message.subject)}\n${message.text}`,
        );
        devOutbox.unshift({ ...message, sentAt: new Date().toISOString() });
        devOutbox.length = Math.min(devOutbox.length, DEV_OUTBOX_LIMIT);
        return;
      }
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          authorization: `Bearer ${env.RESEND_API_KEY}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          from: env.EMAIL_FROM,
          to: [message.to],
          subject: message.subject,
          text: message.text,
          html: message.html,
        }),
      });
      if (!res.ok) {
        throw new Error(`Resend failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
      }
    },
  };
}
