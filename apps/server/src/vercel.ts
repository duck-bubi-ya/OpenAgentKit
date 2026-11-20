import { Hono } from "hono";
import { createApp } from "./app.ts";
import { loadConfig } from "./config.ts";
import { openKitServices } from "./services/index.ts";

// 数据库放到请求里打开。模块顶层失败时 Vercel 只返回 FUNCTION_INVOCATION_FAILED，页面上看不到原因。
const entry = new Hono();
let booting: ReturnType<typeof boot> | undefined;

function boot() {
	if (!process.env.KIT_DATA_DIR?.trim()) process.env.KIT_DATA_DIR = "/tmp/openagentkit";
	const config = loadConfig();
	if (config.database.driver === "sqlite") {
		console.warn("[kit-server] Vercel 上的 SQLite 只存在当前实例，冷启动后数据会丢失");
	}
	return openKitServices(config).then((services) => createApp(services));
}

entry.all("*", async (c) => {
	try {
		booting ??= boot();
		const app = await booting;
		return app.fetch(c.req.raw);
	} catch (error) {
		booting = undefined;
		const message = error instanceof Error ? error.message : String(error);
		console.error("[kit-server]", message);
		return c.json({ error: { code: "internal", message, retryable: true } }, 500);
	}
});

export default entry;
