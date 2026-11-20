import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { BailianCredentials } from "../config.ts";
import { redactSecrets } from "../config.ts";
import { workspaceBaseUrl } from "../gateway/bailian-rest.ts";

const CALLBACK_PATH = "/api/kit/webhooks/bailian";
const STORE_NAME = "webhook-endpoint.json";
const EVENTS = [
	"session.status_idled",
	"session.status_terminated",
	"session.thread_idled",
	"session.thread_terminated",
];

export interface WebhookSettingsView {
	publicUrl?: string;
	callbackUrl?: string;
	status: "unconfigured" | "active" | "error";
	detail?: string;
	checkedAt?: string;
}

interface StoredWebhook {
	publicUrl: string;
	url: string;
	id: string;
	signingSecret: string;
	status: "active" | "error";
	detail?: string;
	checkedAt?: string;
}

export interface EnsureWebhookOptions {
	dataDir: string;
	publicUrl: string;
	credentials: BailianCredentials;
	fetchImpl?: typeof fetch;
}

/** 把用户给的对外入口补成百炼要投递的完整回调。 */
export function webhookCallbackUrl(publicUrl: string): string {
	const base = publicUrl.trim().replace(/\/+$/, "");
	return base.endsWith(CALLBACK_PATH) ? base : `${base}${CALLBACK_PATH}`;
}

/** 百炼拒绝私网、回环、链路本地和保留地址。这里先挡掉，避免创建后立刻被禁用。 */
export function assertPublicWebhookUrl(publicUrl: string): string {
	const normalized = publicUrl.trim().replace(/\/+$/, "");
	let url: URL;
	try {
		url = new URL(normalized);
	} catch {
		throw new Error("请填写 http 或 https 地址");
	}
	if (url.protocol !== "http:" && url.protocol !== "https:") {
		throw new Error("请填写 http 或 https 地址");
	}
	if (isPrivateHost(url.hostname)) {
		throw new Error("请填写部署这台服务的公网 IP 加端口，或映射到该服务的域名。私网和本机地址不能使用");
	}
	return normalized;
}

/** 管理端读取已保存的对外入口。不返回签名密钥。 */
export function readWebhookSettings(dataDir: string): WebhookSettingsView {
	const stored = readStore(join(dataDir, STORE_NAME));
	if (!stored) return { status: "unconfigured" };
	return toView(stored);
}

/**
 * 同一回调地址复用已保存的密钥。地址变了，或上次登记失败时，向百炼新建端点。
 * 只在创建响应里拿到 signing_secret，并写入数据目录。
 */
export async function ensureWebhookSigningSecret(options: EnsureWebhookOptions): Promise<string> {
	const publicUrl = assertPublicWebhookUrl(options.publicUrl);
	const callback = webhookCallbackUrl(publicUrl);
	const file = join(options.dataDir, STORE_NAME);
	const stored = readStore(file);
	const fetchImpl = options.fetchImpl ?? fetch;
	if (stored?.url === callback && stored.status !== "error") {
		if (stored.publicUrl !== publicUrl) writeStore(file, { ...stored, publicUrl });
		return stored.signingSecret;
	}
	const created = await createEndpoint(options.credentials, callback, fetchImpl);
	writeStore(file, {
		publicUrl,
		url: callback,
		id: created.id,
		signingSecret: created.signingSecret,
		status: "active",
	});
	if (stored && stored.id !== created.id) {
		await deleteEndpoint(options.credentials, stored.id, fetchImpl).catch(() => undefined);
	}
	return created.signingSecret;
}

/** 让百炼向已登记的地址发一次测试。失败只记在本机状态里，不把密钥带回调用方。 */
export async function probeWebhookEndpoint(options: EnsureWebhookOptions): Promise<WebhookSettingsView> {
	const file = join(options.dataDir, STORE_NAME);
	const stored = readStore(file);
	if (!stored) throw new Error("尚未登记回调地址");
	const fetchImpl = options.fetchImpl ?? fetch;
	let status: StoredWebhook["status"] = "active";
	let detail = "百炼已连通";
	try {
		const response = await fetchImpl(`${workspaceBaseUrl(options.credentials)}/webhook_endpoints/${stored.id}/test`, {
			method: "POST",
			headers: { authorization: `Bearer ${options.credentials.apiKey}` },
		});
		const text = await response.text();
		if (!response.ok) {
			status = "error";
			detail = failureDetail(response.status, text);
		}
	} catch (error) {
		status = "error";
		detail = redactSecrets(error instanceof Error ? error.message : "连通失败").slice(0, 300);
	}
	const next = { ...stored, status, detail, checkedAt: new Date().toISOString() };
	writeStore(file, next);
	return toView(next);
}

function toView(stored: StoredWebhook): WebhookSettingsView {
	return {
		publicUrl: stored.publicUrl,
		callbackUrl: stored.url,
		status: stored.status,
		...(stored.detail ? { detail: stored.detail } : {}),
		...(stored.checkedAt ? { checkedAt: stored.checkedAt } : {}),
	};
}

function readStore(file: string): StoredWebhook | undefined {
	try {
		const parsed = JSON.parse(readFileSync(file, "utf8")) as Partial<StoredWebhook>;
		if (!parsed.url || !parsed.id || !parsed.signingSecret?.startsWith("whsec_")) return undefined;
		return {
			publicUrl: parsed.publicUrl || publicUrlFromCallback(parsed.url),
			url: parsed.url,
			id: parsed.id,
			signingSecret: parsed.signingSecret,
			status: parsed.status === "error" ? "error" : "active",
			...(parsed.detail ? { detail: parsed.detail } : {}),
			...(parsed.checkedAt ? { checkedAt: parsed.checkedAt } : {}),
		};
	} catch {
		return undefined;
	}
}

function writeStore(file: string, stored: StoredWebhook): void {
	mkdirSync(join(file, ".."), { recursive: true });
	writeFileSync(file, JSON.stringify(stored), { mode: 0o600 });
}

function publicUrlFromCallback(callback: string): string {
	return callback.endsWith(CALLBACK_PATH) ? callback.slice(0, -CALLBACK_PATH.length) : callback;
}

async function createEndpoint(credentials: BailianCredentials, callback: string, fetchImpl: typeof fetch) {
	const response = await fetchImpl(`${workspaceBaseUrl(credentials)}/webhook_endpoints`, {
		method: "POST",
		headers: {
			authorization: `Bearer ${credentials.apiKey}`,
			"content-type": "application/json",
		},
		body: JSON.stringify({
			description: "Kit 终态消息副本",
			url: callback,
			events: EVENTS,
		}),
	});
	const text = await response.text();
	if (!response.ok) {
		throw new Error(`创建 Webhook 失败：HTTP ${response.status} ${redactSecrets(text.slice(0, 300))}`);
	}
	let body: { id?: unknown; signing_secret?: unknown };
	try {
		body = JSON.parse(text) as { id?: unknown; signing_secret?: unknown };
	} catch {
		throw new Error("创建 Webhook 的响应无法解析");
	}
	const id = typeof body.id === "string" ? body.id : "";
	const signingSecret = typeof body.signing_secret === "string" ? body.signing_secret : "";
	if (!id || !signingSecret.startsWith("whsec_")) throw new Error("创建 Webhook 的响应缺少签名密钥");
	return { id, signingSecret };
}

async function deleteEndpoint(credentials: BailianCredentials, id: string, fetchImpl: typeof fetch) {
	await fetchImpl(`${workspaceBaseUrl(credentials)}/webhook_endpoints/${id}`, {
		method: "DELETE",
		headers: { authorization: `Bearer ${credentials.apiKey}` },
	});
}

function failureDetail(status: number, text: string): string {
	try {
		const body = JSON.parse(text) as { error?: { message?: unknown } };
		if (typeof body.error?.message === "string" && body.error.message) {
			return redactSecrets(body.error.message).slice(0, 300);
		}
	} catch {
		/* 用状态码说明。 */
	}
	return `连通失败：HTTP ${status}`;
}

function isPrivateHost(hostname: string): boolean {
	const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
	if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return true;
	if (host === "::1" || host.startsWith("fe80:") || host.startsWith("fc") || host.startsWith("fd")) return true;
	const match = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(host);
	if (!match) return false;
	const a = Number(match[1]);
	const b = Number(match[2]);
	if (a === 0 || a === 10 || a === 127) return true;
	if (a === 169 && b === 254) return true;
	if (a === 172 && b >= 16 && b <= 31) return true;
	return a === 192 && b === 168;
}
