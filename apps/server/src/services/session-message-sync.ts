import { KitError } from "@openagentkit/sdk/protocol";
import type { ListedSessionMessage } from "../gateway/session-messages.ts";
import type { ProviderGateway } from "../gateway/types.ts";
import type { SessionMessageJob, SessionMessageJobStore, SessionMessageTarget } from "../store/session-message-jobs.ts";
import type { SessionMessageRow, SessionMessageStore } from "../store/session-messages.ts";

const PAGE_LIMIT = 100;
const MAX_ATTEMPTS = 4;
const BACKOFF_MS = [10_000, 30_000, 60_000];
const MESSAGE_MAX_BYTES = 256 * 1024;
const SESSION_MAX_BYTES = 8 * 1024 * 1024;

export interface SessionMessageSyncOptions {
	jobs: SessionMessageJobStore;
	messages: SessionMessageStore;
	gateway: Pick<ProviderGateway, "listMessagePage">;
	leaseMs?: number;
	messageMaxBytes?: number;
	sessionMaxBytes?: number;
	now?: () => Date;
}

interface SyncContext {
	jobs: SessionMessageJobStore;
	messages: SessionMessageStore;
	gateway: Pick<ProviderGateway, "listMessagePage">;
	leaseMs: number;
	messageMaxBytes: number;
	sessionMaxBytes: number;
	now: () => Date;
}

interface PageCursor {
	token: string | null;
	pages: number;
	written: number;
	seen: string[];
	known: Map<string, number>;
	existing: number;
}

type MessagePage = { messages: ListedSessionMessage[]; next_page_token: string | null };

function bytesOf(message: ListedSessionMessage) {
	const content = JSON.stringify(message.content);
	const metadata = message.metadata == null ? "" : JSON.stringify(message.metadata);
	return Buffer.byteLength(content) + Buffer.byteLength(metadata);
}

function plus(now: Date, ms: number) {
	return new Date(now.getTime() + ms).toISOString();
}

function skipCode(target: "missing" | "deleting") {
	return target === "missing" ? "not_kit_session" : "deletion_in_progress";
}

function limitCode(messageBytes: number, messageMaxBytes: number) {
	return messageBytes > messageMaxBytes ? "oversized_message" : "oversized_session";
}

async function retry(ctx: SyncContext, job: SessionMessageJob, errorCode: string) {
	const attempts = job.attempts + 1;
	const at = ctx.now();
	if (attempts >= MAX_ATTEMPTS) {
		await ctx.jobs.finish(job.job_id, "failed", errorCode, at.toISOString());
		return;
	}
	const delay = BACKOFF_MS[Math.min(attempts - 1, BACKOFF_MS.length - 1)] ?? 60_000;
	await ctx.jobs.requeue(job.job_id, {
		attempts,
		availableAt: plus(at, delay),
		errorCode,
		now: at.toISOString(),
	});
}

async function readPage(ctx: SyncContext, job: SessionMessageJob, token: string | null): Promise<MessagePage | null> {
	try {
		return await ctx.gateway.listMessagePage(job.session_id, {
			...(token ? { pageToken: token } : {}),
			limit: PAGE_LIMIT,
		});
	} catch (error) {
		const retryable = error instanceof KitError ? error.retryable : true;
		await (retryable
			? retry(ctx, job, "provider_error")
			: ctx.jobs.finish(job.job_id, "failed", "provider_error", ctx.now().toISOString()));
		return null;
	}
}

function messageRow(
	message: ListedSessionMessage,
	job: SessionMessageJob,
	target: SessionMessageTarget,
	size: number,
	syncedAt: string,
): SessionMessageRow {
	return {
		sessionId: job.session_id,
		eventId: message.id,
		object: message.object,
		status: message.status,
		role: message.role,
		type: message.type,
		createdAt: message.created_at,
		isError: message.is_error == null ? null : Number(message.is_error),
		contentJson: JSON.stringify(message.content),
		metadataJson: message.metadata == null ? null : JSON.stringify(message.metadata),
		subjectId: target.subject_id,
		purpose: target.purpose,
		storedBytes: size,
		lastJobId: job.job_id,
		syncedAt,
	};
}

async function collectPage(
	ctx: SyncContext,
	job: SessionMessageJob,
	target: SessionMessageTarget,
	page: MessagePage,
	cursor: PageCursor,
) {
	const batch: SessionMessageRow[] = [];
	for (const message of page.messages) {
		const size = bytesOf(message);
		const previous = cursor.known.get(message.id) ?? 0;
		if (size > ctx.messageMaxBytes || cursor.existing - previous + size > ctx.sessionMaxBytes) {
			if (batch.length > 0) await ctx.messages.upsert(batch);
			await ctx.jobs.finish(job.job_id, "failed", limitCode(size, ctx.messageMaxBytes), ctx.now().toISOString());
			return null;
		}
		batch.push(messageRow(message, job, target, size, ctx.now().toISOString()));
		cursor.existing = cursor.existing - previous + size;
		cursor.known.set(message.id, size);
		cursor.seen.push(message.id);
	}
	return batch;
}

async function writeOnePage(
	ctx: SyncContext,
	job: SessionMessageJob,
	target: SessionMessageTarget,
	cursor: PageCursor,
) {
	const page = await readPage(ctx, job, cursor.token);
	if (!page) return "failed" as const;
	if (cursor.token && page.next_page_token === cursor.token) {
		await ctx.jobs.finish(job.job_id, "failed", "cursor_repeat", ctx.now().toISOString());
		return "failed" as const;
	}
	const batch = await collectPage(ctx, job, target, page, cursor);
	if (!batch) return "failed" as const;
	if (batch.length > 0) await ctx.messages.upsert(batch);
	cursor.pages += 1;
	cursor.written += batch.reduce((sum, row) => sum + row.storedBytes, 0);
	const at = ctx.now();
	await ctx.jobs.savePage(job.job_id, {
		pageToken: page.next_page_token,
		pagesWritten: cursor.pages,
		storedBytes: cursor.written,
		leaseUntil: plus(at, ctx.leaseMs),
		now: at.toISOString(),
	});
	cursor.token = page.next_page_token;
	return page.next_page_token ? ("continue" as const) : ("done" as const);
}

async function finishJob(ctx: SyncContext, job: SessionMessageJob, seen: readonly string[]) {
	const at = ctx.now().toISOString();
	if (await ctx.jobs.hasNewerWork(job.session_id, job.job_id)) {
		await ctx.jobs.finish(job.job_id, "skipped", "superseded", at);
		return;
	}
	if (job.page_token == null) await ctx.messages.deleteMissing(job.session_id, seen);
	await ctx.jobs.finish(job.job_id, "succeeded", null, at);
}

async function runJob(ctx: SyncContext, job: SessionMessageJob) {
	const target = await ctx.jobs.target(job.session_id);
	if (target === "missing" || target === "deleting") {
		await ctx.jobs.finish(job.job_id, "skipped", skipCode(target), ctx.now().toISOString());
		return;
	}
	const known = await ctx.messages.sizes(job.session_id);
	const cursor: PageCursor = {
		token: job.page_token,
		pages: job.pages_written,
		written: job.stored_bytes,
		seen: [],
		known,
		existing: [...known.values()].reduce((sum, size) => sum + size, 0),
	};
	let step: "continue" | "done" | "failed" = "continue";
	while (step === "continue") step = await writeOnePage(ctx, job, target, cursor);
	if (step === "done") await finishJob(ctx, job, cursor.seen);
}

export function createSessionMessageSync(options: SessionMessageSyncOptions) {
	const ctx: SyncContext = {
		jobs: options.jobs,
		messages: options.messages,
		gateway: options.gateway,
		leaseMs: options.leaseMs ?? 2 * 60 * 1000,
		messageMaxBytes: options.messageMaxBytes ?? MESSAGE_MAX_BYTES,
		sessionMaxBytes: options.sessionMaxBytes ?? SESSION_MAX_BYTES,
		now: () => options.now?.() ?? new Date(),
	};

	return {
		accept(input: { webhookId: string; sessionId: string; triggerType: string }) {
			return ctx.jobs.accept({ ...input, now: ctx.now().toISOString() });
		},
		recover() {
			return ctx.jobs.recover(ctx.now().toISOString());
		},
		async runOnce() {
			const at = ctx.now();
			const job = await ctx.jobs.claim(at.toISOString(), plus(at, ctx.leaseMs));
			if (!job) return false;
			await runJob(ctx, job);
			return true;
		},
	};
}

export type SessionMessageSync = ReturnType<typeof createSessionMessageSync>;
