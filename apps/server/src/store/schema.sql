-- 当前表结构，只供阅读。启动时不执行本文件。
-- 升级顺序见 migrations/manifest.ts。改表时追加一条迁移，并同步这里。
-- _kit_migrations 由 openDatabase 自己创建，不在这里列出。

-- Catalog

CREATE TABLE catalog_agents (
	id TEXT PRIMARY KEY,
	slug TEXT NOT NULL UNIQUE,
	display_name TEXT NOT NULL,
	description TEXT,
	icon TEXT,
	opening_remarks TEXT,
	suggested_prompts TEXT NOT NULL DEFAULT '[]',
	capabilities TEXT NOT NULL DEFAULT '{}',
	theme TEXT,
	remote_agent_id TEXT NOT NULL,
	remote_agent_version INTEGER,
	visibility TEXT NOT NULL DEFAULT 'public',
	ordering INTEGER NOT NULL DEFAULT 100,
	status TEXT NOT NULL DEFAULT 'unlisted',
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL,
	category TEXT NOT NULL DEFAULT 'general',
	featured INTEGER NOT NULL DEFAULT 0,
	remote_environment_id TEXT,
	files_json TEXT NOT NULL DEFAULT '[]',
	memory_stores_json TEXT NOT NULL DEFAULT '[]',
	vault_ids_json TEXT NOT NULL DEFAULT '[]',
	agent_version INTEGER CHECK (agent_version > 0),
	listed_at TEXT
);

-- 会话、操作与审计

CREATE TABLE kit_sessions (
	session_id TEXT PRIMARY KEY,
	subject_id TEXT NOT NULL,
	purpose TEXT NOT NULL DEFAULT 'experience' CHECK (purpose IN ('experience', 'admin_debug')),
	agent_slug TEXT,
	remote_agent_id TEXT,
	project_name TEXT,
	agent_key TEXT,
	project_revision TEXT,
	source_dirty INTEGER,
	title TEXT,
	status TEXT,
	created_at TEXT NOT NULL,
	last_event_at TEXT,
	files_json TEXT,
	debug_source TEXT CHECK (debug_source IN ('project', 'template')),
	remote_environment_id TEXT,
	runtime_json TEXT,
	message_files_json TEXT,
	CHECK (
		(purpose = 'experience' AND agent_slug IS NOT NULL AND debug_source IS NULL)
		OR (
			purpose = 'admin_debug'
			AND agent_slug IS NULL
			AND remote_agent_id IS NOT NULL
			AND debug_source IS NOT NULL
			AND (
				(debug_source = 'project' AND project_name IS NOT NULL AND agent_key IS NOT NULL)
				OR (debug_source = 'template' AND project_name IS NULL AND agent_key IS NULL)
			)
		)
	)
);
CREATE INDEX idx_sessions_subject ON kit_sessions(purpose, subject_id, created_at);
CREATE INDEX idx_debug_sessions_project ON kit_sessions(purpose, subject_id, project_name, agent_key, created_at);

CREATE TABLE kit_operations (
	operation_id TEXT PRIMARY KEY,
	kind TEXT NOT NULL,
	subject TEXT,
	status TEXT NOT NULL,
	phase TEXT,
	progress REAL NOT NULL DEFAULT 0,
	log TEXT NOT NULL DEFAULT '[]',
	result TEXT,
	error TEXT,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL,
	publication_json TEXT,
	error_details_json TEXT
);

CREATE TABLE kit_audit (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	at TEXT NOT NULL,
	subject TEXT,
	action TEXT NOT NULL,
	target TEXT,
	detail TEXT
);

-- 配额

CREATE TABLE quota_policy (
	id INTEGER PRIMARY KEY CHECK (id = 1),
	monthly_credits INTEGER NOT NULL,
	updated_at TEXT,
	updated_by TEXT
);

CREATE TABLE quota_override (
	subject_id TEXT PRIMARY KEY,
	monthly_credits INTEGER NOT NULL,
	reason TEXT,
	updated_by TEXT NOT NULL,
	updated_at TEXT NOT NULL
);

CREATE TABLE quota_pack (
	id TEXT PRIMARY KEY,
	subject_id TEXT NOT NULL,
	month TEXT NOT NULL,
	credits INTEGER NOT NULL,
	reason TEXT,
	granted_by TEXT NOT NULL,
	created_at TEXT NOT NULL
);
CREATE INDEX idx_quota_pack_subject ON quota_pack(subject_id, month);

CREATE TABLE quota_request (
	id TEXT PRIMARY KEY,
	subject_id TEXT NOT NULL,
	requested_credits INTEGER NOT NULL,
	reason TEXT,
	status TEXT NOT NULL DEFAULT 'pending',
	mode TEXT,
	granted_credits INTEGER,
	review_note TEXT,
	reviewed_by TEXT,
	created_at TEXT NOT NULL,
	reviewed_at TEXT
);
CREATE INDEX idx_quota_request_subject ON quota_request(subject_id, created_at);

CREATE TABLE usage_turns (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	subject_id TEXT NOT NULL,
	agent_slug TEXT NOT NULL,
	session_id TEXT NOT NULL,
	client_message_id TEXT,
	day TEXT NOT NULL,
	month TEXT NOT NULL,
	created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_usage_turns_idempotency ON usage_turns(session_id, client_message_id) WHERE client_message_id IS NOT NULL;
CREATE INDEX idx_usage_turns_subject_month ON usage_turns(subject_id, month);
CREATE INDEX idx_usage_turns_month_agent ON usage_turns(month, agent_slug);

-- 成员、登录与上传归属

CREATE TABLE kit_members (
	member_id TEXT PRIMARY KEY,
	username TEXT NOT NULL COLLATE NOCASE UNIQUE,
	display_name TEXT NOT NULL,
	email TEXT,
	auth_type TEXT NOT NULL CHECK (auth_type = 'local'),
	status TEXT NOT NULL CHECK (status = 'active'),
	password_hash TEXT NOT NULL,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL
);
CREATE INDEX idx_members_created ON kit_members(created_at, member_id);

CREATE TABLE kit_member_sessions (
	token_hash TEXT PRIMARY KEY,
	member_id TEXT NOT NULL,
	created_at TEXT NOT NULL,
	expires_at TEXT NOT NULL
);
CREATE INDEX idx_member_sessions_member ON kit_member_sessions(member_id);
CREATE INDEX idx_member_sessions_expiry ON kit_member_sessions(expires_at);

CREATE TABLE kit_uploaded_files (
	file_id TEXT PRIMARY KEY,
	subject_id TEXT NOT NULL,
	created_at TEXT NOT NULL,
	purpose TEXT NOT NULL DEFAULT 'experience' CHECK (purpose IN ('experience', 'admin_debug'))
);
CREATE INDEX idx_uploaded_files_subject ON kit_uploaded_files(subject_id);

CREATE TABLE kit_groups (
	group_id TEXT PRIMARY KEY,
	name TEXT NOT NULL UNIQUE,
	description TEXT,
	revision INTEGER NOT NULL DEFAULT 1,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL
);
CREATE INDEX idx_groups_created ON kit_groups(created_at, group_id);

CREATE TABLE kit_group_members (
	group_id TEXT NOT NULL REFERENCES kit_groups(group_id),
	member_id TEXT NOT NULL REFERENCES kit_members(member_id),
	PRIMARY KEY (group_id, member_id)
);
CREATE INDEX idx_group_members_member ON kit_group_members(member_id, group_id);

-- 会话用量与删除阶段

CREATE TABLE kit_session_usage (
	session_id TEXT PRIMARY KEY,
	member_id TEXT NOT NULL,
	agent_slug TEXT NOT NULL,
	title TEXT,
	status TEXT,
	created_at TEXT NOT NULL,
	input_tokens INTEGER,
	output_tokens INTEGER,
	cache_read_input_tokens INTEGER,
	cache_creation_input_tokens INTEGER,
	active_seconds REAL,
	duration_seconds REAL,
	collection_status TEXT NOT NULL DEFAULT 'pending',
	captured_at TEXT,
	attempted_at TEXT,
	capture_revision INTEGER NOT NULL DEFAULT 0,
	finalized_at TEXT,
	deleted_at TEXT
);
CREATE INDEX idx_session_usage_member ON kit_session_usage(member_id, agent_slug, created_at, session_id);

CREATE TABLE kit_session_deletions (
	session_id TEXT PRIMARY KEY,
	subject_id TEXT NOT NULL,
	stage TEXT NOT NULL,
	updated_at TEXT NOT NULL
);

-- 模版

CREATE TABLE kit_templates (
	template_id TEXT PRIMARY KEY,
	name TEXT NOT NULL UNIQUE,
	remote_agent_id TEXT NOT NULL,
	remote_agent_name TEXT NOT NULL,
	config_json TEXT NOT NULL,
	created_at TEXT NOT NULL,
	version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
	updated_at TEXT NOT NULL DEFAULT ''
);
CREATE INDEX idx_templates_created ON kit_templates(created_at, template_id);

CREATE TABLE kit_template_listings (
	template_id TEXT PRIMARY KEY REFERENCES kit_templates(template_id) ON DELETE CASCADE,
	catalog_id TEXT NOT NULL UNIQUE REFERENCES catalog_agents(id) ON DELETE CASCADE
);

CREATE TABLE kit_template_versions (
	template_id TEXT NOT NULL REFERENCES kit_templates(template_id) ON DELETE CASCADE,
	version INTEGER NOT NULL CHECK (version > 0),
	config_json TEXT NOT NULL,
	created_at TEXT NOT NULL,
	PRIMARY KEY (template_id, version)
);

-- 用量限额

CREATE TABLE kit_usage_limit_policy (
	id INTEGER PRIMARY KEY CHECK (id = 1),
	monthly_tokens INTEGER,
	monthly_active_seconds REAL,
	updated_at TEXT,
	updated_by TEXT,
	daily_tokens INTEGER,
	daily_active_seconds REAL
);

CREATE TABLE kit_usage_limit_overrides (
	member_id TEXT PRIMARY KEY,
	monthly_tokens INTEGER,
	monthly_active_seconds REAL,
	updated_at TEXT NOT NULL,
	updated_by TEXT NOT NULL,
	daily_tokens INTEGER,
	daily_active_seconds REAL
);

CREATE TABLE kit_usage_limit_members (
	member_id TEXT PRIMARY KEY,
	accounting_started_at TEXT NOT NULL
);

CREATE TABLE kit_usage_limit_sessions (
	session_id TEXT PRIMARY KEY,
	member_id TEXT NOT NULL,
	input_tokens INTEGER,
	output_tokens INTEGER,
	active_seconds REAL,
	admission_month TEXT,
	captured_at TEXT
);
CREATE INDEX idx_usage_limit_sessions_member ON kit_usage_limit_sessions(member_id);

CREATE TABLE kit_usage_limit_months (
	member_id TEXT NOT NULL,
	month TEXT NOT NULL,
	tokens INTEGER NOT NULL DEFAULT 0,
	active_seconds REAL NOT NULL DEFAULT 0,
	tokens_unknown INTEGER NOT NULL DEFAULT 0,
	active_seconds_unknown INTEGER NOT NULL DEFAULT 0,
	PRIMARY KEY (member_id, month)
);

CREATE TABLE kit_usage_limit_requests (
	session_id TEXT NOT NULL,
	request_key TEXT NOT NULL,
	member_id TEXT NOT NULL,
	request_hash TEXT NOT NULL,
	status TEXT NOT NULL,
	event_ids TEXT,
	previous_status TEXT,
	created_at TEXT NOT NULL,
	PRIMARY KEY (session_id, request_key)
);
CREATE INDEX idx_usage_limit_requests_member ON kit_usage_limit_requests(member_id, status);

CREATE TABLE kit_usage_limit_days (
	member_id TEXT NOT NULL,
	day TEXT NOT NULL,
	tokens INTEGER NOT NULL DEFAULT 0,
	active_seconds REAL NOT NULL DEFAULT 0,
	PRIMARY KEY (member_id, day)
);

CREATE TABLE kit_usage_limit_agent_days (
	agent_slug TEXT NOT NULL,
	day TEXT NOT NULL,
	tokens INTEGER NOT NULL DEFAULT 0,
	active_seconds REAL NOT NULL DEFAULT 0,
	PRIMARY KEY (agent_slug, day)
);

CREATE TABLE kit_usage_limit_templates (
	template_id TEXT PRIMARY KEY REFERENCES kit_templates(template_id) ON DELETE CASCADE,
	monthly_tokens INTEGER,
	monthly_active_seconds REAL,
	updated_at TEXT NOT NULL,
	updated_by TEXT NOT NULL,
	daily_tokens INTEGER,
	daily_active_seconds REAL
);

CREATE TABLE kit_usage_limit_agent_months (
	agent_slug TEXT NOT NULL,
	month TEXT NOT NULL,
	tokens INTEGER NOT NULL DEFAULT 0,
	active_seconds REAL NOT NULL DEFAULT 0,
	tokens_unknown INTEGER NOT NULL DEFAULT 0,
	active_seconds_unknown INTEGER NOT NULL DEFAULT 0,
	PRIMARY KEY (agent_slug, month)
);

-- 资源草稿

CREATE TABLE kit_resource_drafts (
	draft_id TEXT PRIMARY KEY,
	owner TEXT NOT NULL,
	status TEXT NOT NULL CHECK (status IN ('draft','publishing','published','failed')),
	phase TEXT NOT NULL CHECK (phase IN ('editable','executing','uncertain','succeeded')),
	resources_json TEXT NOT NULL DEFAULT '[]',
	cleanup_pending INTEGER NOT NULL DEFAULT 0,
	operation_id TEXT,
	expected_revision TEXT,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL,
	cleanup_key_hash TEXT,
	engine TEXT NOT NULL DEFAULT 'directory'
);
CREATE UNIQUE INDEX idx_resource_drafts_active_owner ON kit_resource_drafts(owner) WHERE status != 'published' OR cleanup_pending = 1;

CREATE TABLE kit_resource_draft_documents (
	draft_id TEXT PRIMARY KEY REFERENCES kit_resource_drafts(draft_id) ON DELETE CASCADE,
	revision INTEGER NOT NULL DEFAULT 1,
	yaml TEXT NOT NULL,
	assets_json TEXT NOT NULL DEFAULT '[]',
	sdk_state_json TEXT NOT NULL DEFAULT '{"resources":[]}',
	proof_json TEXT
);

CREATE TABLE kit_retired_directory_drafts (
	draft_id TEXT PRIMARY KEY,
	record_json TEXT NOT NULL,
	document_json TEXT,
	retired_at TEXT NOT NULL
);

CREATE TABLE kit_preset_packs (
	preset_pack_id TEXT PRIMARY KEY,
	config_json TEXT NOT NULL,
	created_at TEXT NOT NULL
);

-- 品牌

CREATE TABLE kit_branding (
	id INTEGER PRIMARY KEY CHECK (id = 1),
	product_name TEXT NOT NULL,
	logo_url TEXT,
	updated_at TEXT NOT NULL,
	updated_by TEXT
);

CREATE TABLE kit_branding_logo (
	id INTEGER PRIMARY KEY CHECK (id = 1),
	content_type TEXT NOT NULL,
	bytes BLOB NOT NULL,
	hash TEXT NOT NULL,
	updated_at TEXT NOT NULL
);

-- 迁移种入的单行默认值。
INSERT INTO quota_policy (id, monthly_credits) VALUES (1, 200);
INSERT INTO kit_usage_limit_policy (id) VALUES (1);
INSERT INTO kit_branding (id, product_name, updated_at) VALUES (1, 'OpenAgentPack Kit', '2026-11-13T00:00:00.000Z');
