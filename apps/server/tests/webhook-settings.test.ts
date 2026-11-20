import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";
import { createKitServices } from "../src/services/index.ts";
import { openDatabase } from "../src/store/db.ts";

const cleanup: (() => void)[] = [];
afterEach(() => {
	vi.unstubAllGlobals();
	for (const close of cleanup.splice(0).reverse()) close();
});

const adminToken = "webhook-settings-admin";
const auditorToken = "webhook-settings-auditor";
const adminHeaders = { authorization: `Bearer ${adminToken}`, "content-type": "application/json" };
const auditorHeaders = { authorization: `Bearer ${auditorToken}`, "content-type": "application/json" };

function setup(withBailian = false) {
	const dataDir = mkdtempSync(join(tmpdir(), "kit-webhook-settings-"));
	cleanup.push(() => rmSync(dataDir, { recursive: true, force: true }));
	const db = openDatabase(dataDir);
	cleanup.push(() => db.close());
	const services = createKitServices(
		loadConfig({
			KIT_GATEWAY: "mock",
			KIT_DATA_DIR: dataDir,
			ADMIN_TOKEN: adminToken,
			KIT_ADMIN_TOKENS: `${auditorToken}:auditor`,
			KIT_RATE_LIMIT_RPS: "0",
			...(withBailian
				? { BAILIAN_API_KEY: "sk-test-key", BAILIAN_BASE_URL: "https://example.test/api/v1/agentstudio" }
				: {}),
		}),
		db,
	);
	return { app: createApp(services), services, db };
}

function request(
	app: ReturnType<typeof setup>["app"],
	path: string,
	init: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
) {
	return app.request(path, {
		method: init.method ?? "GET",
		headers: init.headers ?? adminHeaders,
		...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
	});
}

describe("管理端回调地址", () => {
	it("未登记时返回未配置，私网地址和缺少凭据都被拒绝", async () => {
		const { app } = setup();
		const initial = await request(app, "/api/admin/webhook");
		expect(initial.status).toBe(200);
		expect(await initial.json()).toEqual({ data: { status: "unconfigured" } });

		const privateUrl = await request(app, "/api/admin/webhook", {
			method: "PUT",
			body: { publicUrl: "http://127.0.0.1:8787" },
		});
		expect(privateUrl.status).toBe(400);

		const missing = await request(app, "/api/admin/webhook", {
			method: "PUT",
			body: { publicUrl: "https://kit.example.com" },
		});
		expect(missing.status).toBe(409);

		const readOnly = await request(app, "/api/admin/webhook", {
			method: "PUT",
			headers: auditorHeaders,
			body: { publicUrl: "https://kit.example.com" },
		});
		expect(readOnly.status).toBe(403);
	});

	it("保存公网地址后登记并测试，响应不含签名密钥", async () => {
		const { app, services, db } = setup(true);
		vi.stubGlobal(
			"fetch",
			vi.fn(async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
				const url = String(input);
				if (init?.method === "POST" && url.endsWith("/test")) return new Response("{}", { status: 200 });
				return new Response(JSON.stringify({ id: "wep_01", signing_secret: "whsec_YWI=" }), { status: 201 });
			}),
		);
		const saved = await request(app, "/api/admin/webhook", {
			method: "PUT",
			body: { publicUrl: "https://kit.example.com/" },
		});
		const text = await saved.text();
		expect(saved.status).toBe(200);
		expect(text).not.toContain("whsec_");
		expect(text).not.toContain("sk-test-key");
		expect(JSON.parse(text)).toMatchObject({
			data: {
				publicUrl: "https://kit.example.com",
				callbackUrl: "https://kit.example.com/api/kit/webhooks/bailian",
				status: "active",
				detail: "百炼已连通",
			},
		});
		expect(services.config.sessionMessageSync).toBe(true);
		const row = db.prepare("SELECT action, target FROM kit_audit WHERE action = 'webhook.update'").get() as {
			action: string;
			target: string;
		};
		expect(row).toEqual({ action: "webhook.update", target: "webhook" });
	});
});
