import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { run as rebuildUsageDays } from "./schema/history/022_usage_limit_days_rebuild.ts";
import { run as bindCatalogAgentVersion } from "./schema/history/023_catalog_agent_version_binding.ts";
import { run as restoreDraftCleanupOwnership } from "./schema/history/026_resource_draft_cleanup_ownership.ts";
import { run as addDailyUsageLimits } from "./schema/history/027_usage_limit_daily.ts";
import { run as addResourceDraftAssets } from "./schema/history/030_resource_draft_assets.ts";
import { run as retireDirectoryDrafts } from "./schema/history/031_retire_directory_drafts.ts";
import manifest from "./schema/manifest.json" with { type: "json" };

const runs: Partial<Record<string, (db: DatabaseSync) => void>> = {
	"022_usage_limit_days_rebuild": rebuildUsageDays,
	"023_catalog_agent_version_binding": bindCatalogAgentVersion,
	"026_resource_draft_cleanup_ownership": restoreDraftCleanupOwnership,
	"027_usage_limit_daily": addDailyUsageLimits,
	"030_resource_draft_assets": addResourceDraftAssets,
	"031_retire_directory_drafts": retireDirectoryDrafts,
};

export const sqliteHistory = manifest
	.filter(({ source }) => source !== "version")
	.map(({ id, source }) => {
		if (!/^\d{3}_[a-z0-9_]+$/.test(id)) throw new Error("无效的 SQLite 历史迁移 ID");
		if (source === "sql") return { id, sql: readHistorySql(id) };
		const run = runs[id];
		if (source === "run" && run) return { id, run };
		throw new Error(`缺少 SQLite 历史迁移实现：${id}`);
	});

/** 源码和 tsup 产物靠模块相对路径；Vercel 打包后改从项目目录读取。 */
function readHistorySql(id: string): string {
	const besideModule = new URL(`./schema/history/${id}.sql`, import.meta.url);
	if (existsSync(besideModule)) return readFileSync(besideModule, "utf8");
	for (const dir of [
		join(process.cwd(), "src/store/schema/history"),
		join(process.cwd(), "apps/server/src/store/schema/history"),
	]) {
		const file = join(dir, `${id}.sql`);
		if (existsSync(file)) return readFileSync(file, "utf8");
	}
	throw new Error(`缺少 SQLite 历史迁移文件：${id}`);
}
