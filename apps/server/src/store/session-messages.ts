import type { StoreDatabase } from "./database.ts";

export interface SessionMessageRow {
	sessionId: string;
	eventId: string;
	object: string;
	status: string;
	role: string;
	type: string;
	createdAt: string;
	isError: number | null;
	contentJson: string;
	metadataJson: string | null;
	subjectId: string;
	purpose: string;
	storedBytes: number;
	lastJobId: string;
	syncedAt: string;
}

export function createSessionMessageStore(db: StoreDatabase) {
	return {
		async sizes(sessionId: string) {
			const rows = (await db.all(
				"SELECT event_id, stored_bytes FROM kit_session_messages WHERE session_id = ?",
				sessionId,
			)) as { event_id: string; stored_bytes: number }[];
			return new Map(rows.map((row) => [row.event_id, row.stored_bytes]));
		},

		async upsert(rows: SessionMessageRow[]) {
			if (rows.length === 0) return;
			await db.transaction(async () => {
				for (const row of rows) {
					await db.upsert(
						`INSERT INTO kit_session_messages
						(session_id, event_id, object, status, role, type, created_at, is_error, content_json, metadata_json,
						subject_id, purpose, stored_bytes, last_job_id, synced_at)
						VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
						"session_id, event_id",
						`object=excluded.object, status=excluded.status, role=excluded.role, type=excluded.type,
						created_at=excluded.created_at, is_error=excluded.is_error, content_json=excluded.content_json,
						metadata_json=excluded.metadata_json, subject_id=excluded.subject_id, purpose=excluded.purpose,
						stored_bytes=excluded.stored_bytes, last_job_id=excluded.last_job_id, synced_at=excluded.synced_at`,
						row.sessionId,
						row.eventId,
						row.object,
						row.status,
						row.role,
						row.type,
						row.createdAt,
						row.isError,
						row.contentJson,
						row.metadataJson,
						row.subjectId,
						row.purpose,
						row.storedBytes,
						row.lastJobId,
						row.syncedAt,
					);
				}
			});
		},

		async deleteMissing(sessionId: string, seenIds: readonly string[]) {
			const seen = new Set(seenIds);
			const rows = (await db.all("SELECT event_id FROM kit_session_messages WHERE session_id = ?", sessionId)) as {
				event_id: string;
			}[];
			const stale = rows.map((row) => row.event_id).filter((id) => !seen.has(id));
			for (let index = 0; index < stale.length; index += 500) {
				const chunk = stale.slice(index, index + 500);
				await db.run(
					`DELETE FROM kit_session_messages WHERE session_id = ? AND event_id IN (${chunk.map(() => "?").join(",")})`,
					sessionId,
					...chunk,
				);
			}
		},
	};
}

export type SessionMessageStore = ReturnType<typeof createSessionMessageStore>;
