import { type OpenAPIHono, z } from "@hono/zod-openapi";
import { KitError } from "@openagentkit/sdk/protocol";
import type { AppEnv, KitServices } from "../app-env.ts";
import { requireAdminWrite } from "../services/identity.ts";
import {
	assertPublicWebhookUrl,
	ensureWebhookSigningSecret,
	probeWebhookEndpoint,
	readWebhookSettings,
	type WebhookSettingsView,
} from "../services/webhook-endpoint.ts";

const errorBody = z.object({
	error: z.object({ code: z.string(), message: z.string(), retryable: z.boolean().optional() }),
});
const errors = {
	400: { description: "invalid_request", content: { "application/json": { schema: errorBody } } },
	401: { description: "管理端未认证", content: { "application/json": { schema: errorBody } } },
	403: { description: "forbidden", content: { "application/json": { schema: errorBody } } },
	409: { description: "conflict", content: { "application/json": { schema: errorBody } } },
};

const WebhookSettingsSchema = z.object({
	publicUrl: z.string().optional(),
	callbackUrl: z.string().optional(),
	status: z.enum(["unconfigured", "active", "error"]),
	detail: z.string().optional(),
	checkedAt: z.string().optional(),
});

function viewOf(services: KitServices): WebhookSettingsView {
	return readWebhookSettings(services.config.dataDir);
}

function fail(error: unknown): never {
	const message = error instanceof Error ? error.message : "回调地址保存失败";
	throw new KitError(message.includes("尚未登记") ? "conflict" : "invalid_request", message);
}

async function enable(services: KitServices, publicUrl: string): Promise<WebhookSettingsView> {
	try {
		assertPublicWebhookUrl(publicUrl);
	} catch (error) {
		fail(error);
	}
	const credentials = services.config.bailian;
	if (!credentials) throw new KitError("conflict", "未配置百炼凭据，不能登记回调地址");
	let secret: string;
	try {
		secret = await ensureWebhookSigningSecret({ dataDir: services.config.dataDir, publicUrl, credentials });
	} catch (error) {
		fail(error);
	}
	services.config.webhookPublicUrl = publicUrl.trim().replace(/\/+$/, "");
	services.config.webhookSigningSecret = secret;
	services.config.sessionMessageSync = true;
	await services.scheduler.start();
	try {
		return await probeWebhookEndpoint({ dataDir: services.config.dataDir, publicUrl, credentials });
	} catch (error) {
		fail(error);
	}
}

/** 管理端登记本服务的对外入口。签名密钥只留在数据目录，响应里不出现。 */
export function registerWebhookSettingsRoutes(app: OpenAPIHono<AppEnv>) {
	app.openapi(
		{
			method: "get",
			path: "/api/admin/webhook",
			tags: ["admin"],
			responses: {
				200: {
					description: "已保存的对外入口。未登记时 status 为 unconfigured",
					content: { "application/json": { schema: z.object({ data: WebhookSettingsSchema }) } },
				},
				...errors,
			},
		},
		(c) => c.json({ data: viewOf(c.get("services")) }, 200),
	);

	app.openapi(
		{
			method: "put",
			path: "/api/admin/webhook",
			tags: ["admin"],
			request: {
				body: {
					content: {
						"application/json": { schema: z.object({ publicUrl: z.string().trim().min(1).max(2048) }) },
					},
				},
			},
			responses: {
				200: {
					description: "已向百炼登记并测试连通。密钥不返回",
					content: { "application/json": { schema: z.object({ data: WebhookSettingsSchema }) } },
				},
				...errors,
			},
		},
		async (c) => {
			const services = c.get("services");
			const { subject } = requireAdminWrite(c, services.config);
			const { publicUrl } = c.req.valid("json");
			const data = await enable(services, publicUrl);
			await services.audit.append({
				subject,
				action: "webhook.update",
				target: "webhook",
				detail: { publicUrl: data.publicUrl, status: data.status },
			});
			return c.json({ data }, 200);
		},
	);

	app.openapi(
		{
			method: "post",
			path: "/api/admin/webhook/test",
			tags: ["admin"],
			responses: {
				200: {
					description: "向已登记地址发送一次测试。失败记在 status 与 detail，不返回密钥",
					content: { "application/json": { schema: z.object({ data: WebhookSettingsSchema }) } },
				},
				...errors,
			},
		},
		async (c) => {
			const services = c.get("services");
			requireAdminWrite(c, services.config);
			const credentials = services.config.bailian;
			if (!credentials) throw new KitError("conflict", "未配置百炼凭据，不能测试回调");
			try {
				const data = await probeWebhookEndpoint({
					dataDir: services.config.dataDir,
					publicUrl: services.config.webhookPublicUrl ?? "",
					credentials,
				});
				return c.json({ data }, 200);
			} catch (error) {
				fail(error);
			}
		},
	);
}
