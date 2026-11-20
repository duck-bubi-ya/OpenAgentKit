import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { BailianCredentials } from "../config.ts";
import { ensureWebhookSigningSecret, webhookCallbackUrl } from "./webhook-endpoint.ts";

const credentials: BailianCredentials = {
	apiKey: "sk-test-key",
	baseUrl: "https://example.test/api/v1/agentstudio",
};
const cleanup: string[] = [];
afterEach(() => {
	for (const dir of cleanup.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir() {
	const dir = mkdtempSync(join(tmpdir(), "kit-webhook-endpoint-"));
	cleanup.push(dir);
	return dir;
}

describe("终态回调端点", () => {
	it("把公网源地址补成回调路径", () => {
		expect(webhookCallbackUrl("https://kit.example.com/")).toBe("https://kit.example.com/api/kit/webhooks/bailian");
		expect(webhookCallbackUrl("https://kit.example.com/api/kit/webhooks/bailian")).toBe(
			"https://kit.example.com/api/kit/webhooks/bailian",
		);
	});

	it("拒绝本机和私网地址，且不请求百炼", async () => {
		const fetchImpl = () => Promise.reject(new Error("should not fetch"));
		await expect(
			ensureWebhookSigningSecret({
				dataDir: tempDir(),
				publicUrl: "http://127.0.0.1:8787",
				credentials,
				fetchImpl,
			}),
		).rejects.toThrow(/公网/);
	});

	it("创建一次并复用保存的签名密钥", async () => {
		const dataDir = tempDir();
		const posts: string[] = [];
		const fetchImpl = (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
			posts.push(`${init?.method ?? "GET"} ${String(input)}`);
			expect(String(init?.body)).not.toContain(credentials.apiKey);
			return Promise.resolve(
				new Response(
					JSON.stringify({
						id: "wep_01",
						signing_secret: "whsec_YWI=",
						url: "https://kit.example.com/api/kit/webhooks/bailian",
					}),
					{ status: 200 },
				),
			);
		};
		const first = await ensureWebhookSigningSecret({
			dataDir,
			publicUrl: "https://kit.example.com",
			credentials,
			fetchImpl,
		});
		const second = await ensureWebhookSigningSecret({
			dataDir,
			publicUrl: "https://kit.example.com",
			credentials,
			fetchImpl,
		});
		expect(first).toBe("whsec_YWI=");
		expect(second).toBe(first);
		expect(posts).toEqual(["POST https://example.test/api/v1/agentstudio/webhook_endpoints"]);
	});

	it("地址变化时删除旧端点并新建", async () => {
		const dataDir = tempDir();
		const methods: string[] = [];
		let created = 0;
		const fetchImpl = (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
			methods.push(`${init?.method ?? "GET"} ${String(input)}`);
			if ((init?.method ?? "GET") === "DELETE") return Promise.resolve(new Response("{}", { status: 200 }));
			created += 1;
			return Promise.resolve(
				new Response(JSON.stringify({ id: `wep_0${created}`, signing_secret: "whsec_YWI=" }), { status: 201 }),
			);
		};
		await ensureWebhookSigningSecret({ dataDir, publicUrl: "https://kit.example.com", credentials, fetchImpl });
		await ensureWebhookSigningSecret({ dataDir, publicUrl: "https://other.example.com", credentials, fetchImpl });
		expect(methods.map((line) => line.split(" ")[0])).toEqual(["POST", "POST", "DELETE"]);
	});
});
