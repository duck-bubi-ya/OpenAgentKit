import { createHmac, timingSafeEqual } from "node:crypto";

const PREFIX = "whsec_";
const TOLERANCE_MS = 5 * 60 * 1000;

export interface WebhookSignatureInput {
	secret: string;
	webhookId: string;
	timestamp: string;
	signature: string;
	body: string;
	now?: number;
}

function key(secret: string): Buffer | undefined {
	const value = secret.trim();
	if (!value.startsWith(PREFIX)) return undefined;
	const decoded = Buffer.from(value.slice(PREFIX.length), "base64");
	return decoded.length > 0 ? decoded : undefined;
}

function same(left: string, right: string): boolean {
	const a = Buffer.from(left);
	const b = Buffer.from(right);
	return a.length === b.length && timingSafeEqual(a, b);
}

/** 百炼回调签名：webhook-id、webhook-timestamp、原始 body，HMAC-SHA256。 */
export function verifyWebhookSignature(input: WebhookSignatureInput): boolean {
	const secret = key(input.secret);
	const timestamp = Number(input.timestamp);
	if (!secret || !input.webhookId || !Number.isFinite(timestamp)) return false;
	const now = input.now ?? Date.now();
	if (Math.abs(now - timestamp * 1000) > TOLERANCE_MS) return false;
	const digest = createHmac("sha256", secret)
		.update(`${input.webhookId}.${input.timestamp}.${input.body}`)
		.digest("base64");
	return input.signature.split(" ").some((part) => {
		const [version, value] = part.split(",");
		return version === "v1" && value !== undefined && same(value, digest);
	});
}
