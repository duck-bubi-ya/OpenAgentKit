import type { ProviderSessionEvent } from "@openagentpack/sdk";

/** 列出事件接口返回的一条消息。在收成 Kit SessionEvent 之前取出。 */
export interface ListedSessionMessage {
	id: string;
	object: string;
	status: string;
	role: string;
	type: string;
	created_at: string;
	content: unknown;
	metadata: unknown | null;
	is_error: boolean | null;
}

function text(value: unknown): string | undefined {
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

const STORED_TYPES = new Set(["message", "tool_use", "tool_result"]);

function keepsMessage(event: ProviderSessionEvent, object: string | undefined) {
	if (object) return object === "message";
	return STORED_TYPES.has(event.type);
}

function listedContent(event: ProviderSessionEvent, raw: Record<string, unknown>) {
	if (Array.isArray(raw.content)) return raw.content;
	return [{ type: "text", text: typeof event.content === "string" ? event.content : "" }];
}

function listedMetadata(raw: Record<string, unknown>) {
	const metadata = raw.metadata;
	if (metadata == null || typeof metadata !== "object") return null;
	return metadata;
}

/** 优先用 provider 事件上的 raw。raw 才是列出接口的那一项。会话状态帧不入库。 */
export function listedMessageFromProvider(event: ProviderSessionEvent): ListedSessionMessage | null {
	const raw = event.raw ?? {};
	const object = text(raw.object);
	if (!keepsMessage(event, object)) return null;
	const id = text(raw.id) ?? event.id;
	if (!id) return null;
	return {
		id,
		object: object ?? "message",
		status: text(raw.status) ?? "completed",
		role: text(raw.role) ?? event.role ?? "assistant",
		type: text(raw.type) ?? (event.raw_type || event.type),
		created_at: text(raw.created_at) ?? new Date(0).toISOString(),
		content: listedContent(event, raw),
		metadata: listedMetadata(raw),
		is_error: typeof raw.is_error === "boolean" ? raw.is_error : null,
	};
}
