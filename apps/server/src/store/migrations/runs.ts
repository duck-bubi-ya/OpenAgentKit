import type { DatabaseSync } from "node:sqlite";
import { run as usageLimitDaysRebuild } from "./022_usage_limit_days_rebuild.ts";
import { run as catalogAgentVersionBinding } from "./023_catalog_agent_version_binding.ts";
import { run as resourceDraftCleanupOwnership } from "./026_resource_draft_cleanup_ownership.ts";
import { run as usageLimitDaily } from "./027_usage_limit_daily.ts";
import { run as resourceDraftAssets } from "./030_resource_draft_assets.ts";
import { run as retireDirectoryDrafts } from "./031_retire_directory_drafts.ts";
import type { RunMigrationId } from "./manifest.ts";

export const migrationRuns = {
	"022_usage_limit_days_rebuild": usageLimitDaysRebuild,
	"023_catalog_agent_version_binding": catalogAgentVersionBinding,
	"026_resource_draft_cleanup_ownership": resourceDraftCleanupOwnership,
	"027_usage_limit_daily": usageLimitDaily,
	"030_resource_draft_assets": resourceDraftAssets,
	"031_retire_directory_drafts": retireDirectoryDrafts,
} satisfies Record<RunMigrationId, (db: DatabaseSync) => void>;
