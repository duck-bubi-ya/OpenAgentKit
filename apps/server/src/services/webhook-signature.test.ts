import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyWebhookSignature } from "./webhook-signature.ts";

const rawKey = Buffer.from("session-message-secret");
const secret = `whsec_${rawKey.toString("base64")}`;

function sign(body: string, timestamp = "1763600000") {
	const webhookId = "msg_1";
	const digest = createHmac("sha256", rawKey).update(`${webhookId}.${timestamp}.${body}`).digest("base64");
	return { webhookId, timestamp, body, signature: `v1,${digest}` };
}

describe("百炼回调签名", () => {
	const now = 1_763_600_000_000;

	it("接受 5 分钟内的 v1 签名", () => {
		const signed = sign("{}");
		expect(verifyWebhookSignature({ secret, ...signed, now })).toBe(true);
	});

	it("多个签名里有一个正确即可", () => {
		const signed = sign("{}");
		expect(
			verifyWebhookSignature({
				secret,
				...signed,
				signature: `v1,not-the-digest ${signed.signature}`,
				now,
			}),
		).toBe(true);
	});

	it("拒绝过期时间和错误密钥", () => {
		const signed = sign("{}", "1763590000");
		expect(verifyWebhookSignature({ secret, ...signed, now })).toBe(false);
		expect(verifyWebhookSignature({ secret: "whsec_eA==", ...sign("{}"), now })).toBe(false);
		expect(verifyWebhookSignature({ secret: "plain-secret", ...sign("{}"), now })).toBe(false);
	});
});
