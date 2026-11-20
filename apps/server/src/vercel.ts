import { Hono } from "hono";

// 入口文件不能在顶层加载业务模块。模块评估失败时，Vercel 只会返回
// FUNCTION_INVOCATION_FAILED，页面上只剩 HTTP 500。
const entry = new Hono();
let booting: ReturnType<typeof boot> | undefined;

function boot() {
	if (!process.env.KIT_DATA_DIR?.trim()) process.env.KIT_DATA_DIR = "/tmp/openagentkit";
	return Promise.all([import("./config.ts"), import("./services/index.ts"), import("./app.ts")]).then(
		async ([{ loadConfig }, { openKitServices }, { createApp }]) => {
			const config = loadConfig();
			if (config.database.driver === "sqlite") {
				console.warn("[kit-server] Vercel 上的 SQLite 只存在当前实例，冷启动后数据会丢失");
			}
			return createApp(await openKitServices(config));
		},
	);
}

entry.all("*", async (c) => {
	try {
		booting ??= boot();
		return (await booting).fetch(c.req.raw);
	} catch (error) {
		booting = undefined;
		const message = error instanceof Error ? error.message : String(error);
		console.error("[kit-server]", message);
		return c.json({ error: { code: "internal", message, retryable: true } }, 500);
	}
});

export default entry;
