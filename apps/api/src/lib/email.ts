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

/** Resend over its REST API. Without RESEND_API_KEY (local dev / tests) the e-mail is logged instead. */
export function createEmailSender(env: Pick<Env, "RESEND_API_KEY" | "EMAIL_FROM">): EmailSender {
  return {
    async send(message) {
      if (!env.RESEND_API_KEY) {
        console.log(
          `[email:dev] to=${message.to} subject=${JSON.stringify(message.subject)}\n${message.text}`,
        );
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
