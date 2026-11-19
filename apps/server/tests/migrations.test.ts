import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { openDatabase } from "../src/store/db.ts";
import { migrationOrder } from "../src/store/migrations/manifest.ts";

const historical = [
	"001_init",
	"002_session_files",
	"003_quota_plaza",
	"004_members",
	"005_member_auth",
	"006_legacy_file_ownership",
	"007_admin_debug_scope",
	"008_member_session_usage",
	"009_member_usage_limits",
	"010_catalog_environment",
	"011_catalog_files",
	"012_catalog_memory_stores",
	"013_catalog_vaults",
	"014_member_groups",
	"015_template_debug_sessions",
	"016_saved_templates",
	"017_template_listings",
	"018_template_versions",
	"019_template_usage_limits",
	"020_usage_limit_days",
	"021_usage_limit_days_backfill",
	"022_usage_limit_days_rebuild",
	"023_catalog_agent_version_binding",
	"024_template_default_environment",
	"025_resource_draft_batches",
	"026_resource_draft_cleanup_ownership",
	"027_usage_limit_daily",
	"023_catalog_listed_at",
	"023_session_message_files",
	"028_preset_packs",
	"029_yaml_resource_drafts",
	"030_resource_draft_assets",
	"031_retire_directory_drafts",
	"032_publication_result_contract",
	"029_branding",
	"030_branding_logo",
];

it("保留已经发布的迁移 id 和执行顺序", () => {
	const ids = migrationOrder.map((entry) => entry.id);
	expect(ids.slice(0, historical.length)).toEqual(historical);
	expect(new Set(ids).size).toBe(ids.length);
	let previous = 32;
	for (const entry of migrationOrder.slice(historical.length)) {
		const prefix = Number(entry.id.slice(0, 3));
		expect(prefix).toBeGreaterThan(previous);
		previous = prefix;
	}
});

it("每条迁移对应一个文件，目录里没有多余文件", () => {
	const directory = fileURLToPath(new URL("../src/store/migrations/", import.meta.url));
	const files = readdirSync(directory).filter(
		(name) => name.endsWith(".sql") || (name.endsWith(".ts") && name !== "manifest.ts" && name !== "runs.ts"),
	);
	const expected = migrationOrder.map((entry) => `${entry.id}.${entry.source === "sql" ? "sql" : "ts"}`);
	expect(files.sort()).toEqual([...expected].sort());
});

it("schema.sql 描述的就是迁移跑完后的库", () => {
	const dataDir = mkdtempSync(join(tmpdir(), "kit-migrations-"));
	const schemaDir = mkdtempSync(join(tmpdir(), "kit-schema-"));
	const migrated = openDatabase(dataDir);
	const documented = new DatabaseSync(join(schemaDir, "schema.sqlite"));
	try {
		documented.exec(readFileSync(new URL("../src/store/schema.sql", import.meta.url), "utf8"));
		expect(snapshot(documented)).toEqual(snapshot(migrated));
		expect(documented.prepare("SELECT monthly_credits FROM quota_policy WHERE id = 1").get()).toEqual({
			monthly_credits: 200,
		});
		expect(documented.prepare("SELECT product_name FROM kit_branding WHERE id = 1").get()).toEqual({
			product_name: "OpenAgentPack Kit",
		});
	} finally {
		migrated.close();
		documented.close();
		rmSync(dataDir, { recursive: true, force: true });
		rmSync(schemaDir, { recursive: true, force: true });
	}
});

function snapshot(db: DatabaseSync) {
	const tables = db
		.prepare(
			"SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name != '_kit_migrations' ORDER BY name",
		)
		.all() as { name: string; sql: string }[];
	return Object.fromEntries(
		tables.map((table) => [
			table.name,
			{
				columns: db.prepare(`PRAGMA table_info(${table.name})`).all(),
				indexes: indexSql(db, table.name),
				foreignKeys: db.prepare(`PRAGMA foreign_key_list(${table.name})`).all(),
				checks: checkExpressions(table.sql),
				autoincrement: /autoincrement/i.test(table.sql),
			},
		]),
	);
}

function indexSql(db: DatabaseSync, table: string): string[] {
	const rows = db
		.prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND tbl_name = ? AND sql IS NOT NULL ORDER BY name")
		.all(table) as { sql: string }[];
	return rows.map((row) => normalizeSql(row.sql));
}

function checkExpressions(sql: string): string[] {
	const found: string[] = [];
	const lower = sql.toLowerCase();
	let search = 0;
	while (search < lower.length) {
		const at = lower.indexOf("check", search);
		if (at < 0) break;
		const expression = balancedCall(sql, at + "check".length);
		if (expression) found.push(normalizeSql(expression));
		search = at + "check".length + (expression?.length ?? 1);
	}
	return found.sort();
}

function balancedCall(sql: string, start: number): string | undefined {
	const open = skipWhitespace(sql, start);
	if (sql[open] !== "(") return undefined;
	const end = closeParen(sql, open);
	return end === undefined ? undefined : sql.slice(open, end);
}

function skipWhitespace(sql: string, start: number): number {
	let cursor = start;
	while (cursor < sql.length && /\s/.test(sql[cursor] ?? "")) cursor += 1;
	return cursor;
}

function closeParen(sql: string, open: number): number | undefined {
	let depth = 0;
	for (let cursor = open; cursor < sql.length; cursor += 1) {
		const char = sql[cursor];
		if (char === "(") depth += 1;
		if (char === ")") depth -= 1;
		if (char === ")" && depth === 0) return cursor + 1;
	}
	return undefined;
}

function normalizeSql(sql: string): string {
	return sql
		.replace(/if\s+not\s+exists/gi, "")
		.replace(/"/g, "")
		.replace(/\s+/g, " ")
		.replace(/\s*([(),])\s*/g, "$1")
		.trim()
		.toLowerCase();
}
