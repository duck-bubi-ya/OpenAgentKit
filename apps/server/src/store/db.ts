import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { migrationOrder } from "./migrations/manifest.ts";
import { migrationRuns } from "./migrations/runs.ts";

// esbuild 会把静态 `node:sqlite` 改写为 `sqlite`（丢前缀），故用变量间接动态 import 绕过。
const SQLITE_SPEC = "node:sqlite";
const { DatabaseSync: DatabaseSyncCtor } = (await import(SQLITE_SPEC)) as typeof import("node:sqlite");

type Migration = { id: string; sql?: string; run?: (db: DatabaseSync) => void };

function readMigration(id: string): string {
	return readFileSync(new URL(`./migrations/${id}.sql`, import.meta.url), "utf8");
}

/** 顺序以 manifest 为准。SQL 放在同名文件里，要按数据重算的迁移导出 run。 */
function loadMigrations(): Migration[] {
	return migrationOrder.map((entry) => {
		if (entry.source === "run") {
			const run = migrationRuns[entry.id];
			if (!run) throw new Error(`缺少迁移函数：${entry.id}`);
			return { id: entry.id, run };
		}
		return { id: entry.id, sql: readMigration(entry.id) };
	});
}

const MIGRATIONS = loadMigrations();

/**
 * SQLite（Node 内置 node:sqlite）+ 版本表。见 docs/adr/0003。
 * 当前表结构见 schema.sql，那份文件不参与启动。
 * 保存目录、运营索引、临时资源声明与 SDK state，以及成员密码派生值；绝不存事件正文与凭据明文。
 */
export function openDatabase(dataDir: string): DatabaseSync {
	const db = new DatabaseSyncCtor(join(dataDir, "kit.sqlite"));
	db.exec("PRAGMA journal_mode = WAL;");
	db.exec("CREATE TABLE IF NOT EXISTS _kit_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL);");
	const applied = new Set(
		(db.prepare("SELECT id FROM _kit_migrations").all() as { id: string }[]).map((row) => row.id),
	);
	for (const migration of MIGRATIONS) {
		if (applied.has(migration.id)) continue;
		db.exec("BEGIN");
		try {
			if (migration.run) migration.run(db);
			else if (migration.sql) db.exec(migration.sql);
			else throw new Error(`迁移 ${migration.id} 没有内容`);
			db.prepare("INSERT INTO _kit_migrations (id, applied_at) VALUES (?, ?)").run(
				migration.id,
				new Date().toISOString(),
			);
			db.exec("COMMIT");
		} catch (error) {
			db.exec("ROLLBACK");
			throw error;
		}
	}
	return db;
}
