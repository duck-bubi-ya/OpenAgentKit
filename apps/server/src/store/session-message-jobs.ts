import { randomUUID } from "node:crypto";
import type { StoreDatabase } from "./database.ts";

export interface SessionMessageJob {
	job_id: string;
	webhook_id: string;
	session_id: string;
	trigger_type: string;
	status: string;
	attempts: number;
	available_at: string;
	lease_until: string | null;
	generation: number;
	merged_into_job_id: string | null;
	page_token: string | null;
	pages_written: number;
	stored_bytes: number;
	error_code: string | null;
	created_at: string;
	updated_at: string;
}

export interface SessionMessageTarget {
	subject_id: string;
	purpose: "experience" | "admin_debug";
}

const COLUMNS = `job_id, webhook_id, session_id, trigger_type, status, attempts, available_at, lease_until,
	generation, merged_into_job_id, page_token, pages_written, stored_bytes, error_code, created_at, updated_at`;

export function createSessionMessageJobStore(db: StoreDatabase) {
	async function queuedJob(sessionId: string) {
		return (await db.get(
			`SELECT job_id FROM kit_session_message_jobs
			WHERE session_id = ? AND status = 'queued' AND merged_into_job_id IS NULL
			ORDER BY created_at ASC LIMIT 1`,
			sessionId,
		)) as { job_id: string } | undefined;
	}

	return {
		async accept(input: { webhookId: string; sessionId: string; triggerType: string; now: string }) {
			return db.transaction(async () => {
				const existing = await db.get(
					"SELECT job_id FROM kit_session_message_jobs WHERE webhook_id = ?",
					input.webhookId,
				);
				if (existing) return "duplicate" as const;
				const queued = await queuedJob(input.sessionId);
				const jobId = `job_${randomUUID()}`;
				const status = queued ? "merged" : "queued";
				await db.run(
					`INSERT INTO kit_session_message_jobs
					(${COLUMNS}) VALUES (?,?,?,?,?,0,?,NULL,0,?,NULL,0,0,NULL,?,?)`,
					jobId,
					input.webhookId,
					input.sessionId,
					input.triggerType,
					status,
					input.now,
					queued?.job_id ?? null,
					input.now,
					input.now,
				);
				if (queued) {
					await db.run(
						"UPDATE kit_session_message_jobs SET trigger_type = ?, updated_at = ? WHERE job_id = ?",
						input.triggerType,
						input.now,
						queued.job_id,
					);
					return "merged" as const;
				}
				return "inserted" as const;
			});
		},

		async recover(now: string) {
			await db.run(
				`UPDATE kit_session_message_jobs
				SET status = 'queued', lease_until = NULL, updated_at = ?
				WHERE status = 'running' AND lease_until IS NOT NULL AND lease_until <= ?`,
				now,
				now,
			);
		},

		async claim(now: string, leaseUntil: string) {
			return db.transaction(async () => {
				const row = (await db.get(
					`SELECT ${COLUMNS} FROM kit_session_message_jobs
					WHERE status = 'queued' AND available_at <= ?
					AND session_id NOT IN (
						SELECT session_id FROM kit_session_message_jobs WHERE status = 'running'
					)
					ORDER BY created_at ASC LIMIT 1`,
					now,
				)) as SessionMessageJob | undefined;
				if (!row) return null;
				const generation = (await db.get(
					"SELECT COALESCE(MAX(generation), 0) + 1 AS generation FROM kit_session_message_jobs WHERE session_id = ?",
					row.session_id,
				)) as { generation: number };
				await db.run(
					`UPDATE kit_session_message_jobs
					SET status = 'running', lease_until = ?, generation = ?, updated_at = ?
					WHERE job_id = ?`,
					leaseUntil,
					generation.generation,
					now,
					row.job_id,
				);
				return {
					...row,
					status: "running",
					lease_until: leaseUntil,
					generation: generation.generation,
					updated_at: now,
				};
			});
		},

		async target(sessionId: string): Promise<SessionMessageTarget | "missing" | "deleting"> {
			const deletion = (await db.get("SELECT stage FROM kit_session_deletions WHERE session_id = ?", sessionId)) as
				| { stage: string }
				| undefined;
			if (deletion && deletion.stage !== "deleted") return "deleting";
			const session = (await db.get("SELECT subject_id, purpose FROM kit_sessions WHERE session_id = ?", sessionId)) as
				| SessionMessageTarget
				| undefined;
			return session ?? "missing";
		},

		async savePage(
			jobId: string,
			input: { pageToken: string | null; pagesWritten: number; storedBytes: number; leaseUntil: string; now: string },
		) {
			await db.run(
				`UPDATE kit_session_message_jobs
				SET page_token = ?, pages_written = ?, stored_bytes = ?, lease_until = ?, updated_at = ?
				WHERE job_id = ?`,
				input.pageToken,
				input.pagesWritten,
				input.storedBytes,
				input.leaseUntil,
				input.now,
				jobId,
			);
		},

		async requeue(jobId: string, input: { attempts: number; availableAt: string; errorCode: string; now: string }) {
			await db.run(
				`UPDATE kit_session_message_jobs
				SET status = 'queued', attempts = ?, available_at = ?, error_code = ?, lease_until = NULL, updated_at = ?
				WHERE job_id = ?`,
				input.attempts,
				input.availableAt,
				input.errorCode,
				input.now,
				jobId,
			);
		},

		async finish(jobId: string, status: "succeeded" | "failed" | "skipped", errorCode: string | null, now: string) {
			await db.run(
				`UPDATE kit_session_message_jobs
				SET status = ?, error_code = ?, lease_until = NULL, updated_at = ?
				WHERE job_id = ?`,
				status,
				errorCode,
				now,
				jobId,
			);
		},

		async hasNewerWork(sessionId: string, jobId: string) {
			const row = await db.get(
				`SELECT job_id FROM kit_session_message_jobs
				WHERE session_id = ? AND job_id != ? AND status = 'queued' AND merged_into_job_id IS NULL
				LIMIT 1`,
				sessionId,
				jobId,
			);
			return Boolean(row);
		},
	};
}

export type SessionMessageJobStore = ReturnType<typeof createSessionMessageJobStore>;
