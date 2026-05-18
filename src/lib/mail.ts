import nodemailer from "nodemailer";

const SMTP_HOST = import.meta.env?.SMTP_HOST || process.env.SMTP_HOST;
const SMTP_PORT = import.meta.env?.SMTP_PORT || process.env.SMTP_PORT;
const SMTP_SECURE = import.meta.env?.SMTP_SECURE || process.env.SMTP_SECURE;
const SMTP_USER = import.meta.env?.SMTP_USER || process.env.SMTP_USER;
const SMTP_PASS = import.meta.env?.SMTP_PASS || process.env.SMTP_PASS;
const LEAD_TO_EMAIL = import.meta.env?.LEAD_TO_EMAIL || process.env.LEAD_TO_EMAIL;
const MAIL_FROM = import.meta.env?.MAIL_FROM || process.env.MAIL_FROM;

export const smtpConfigured =
  !!SMTP_HOST &&
  !!SMTP_PORT &&
  !!SMTP_USER &&
  !!SMTP_PASS;

const transporter = smtpConfigured
  ? nodemailer.createTransport({
      host: SMTP_HOST,
      port: Number(SMTP_PORT),
      secure: String(SMTP_SECURE).toLowerCase() === "true",
      auth: {
        user: SMTP_USER,
        pass: SMTP_PASS,
      },
    })
  : null;

export function getMailTarget() {
  return LEAD_TO_EMAIL || SMTP_USER || "";
}

export function getMailFrom() {
  return MAIL_FROM || SMTP_USER || "";
}

export async function sendBusinessMail(input: {
  subject: string;
  text: string;
  html?: string;
  replyTo?: string;
}) {
  const to = getMailTarget();
  const from = getMailFrom();

  if (!transporter || !to || !from) {
    return false;
  }

  try {
    await transporter.sendMail({
      from,
      to,
      subject: input.subject,
      text: input.text,
      html: input.html,
      replyTo: input.replyTo || undefined,
    });

    return true;
  } catch (error) {
    console.error("Failed to send business email", error);
    return false;
  }
}
