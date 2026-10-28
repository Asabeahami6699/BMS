import nodemailer from "nodemailer";
import { getSmtpConfig, hasSmtpConfig } from "../config/env.js";

export type SendEmailInput = {
  to: string;
  subject: string;
  text: string;
  fromName?: string;
  replyTo?: string;
};

export type SendEmailResult = {
  mode: "smtp" | "console";
  messageId?: string;
};

export async function sendPlatformEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const smtp = getSmtpConfig();
  const fromName = input.fromName?.trim() || "BMS Notifications";
  const from = hasSmtpConfig() ? `"${fromName}" <${smtp.from}>` : fromName;

  if (!hasSmtpConfig()) {
    console.info("[email] SMTP not configured — message logged locally:");
    console.info(`  To: ${input.to}`);
    console.info(`  Subject: ${input.subject}`);
    console.info(`  Body: ${input.text}`);
    if (input.replyTo) {
      console.info(`  Reply-To: ${input.replyTo}`);
    }
    return { mode: "console" };
  }

  const transport = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    auth: smtp.user && smtp.pass ? { user: smtp.user, pass: smtp.pass } : undefined
  });

  const info = await transport.sendMail({
    from,
    to: input.to,
    replyTo: input.replyTo || undefined,
    subject: input.subject,
    text: input.text
  });

  return { mode: "smtp", messageId: info.messageId };
}

export function getEmailPlatformStatus(): { configured: boolean } {
  return { configured: hasSmtpConfig() };
}
