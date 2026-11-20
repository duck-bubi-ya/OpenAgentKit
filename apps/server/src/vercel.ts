import { createApp } from "./app.ts";
import { loadConfig } from "./config.ts";
import { openKitServices } from "./services/index.ts";

// 只给 Vercel Functions 用。部署目录只读，未指定数据目录时落到 /tmp。
// 本地仍走 src/bin.ts，不读这个文件。
if (!process.env.KIT_DATA_DIR?.trim()) process.env.KIT_DATA_DIR = "/tmp/openagentkit";

const config = loadConfig();
if (config.database.driver === "sqlite") {
	console.warn("[kit-server] Vercel 上的 SQLite 只存在当前实例，冷启动后数据会丢失");
}
const services = await openKitServices(config);

export default createApp(services);
