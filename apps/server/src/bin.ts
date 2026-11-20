import { serve } from "@hono/node-server";
import { createApp } from "./app.ts";
import { loadConfig, redactSecrets } from "./config.ts";
import { openKitServices } from "./services/index.ts";
import { ensureWebhookSigningSecret, readWebhookSettings } from "./services/webhook-endpoint.ts";

const config = loadConfig();
const savedWebhook = readWebhookSettings(config.dataDir);
const webhookPublicUrl =
	savedWebhook.status === "error" ? undefined : savedWebhook.publicUrl || config.webhookPublicUrl;
if (webhookPublicUrl && !config.webhookSigningSecret) {
	if (!config.bailian) {
		console.error("[kit-server] 已有回调对外入口，但缺少百炼凭据，终态回调未启用");
	} else {
		try {
			config.webhookSigningSecret = await ensureWebhookSigningSecret({
				dataDir: config.dataDir,
				publicUrl: webhookPublicUrl,
				credentials: config.bailian,
			});
			config.webhookPublicUrl = webhookPublicUrl;
			config.sessionMessageSync = true;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			console.error("[kit-server] 终态回调未启用", redactSecrets(message));
		}
	}
}
const services = await openKitServices(config);
const app = createApp(services);

const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
	console.warn(
		`[kit-server] http://localhost:${info.port} gateway=${config.resolvedGateway} db=${config.database.driver} data=${config.dataDir}`,
	);
	void services.scheduler?.start().catch((error: unknown) => {
		const message = error instanceof Error ? error.message : String(error);
		console.error("[kit-server] 会话消息调度启动失败", redactSecrets(message));
		server.close();
	});
});
server.once("close", () => {
	void services.close().catch(() => console.error("[kit-server] 关闭数据库连接失败"));
});
