import type { APIRoute } from "astro";
import { createLead } from "../../../lib/leads-store";
import { sendBusinessMail } from "../../../lib/mail";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function escapeHtml(input: string) {
  return String(input)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function normalizeString(input: unknown) {
  return String(input ?? "").trim();
}

function normalizeTranscript(input: unknown) {
  if (!Array.isArray(input)) return [];

  return input
    .map((item) => ({
      role:
        item?.role === "bot" || item?.role === "user"
          ? item.role
          : "user",
      text: normalizeString(item?.text),
      time: normalizeString(item?.time),
    }))
    .filter((item) => item.text);
}

function firstMatched(pattern: RegExp, value: string) {
  const matched = value.match(pattern);
  return matched?.[0] ?? "";
}

export const POST: APIRoute = async ({ request, url }) => {
  try {
    const contentType = request.headers.get("content-type") || "";

    if (!contentType.includes("application/json")) {
      return json({ ok: false, message: "仅支持 JSON 请求" }, 400);
    }

    const body = await request.json();

    const message = normalizeString(body?.message);
    const sessionId = normalizeString(body?.sessionId) || crypto.randomUUID();
    const currentPath = normalizeString(body?.currentPath) || "/";
    const pageHref = normalizeString(body?.pageHref) || url.origin;
    const source =
      normalizeString(body?.source) ||
      (currentPath.includes("mini") || pageHref.includes("mini-program")
        ? "mini-program"
        : "consult-widget");
    const transcript = normalizeTranscript(body?.transcript).slice(-12);
    const emailFromMessage = firstMatched(
      /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i,
      message,
    );
    const phoneFromMessage = firstMatched(
      /(?:\+?\d[\d\s-]{6,}\d)/,
      message,
    ).replace(/\s+/g, "");
    const wechatFromMessage = normalizeString(body?.wechat).replace(/^微信[:：]?\s*/i, "");
    const customerEmail =
      normalizeString(body?.customerEmail) || emailFromMessage;
    const customerPhone =
      normalizeString(body?.customerPhone) || phoneFromMessage;
    const customerWechat = wechatFromMessage;

    if (!message || message.length > 500) {
      return json({ ok: false, message: "消息内容不能为空且不能超过 500 字" }, 400);
    }

    const summaryParts = [
      customerEmail ? `邮箱：${customerEmail}` : "",
      customerPhone ? `电话：${customerPhone}` : "",
      customerWechat ? `微信：${customerWechat}` : "",
    ].filter(Boolean);

    const transcriptText = transcript.length
      ? transcript
          .map(
            (item) =>
              `[${item.time || "--:--"}] ${item.role === "bot" ? "顾问" : "客户"}：${item.text}`,
          )
          .join("\n")
      : "暂无上下文";

    let leadId = "";
    let leadSaved = false;
    let leadSaveError = "";

    try {
      const contact =
        summaryParts.join(" | ") ||
        customerWechat ||
        customerPhone ||
        customerEmail ||
        `未留联系方式 · 会话 ${sessionId}`;
      const savedLead = await createLead({
        name: customerWechat || customerPhone || customerEmail || "在线咨询客户",
        contact,
        appointmentType: "consultation",
        examType: "留学咨询",
        preferredTime: "尽快联系",
        need: [
          `客户最新消息：${message}`,
          selectedContextLine("页面", currentPath),
          selectedContextLine("完整地址", pageHref),
          transcript.length ? `最近聊天记录：\n${transcriptText}` : "",
        ]
          .filter(Boolean)
          .join("\n\n"),
        source,
      });

      leadId = savedLead.id;
      leadSaved = true;
    } catch (error) {
      leadSaveError = error instanceof Error ? error.message : "线索保存失败";
      console.warn("[consult] Failed to save lead", error);
    }

    const emailSent = await sendBusinessMail({
      subject: `【咨询浮窗】${summaryParts[0] || sessionId} - ${message.slice(0, 28)}`,
      text: [
        `会话 ID：${sessionId}`,
        leadId ? `线索 ID：${leadId}` : "",
        `页面：${currentPath}`,
        `完整地址：${pageHref}`,
        summaryParts.join(" | ") || "未识别到联系方式",
        "",
        `客户最新消息：${message}`,
        "",
        "最近聊天记录：",
        transcriptText,
      ]
        .filter(Boolean)
        .join("\n"),
      html: `
        <h2>收到新的咨询浮窗消息</h2>
        <p><strong>会话 ID：</strong>${escapeHtml(sessionId)}</p>
        ${leadId ? `<p><strong>线索 ID：</strong>${escapeHtml(leadId)}</p>` : ""}
        <p><strong>页面：</strong>${escapeHtml(currentPath)}</p>
        <p><strong>完整地址：</strong>${escapeHtml(pageHref)}</p>
        <p><strong>联系方式：</strong>${escapeHtml(summaryParts.join(" | ") || "未识别到联系方式")}</p>
        <p><strong>客户最新消息：</strong>${escapeHtml(message)}</p>
        <h3>最近聊天记录</h3>
        <pre style="white-space:pre-wrap;font-family:inherit;">${escapeHtml(transcriptText)}</pre>
      `,
      replyTo: customerEmail || undefined,
    });

    return json({
      ok: true,
      emailSent,
      leadSaved,
      leadId,
      leadSaveError,
      sessionId,
    });
  } catch (error) {
    return json(
      {
        ok: false,
        message: error instanceof Error ? error.message : "发送失败",
      },
      400,
    );
  }
};

function selectedContextLine(label: string, value: string) {
  return value ? `${label}：${value}` : "";
}
