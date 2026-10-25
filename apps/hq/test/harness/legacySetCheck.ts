// @effect-diagnostics nodeBuiltinImport:off -- a set is files: its manifest, records and bundles.
/**
 * The checks the shared HQ's legacy import (zeropsio/mate-hq `apps/hq/src/legacyImport.ts`,
 * `readLegacySet` and the table check `convertLegacySet` opens with, as of 361c474d3f) runs on a
 * set before it converts a row, ported as they stand there: a set they refuse is one that import
 * refuses. Change this file only together with that one.
 *
 * @module test/harness/legacySetCheck
 */
import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

/** The last migrations of today's HQ the import takes a set at, before and after its Chief mark. */
const LEGACY_MIGRATIONS: ReadonlyArray<string> = ["0083_repo_upstream.sql", "0084_chief_mark.sql"];

/** Every table of today's HQ the import maps or deliberately drops (`LEGACY_TABLES` there). */
export const LEGACY_TABLES: ReadonlyArray<string> = [
  "hq_app",
  "hq_app_project",
  "hq_attention_seen",
  "hq_auto_update_policy",
  "hq_birth_intent",
  "hq_change",
  "hq_change_attachment",
  "hq_change_comment",
  "hq_change_mirror",
  "hq_chief",
  "hq_chief_mark",
  "hq_chief_proposal",
  "hq_deploy_job",
  "hq_deploy_token",
  "hq_discord",
  "hq_discord_allowed",
  "hq_discord_channel",
  "hq_discord_status",
  "hq_door_used",
  "hq_environment",
  "hq_gate",
  "hq_git_credential",
  "hq_git_event",
  "hq_git_target_receipt",
  "hq_github_app",
  "hq_github_app_state",
  "hq_github_installation",
  "hq_intake",
  "hq_leader",
  "hq_lifecycle_receipt",
  "hq_mate",
  "hq_mate_challenge",
  "hq_mate_credential",
  "hq_mate_health",
  "hq_mate_overview",
  "hq_migration",
  "hq_org_ai_key",
  "hq_press",
  "hq_proposal_decision",
  "hq_pull_request",
  "hq_recipe_seen",
  "hq_release",
  "hq_repo",
  "hq_repo_mirror",
  "hq_repo_remote",
  "hq_rollout",
  "hq_schedule",
  "hq_session",
  "hq_slack",
  "hq_slack_channel",
  "hq_slack_thread",
  "hq_subdomain_intent",
  "hq_task",
  "hq_task_limits",
  "hq_task_message",
  "hq_task_month_spend",
  "hq_tier_stop",
  "hq_tool",
  "hq_usage_daily",
  "hq_usage_fact",
  "hq_usage_history_daily",
  "hq_usage_history_fact",
  "hq_usage_history_origin",
  "hq_usage_history_receipt",
  "hq_usage_model_daily",
  "hq_usage_origin",
  "hq_usage_price",
  "hq_usage_price_policy",
  "hq_usage_receipt",
  "hq_usage_sender",
  "hq_usage_state",
  "hq_webhook",
];

const FileEntry = { file: Schema.String, size: Schema.Number, sha256: Schema.String };
const LegacyManifest = Schema.Struct({
  version: Schema.Literal(1),
  id: Schema.String,
  takenAt: Schema.String,
  database: Schema.Struct(FileEntry),
  repos: Schema.Array(
    Schema.Struct({
      appId: Schema.String,
      id: Schema.String,
      file: Schema.NullOr(Schema.String),
      size: Schema.Number,
      sha256: Schema.NullOr(Schema.String),
    }),
  ),
  records: Schema.Array(Schema.Struct({ table: Schema.String, rows: Schema.Number, ...FileEntry })),
});
const decodeManifest = Schema.decodeUnknownOption(Schema.fromJsonString(LegacyManifest));

/** One row as `to_jsonb` wrote it. */
export type LegacyRow = Readonly<Record<string, unknown>>;

class Refusal extends Error {}
const refuse = (reason: string): never => {
  throw new Refusal(reason);
};
const sha256 = (bytes: Uint8Array) => NodeCrypto.createHash("sha256").update(bytes).digest("hex");

/**
 * The set in `dir` as the import reads it, each table's rows; or the import's refusal, its reason.
 */
export const legacySetRefusal = async (
  dir: string,
): Promise<
  { readonly refused: string } | { readonly tables: ReadonlyMap<string, ReadonlyArray<LegacyRow>> }
> => {
  try {
    const text = await NodeFSP.readFile(NodePath.join(dir, "manifest.json"), "utf8").catch(() =>
      refuse("the set has no manifest"),
    );
    const manifest = Option.getOrElse(decodeManifest(text), () =>
      refuse("the set's manifest is not one today's HQ writes"),
    );
    const checked = async (entry: {
      readonly file: string;
      readonly size: number;
      readonly sha256: string;
    }) => {
      const bytes = await NodeFSP.readFile(NodePath.join(dir, entry.file)).catch(() =>
        refuse(`the set has no ${entry.file}`),
      );
      if (bytes.length !== entry.size || sha256(bytes) !== entry.sha256)
        refuse(`${entry.file} is not the file the set's manifest names`);
      return bytes;
    };
    await checked(manifest.database);
    for (const repo of manifest.repos) {
      if (repo.file === null || repo.sha256 === null) continue;
      if (repo.file !== `git/${repo.appId}/${repo.id}.bundle`)
        refuse(`the set names a bundle at ${repo.file}`);
      await checked({ file: repo.file, size: repo.size, sha256: repo.sha256 });
    }
    const tables = new Map<string, ReadonlyArray<LegacyRow>>();
    for (const entry of manifest.records) {
      if (!/^hq_[a-z0-9_]+$/u.test(entry.table) || entry.file !== `records/${entry.table}.jsonl`)
        refuse(`the set names records at ${entry.file}`);
      const rows = (await checked(entry))
        .toString("utf8")
        .split("\n")
        .filter((line) => line !== "")
        .map((line) => {
          try {
            const row: unknown = JSON.parse(line);
            if (typeof row === "object" && row !== null && !Array.isArray(row))
              return row as LegacyRow;
          } catch {
            // Refused below.
          }
          return refuse(`a record of ${entry.table} is no JSON object`);
        });
      if (rows.length !== entry.rows)
        refuse(`the set holds another number of records of ${entry.table} than its manifest names`);
      tables.set(entry.table, rows);
    }
    const migrations = (tables.get("hq_migration") ?? []).map((row) => String(row["name"]));
    if (!LEGACY_MIGRATIONS.includes(migrations.toSorted().at(-1) ?? ""))
      refuse(`the set is not at today's last migration, ${LEGACY_MIGRATIONS.join(" or ")}`);
    for (const table of tables.keys())
      if (!LEGACY_TABLES.includes(table)) refuse(`${table} is no table of today's HQ`);
    return { tables };
  } catch (error) {
    if (error instanceof Refusal) return { refused: error.message };
    return { refused: `the set is unreadable: ${String(error)}` };
  }
};
