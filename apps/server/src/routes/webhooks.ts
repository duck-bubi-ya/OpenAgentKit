import { type OpenAPIHono, z } from "@hono/zod-openapi";
import { KitError } from "@openagentkit/sdk/protocol";
import type { Context } from "hono";
import type { AppEnv, KitServices } from "../app-env.ts";
import { verifyWebhookSignature } from "../services/webhook-signature.ts";

const TERMINAL = new Set([
	"session.status_idled",
	"session.status_terminated",
	"session.thread_idled",
	"session.thread_terminated",
]);

function text(value: unknown): string | undefined {
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

async function signedBody(c: Context<AppEnv>, services: KitServices) {
	const secret = services.config.webhookSigningSecret;
	if (!services.config.sessionMessageSync || !secret) throw new KitError("not_found", "路由不存在");
	const body = await c.req.text();
	const signed = verifyWebhookSignature({
		secret,
		webhookId: c.req.header("webhook-id") ?? "",
		timestamp: c.req.header("webhook-timestamp") ?? "",
		signature: c.req.header("webhook-signature") ?? "",
		body,
	});
	if (!signed) throw new KitError("unauthorized", "回调签名无效");
	return body;
}

function webhookEnvelope(body: string) {
	try {
		return JSON.parse(body) as { type?: unknown; data?: { id?: unknown; type?: unknown } };
	} catch {
		throw new KitError("invalid_request", "回调信封无法解析");
	}
}

/** 百炼正式信封的事件名在 data.type，外层 type 固定为 event。测试门铃仍可用外层类型。 */
function eventName(envelope: { type?: unknown; data?: { type?: unknown } }): string | undefined {
	return text(envelope.data?.type) ?? text(envelope.type);
}

async function enqueueTerminal(
	services: KitServices,
	webhookId: string,
	envelope: { type?: unknown; data?: { id?: unknown; type?: unknown } },
) {
	const type = eventName(envelope);
	if (!type || !TERMINAL.has(type)) return;
	const sessionId = text(envelope.data?.id);
	if (!sessionId) throw new KitError("invalid_request", "终态通知缺少会话编号");
	await services.sessionMessageSync.accept({ webhookId, sessionId, triggerType: type });
	services.scheduler?.wake();
}

/** 百炼只把回调当门铃。验签后入队，立刻回复。未配置时返回 404。 */
export function registerWebhookRoutes(app: OpenAPIHono<AppEnv>) {
	app.openapi(
		{
			method: "post",
			path: "/api/kit/webhooks/bailian",
			tags: ["kit"],
			responses: {
				200: {
					description: "已接收。终态通知入队，其余类型只确认",
					content: { "application/json": { schema: z.object({ ok: z.literal(true) }) } },
				},
				400: { description: "信封无法解析，或终态通知缺少会话编号" },
				401: { description: "签名无效或时间超出 5 分钟" },
				404: { description: "未配置可访问的回调地址，或尚未取得签名密钥" },
			},
		},
		async (c) => {
			const services = c.get("services");
			const body = await signedBody(c, services);
			await enqueueTerminal(services, c.req.header("webhook-id") ?? "", webhookEnvelope(body));
			return c.json({ ok: true as const }, 200);
		},
	);
}
