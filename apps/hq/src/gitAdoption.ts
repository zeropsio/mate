/** First-attachment review only; delivery refusal never calls adoption as recovery. */
import type { AdoptionPreview, Repo } from "@t3tools/hq-git";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import { GitHost, holdingRepo } from "./gitHost.ts";
import { recordedBeyondMain } from "./reconcile.ts";
import { Remotes } from "./repoRemotes.ts";
import { can } from "./permissions.ts";
import { Roles, decidedFresh } from "./roles.ts";

export class AdoptionRefused extends Schema.TaggedError<AdoptionRefused>()("AdoptionRefused", {
  reason: Schema.Literals(["not_app_developer", "already_attached"]),
}) {
  override get message() {
    return this.reason === "already_attached"
      ? "Adoption is only available before attaching the git environment."
      : "Only an application developer can adopt remote history.";
  }
}
export interface GitAdoptionPreview extends AdoptionPreview {
  readonly repo: Repo;
  readonly branch: string;
  readonly url: string;
  readonly keptAt: string | null;
}
const allowed = (userId: string, repo: Repo, branch: string) =>
  decidedFresh(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const roles = yield* Roles;
      const projects = yield* sql<{
        readonly project_id: string;
      }>`SELECT project_id FROM hq_app_project WHERE app_id::text=${repo.appId}`;
      const verdict = can(
        { kind: "person", userId },
        "merge_change",
        { projectIds: projects.map((row) => row.project_id) },
        yield* roles.forWrite,
      );
      if (!verdict.allow) return yield* new AdoptionRefused({ reason: "not_app_developer" });
      const attached =
        yield* sql`SELECT 1 FROM hq_environment WHERE app_id::text=${repo.appId} AND target='git' AND branch=${branch}`;
      if (attached.length > 0) return yield* new AdoptionRefused({ reason: "already_attached" });
    }),
  );

export const previewAdoption = (userId: string, repo: Repo, branch: string) =>
  holdingRepo(
    repo,
    Effect.gen(function* () {
      yield* allowed(userId, repo, branch);
      const git = yield* (yield* GitHost).git;
      const { remote, token } = yield* (yield* Remotes).forUse(
        { appId: repo.appId, repo: repo.id },
        branch,
      );
      const preview = yield* git.previewAdoption(repo, { url: remote.url, token, branch });
      return {
        ...preview,
        repo,
        branch,
        url: remote.url,
        keptAt: remote.keptAt,
      } satisfies GitAdoptionPreview;
    }),
  );

/** Reconfirmation is explicit. A stale review never moves main or silently refreshes itself. */
export const acceptAdoption = (userId: string, preview: GitAdoptionPreview) =>
  holdingRepo(
    preview.repo,
    Effect.gen(function* () {
      yield* allowed(userId, preview.repo, preview.branch);
      const git = yield* (yield* GitHost).git;
      const { remote, token } = yield* (yield* Remotes).forUse(
        { appId: preview.repo.appId, repo: preview.repo.id },
        preview.branch,
      );
      if (remote.url !== preview.url || remote.keptAt !== preview.keptAt)
        return { kind: "stale" } as const;
      return yield* git.acceptAdoption(
        preview.repo,
        { url: remote.url, token, branch: preview.branch },
        preview,
        { name: "HQ", email: "hq@hq.invalid" },
        preview.seed &&
          (yield* recordedBeyondMain(yield* SqlClient.SqlClient, preview.repo, preview.main)),
      );
    }),
  );
