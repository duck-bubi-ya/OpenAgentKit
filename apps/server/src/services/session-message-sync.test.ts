import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { KitError } from "@openagentkit/sdk/protocol";
import { afterEach, describe, expect, it } from "vitest";
import type { ListedSessionMessage } from "../gateway/session-messages.ts";
import { openDatabase } from "../store/db.ts";
import { createSessionMessageJobStore } from "../store/session-message-jobs.ts";
import { createSessionMessageStore } from "../store/session-messages.ts";
import { createSessionUsageStore } from "../store/session-usage.ts";
import { createSqliteDatabase } from "../store/sqlite.ts";
import { createSessionMessageSync } from "./session-message-sync.ts";

const cleanup: (() => void)[] = [];
afterEach(() => {
	for (const close of cleanup.splice(0).reverse()) close();
});

function message(id: string, text = "你好"): ListedSessionMessage {
	return {
		id,
		object: "message",
		status: "completed",
		role: "user",
		type: "message",
		created_at: "2026-11-20T00:00:00.000Z",
		content: [{ type: "text", text }],
		metadata: null,
		is_error: null,
	};
}

function database() {
	const dir = mkdtempSync(join(tmpdir(), "kit-message-sync-"));
	const sqlite = openDatabase(dir);
	cleanup.push(() => {
		sqlite.close();
		rmSync(dir, { recursive: true, force: true });
	});
	const db = createSqliteDatabase(sqlite);
	return { sqlite, db };
}

async function seedSession(db: ReturnType<typeof createSqliteDatabase>, sessionId = "sess_1") {
	await db.run(
		`INSERT INTO kit_sessions (session_id, subject_id, purpose, agent_slug, created_at)
		VALUES (?, 'member_1', 'experience', 'assistant', '2026-11-20T00:00:00.000Z')`,
		sessionId,
	);
}

describe("终态消息写入", () => {
	it("同一个通知不插第二行，同一会话还在排队就并到那一行", async () => {
		const { db } = database();
		const jobs = createSessionMessageJobStore(db);
		const now = "2026-11-20T00:00:00.000Z";
		expect(
			await jobs.accept({ webhookId: "wh_1", sessionId: "sess_1", triggerType: "session.status_idled", now }),
		).toBe("inserted");
		expect(
			await jobs.accept({ webhookId: "wh_1", sessionId: "sess_1", triggerType: "session.status_terminated", now }),
		).toBe("duplicate");
		expect(
			await jobs.accept({ webhookId: "wh_2", sessionId: "sess_1", triggerType: "session.thread_idled", now }),
		).toBe("merged");
		const rows = await db.all(
			"SELECT webhook_id, status, trigger_type FROM kit_session_message_jobs ORDER BY created_at",
		);
		expect(rows).toEqual([
			{ webhook_id: "wh_1", status: "queued", trigger_type: "session.thread_idled" },
			{ webhook_id: "wh_2", status: "merged", trigger_type: "session.thread_idled" },
		]);
	});

	it("从第一页写到最后，并删掉云上已经没有的消息", async () => {
		const { db } = database();
		await seedSession(db);
		const pages = [
			{ messages: [message("evt_1"), message("evt_old")], next_page_token: null as string | null },
			{ messages: [message("evt_1", "更新后的话")], next_page_token: null },
		];
		const sync = createSessionMessageSync({
			jobs: createSessionMessageJobStore(db),
			messages: createSessionMessageStore(db),
			gateway: {
				listMessagePage: async () => pages.shift() ?? pages[0]!,
			},
			now: () => new Date("2026-11-20T00:00:00.000Z"),
		});
		await sync.accept({ webhookId: "wh_1", sessionId: "sess_1", triggerType: "session.status_idled" });
		expect(await sync.runOnce()).toBe(true);
		await sync.accept({ webhookId: "wh_2", sessionId: "sess_1", triggerType: "session.status_terminated" });
		expect(await sync.runOnce()).toBe(true);
		const rows = await db.all("SELECT event_id, content_json FROM kit_session_messages ORDER BY event_id");
		expect(rows).toEqual([{ event_id: "evt_1", content_json: JSON.stringify([{ type: "text", text: "更新后的话" }]) }]);
	});

	it("单条超限不写这一行，任务失败", async () => {
		const { db } = database();
		await seedSession(db);
		const sync = createSessionMessageSync({
			jobs: createSessionMessageJobStore(db),
			messages: createSessionMessageStore(db),
			gateway: {
				listMessagePage: async () => ({ messages: [message("evt_big", "这条太长了")], next_page_token: null }),
			},
			messageMaxBytes: 8,
		});
		await sync.accept({ webhookId: "wh_1", sessionId: "sess_1", triggerType: "session.status_idled" });
		expect(await sync.runOnce()).toBe(true);
		expect(await db.get("SELECT status, error_code FROM kit_session_message_jobs")).toEqual({
			status: "failed",
			error_code: "oversized_message",
		});
		expect(await db.get("SELECT event_id FROM kit_session_messages")).toBeUndefined();
	});

	it("云上暂时失败会延后，不是 Kit 会话则跳过", async () => {
		const { db } = database();
		const sync = createSessionMessageSync({
			jobs: createSessionMessageJobStore(db),
			messages: createSessionMessageStore(db),
			gateway: {
				listMessagePage: async () => {
					throw new KitError("provider_error", "列出会话消息失败，请稍后重试", { retryable: true });
				},
			},
			now: () => new Date("2026-11-20T00:00:00.000Z"),
		});
		await seedSession(db);
		await sync.accept({ webhookId: "wh_retry", sessionId: "sess_1", triggerType: "session.status_idled" });
		expect(await sync.runOnce()).toBe(true);
		expect(await db.get("SELECT status, attempts FROM kit_session_message_jobs WHERE webhook_id = 'wh_retry'")).toEqual(
			{
				status: "queued",
				attempts: 1,
			},
		);
		expect(await sync.runOnce()).toBe(false);
		await sync.accept({ webhookId: "wh_skip", sessionId: "sess_unknown", triggerType: "session.status_idled" });
		expect(await sync.runOnce()).toBe(true);
		expect(
			await db.get("SELECT status, error_code FROM kit_session_message_jobs WHERE webhook_id = 'wh_skip'"),
		).toEqual({
			status: "skipped",
			error_code: "not_kit_session",
		});
	});

	it("删除会话时一起删掉消息", async () => {
		const { db } = database();
		await seedSession(db);
		await db.run(
			`INSERT INTO kit_session_usage (session_id, member_id, agent_slug, created_at, finalized_at)
			VALUES ('sess_1', 'member_1', 'assistant', '2026-11-20T00:00:00.000Z', '2026-11-20T00:01:00.000Z')`,
		);
		await db.run(
			`INSERT INTO kit_session_messages
			(session_id, event_id, object, status, role, type, created_at, content_json, subject_id, purpose, stored_bytes, last_job_id, synced_at)
			VALUES ('sess_1', 'evt_1', 'message', 'completed', 'user', 'message', '2026-11-20T00:00:00.000Z', '[]', 'member_1', 'experience', 2, 'job_1', '2026-11-20T00:00:00.000Z')`,
		);
		await createSessionUsageStore(db).markDeleted("sess_1");
		expect(await db.get("SELECT session_id FROM kit_sessions")).toBeUndefined();
		expect(await db.get("SELECT event_id FROM kit_session_messages")).toBeUndefined();
	});
});
