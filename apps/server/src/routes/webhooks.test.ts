import { createHmac, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../app.ts";
import { loadConfig } from "../config.ts";
import { createKitServices } from "../services/index.ts";
import { openDatabase } from "../store/db.ts";

const rawKey = Buffer.from("session-message-secret");
const secret = `whsec_${rawKey.toString("base64")}`;
const cleanup: (() => Promise<void> | void)[] = [];
afterEach(async () => {
	for (const close of cleanup.splice(0).reverse()) await close();
});

function sign(body: string) {
	const webhookId = `msg_${randomUUID()}`;
	const timestamp = String(Math.floor(Date.now() / 1000));
	const digest = createHmac("sha256", rawKey).update(`${webhookId}.${timestamp}.${body}`).digest("base64");
	return {
		webhookId,
		headers: {
			"content-type": "application/json",
			"webhook-id": webhookId,
			"webhook-timestamp": timestamp,
			"webhook-signature": `v1,${digest}`,
		},
	};
}

function setup(enabled: boolean) {
	const dataDir = mkdtempSync(join(tmpdir(), "kit-webhook-"));
	const sqlite = openDatabase(dataDir);
	const config = loadConfig({
		KIT_GATEWAY: "mock",
		KIT_DATA_DIR: dataDir,
		ADMIN_TOKEN: "webhook-admin",
		...(enabled ? { KIT_PUBLIC_BASE_URL: "https://kit.example.com", KIT_WEBHOOK_SIGNING_SECRET: secret } : {}),
	});
	const services = createKitServices(config, sqlite);
	cleanup.push(async () => {
		await services.close();
		rmSync(dataDir, { recursive: true, force: true });
	});
	return { app: createApp(services), sqlite, services };
}

describe("百炼回调", () => {
	it("未配置时返回 404，创建应用不会启动调度", () => {
		const { app } = setup(false);
		return expect(app.request("/api/kit/webhooks/bailian", { method: "POST", body: "{}" })).resolves.toMatchObject({
			status: 404,
		});
	});

	it("终态通知入队，删除通知只确认，签名不对拒绝", async () => {
		const { app, sqlite } = setup(true);
		const terminal = JSON.stringify({ type: "session.status_idled", data: { id: "sess_1" } });
		const signed = sign(terminal);
		const accepted = await app.request("/api/kit/webhooks/bailian", {
			method: "POST",
			headers: signed.headers,
			body: terminal,
		});
		expect(accepted.status).toBe(200);
		expect(
			sqlite.prepare("SELECT status FROM kit_session_message_jobs WHERE webhook_id = ?").get(signed.webhookId),
		).toEqual({
			status: "queued",
		});

		const deleted = JSON.stringify({ type: "session.deleted", data: { id: "sess_1" } });
		const deletedSign = sign(deleted);
		const ignored = await app.request("/api/kit/webhooks/bailian", {
			method: "POST",
			headers: deletedSign.headers,
			body: deleted,
		});
		expect(ignored.status).toBe(200);
		expect(
			sqlite.prepare("SELECT job_id FROM kit_session_message_jobs WHERE webhook_id = ?").get(deletedSign.webhookId),
		).toBeUndefined();

		const rejected = await app.request("/api/kit/webhooks/bailian", {
			method: "POST",
			headers: { ...signed.headers, "webhook-signature": "v1,bad" },
			body: terminal,
		});
		expect(rejected.status).toBe(401);

		const official = JSON.stringify({
			type: "event",
			data: { type: "session.status_idled", id: "sess_official" },
		});
		const officialSign = sign(official);
		const officialAccepted = await app.request("/api/kit/webhooks/bailian", {
			method: "POST",
			headers: officialSign.headers,
			body: official,
		});
		expect(officialAccepted.status).toBe(200);
		expect(
			sqlite
				.prepare("SELECT session_id, trigger_type FROM kit_session_message_jobs WHERE webhook_id = ?")
				.get(officialSign.webhookId),
		).toEqual({ session_id: "sess_official", trigger_type: "session.status_idled" });
	});

	it("只填回调公网地址时不拒绝启动，也不立刻打开回调", () => {
		const dataDir = mkdtempSync(join(tmpdir(), "kit-webhook-config-"));
		cleanup.push(() => rmSync(dataDir, { recursive: true, force: true }));
		expect(
			loadConfig({
				KIT_GATEWAY: "mock",
				KIT_DATA_DIR: dataDir,
				KIT_WEBHOOK_PUBLIC_URL: "https://kit.example.com",
			}).sessionMessageSync,
		).toBe(false);
	});

	it("只填签名密钥时拒绝启动", () => {
		const dataDir = mkdtempSync(join(tmpdir(), "kit-webhook-config-"));
		cleanup.push(() => rmSync(dataDir, { recursive: true, force: true }));
		expect(() =>
			loadConfig({
				KIT_GATEWAY: "mock",
				KIT_DATA_DIR: dataDir,
				KIT_WEBHOOK_SIGNING_SECRET: secret,
			}),
		).toThrow(/KIT_PUBLIC_BASE_URL/);
	});
});
