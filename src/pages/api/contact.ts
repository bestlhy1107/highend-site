import type { APIRoute } from "astro";
import nodemailer from "nodemailer";

function json(status: number, data: any) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

export const POST: APIRoute = async ({ request }) => {
  try {
    const contentType = request.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json")) {
      return json(400, { ok: false, message: "Content-Type must be application/json" });
    }

    const body = await request.json().catch(() => ({} as any));
    const name = String(body.name ?? "").trim();
    const email = String(body.email ?? "").trim();
    const phone = String(body.phone ?? "").trim();
    const message = String(body.message ?? "").trim();

    if (!message) return json(400, { ok: false, message: "message is required" });
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return json(400, { ok: false, message: "email format is invalid" });
    }

    // SMTP 配置（写在 .env，不要 PUBLIC_ 前缀）
    const SMTP_HOST = import.meta.env.SMTP_HOST;
    const SMTP_PORT = Number(import.meta.env.SMTP_PORT ?? 465);
    const SMTP_USER = import.meta.env.SMTP_USER;
    const SMTP_PASS = import.meta.env.SMTP_PASS;

    if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
      return json(500, {
        ok: false,
        message: "Missing SMTP env: SMTP_HOST / SMTP_USER / SMTP_PASS",
      });
    }

    const CONTACT_TO = import.meta.env.CONTACT_TO ?? SMTP_USER; // 默认发给自己
    const FROM_EMAIL = import.meta.env.CONTACT_FROM ?? SMTP_USER;

    const transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_PORT === 465, // 465 一般是 true；587 一般是 false
      auth: { user: SMTP_USER, pass: SMTP_PASS },
    });

    const subject = `【网站咨询】${name || "匿名"}${phone ? " / " + phone : ""}`;

    const text =
      `来自网站的联系表单\n\n` +
      `姓名：${name || "（未填写）"}\n` +
      `邮箱：${email || "（未填写）"}\n` +
      `电话：${phone || "（未填写）"}\n\n` +
      `留言：\n${message}\n`;

    await transporter.sendMail({
      from: `Highend Site <${FROM_EMAIL}>`,
      to: CONTACT_TO,
      replyTo: email || undefined,
      subject,
      text,
    });

    return json(200, { ok: true });
  } catch (e: any) {
    return json(500, { ok: false, message: e?.message ?? String(e) });
  }
};