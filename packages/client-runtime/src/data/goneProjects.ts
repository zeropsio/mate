/**
 * A project HQ still places — a Mate, a stage or a production — that the person's own read proved
 * gone on Zerops (`400 projectNotFound`: its `project` fact deleted, never a stream frame alone) is
 * told to HQ, once a session, with the person's token: by its preparer's own receipt
 * (`complete-mate-deletion`), else by an organization owner or admin
 * (`complete-project-deletion`, `finishDeletionPermission`). Anyone else tells HQ nothing, and the
 * row stays drawn gone on Zerops while HQ holds it. Only HQ's drop of its placement clears it.
 *
 * @module data/goneProjects
 */
import { finishDeletionPermission } from "@t3tools/shared/zeropsPermissions";

import { placementsScope } from "./families/hqNavigation.ts";
import type { IntentOf } from "./operations/kind.ts";
import { lifecycleRemainders } from "./projections/lifecycleRemainders.ts";
import { livePermissionFacts } from "./projections/permissionFacts.ts";
import { readsOfState, type AccountStore, type ProjectionReads } from "./store.ts";

export interface GoneProjectFinish {
  readonly requestId: string;
  readonly intent: IntentOf<"complete-mate-deletion"> | IntentOf<"complete-project-deletion">;
}

interface GoneProjectsKey {
  readonly orgId: string;
  readonly hqProjectId: string;
}

/** The finishes still to tell HQ: none for a project this session has told it of already. */
export function goneProjectFinishes(
  read: ProjectionReads,
  key: GoneProjectsKey,
): ReadonlyArray<GoneProjectFinish> {
  const prepared = new Map(
    lifecycleRemainders
      .derive(read, key)
      .deletions.map((record) => [record.intent.projectId, record] as const),
  );
  const facts = livePermissionFacts(read, key.orgId);
  const target = { orgId: key.orgId, hqProjectId: key.hqProjectId };
  const finishes: GoneProjectFinish[] = [];
  for (const projectId of read.members(placementsScope(key.orgId)).ids) {
    if (read.fact("project", projectId).kind !== "deleted") continue;
    const record = prepared.get(projectId);
    const finish: GoneProjectFinish | undefined =
      record?.intent.kind === "prepare-mate-deletion" && record.result !== undefined
        ? {
            requestId: `${record.requestId}:complete`,
            intent: {
              kind: "complete-mate-deletion",
              ...target,
              projectId,
              preparedRequestId: record.requestId,
              completion: record.result.completion,
            },
          }
        : facts !== undefined && finishDeletionPermission(facts, projectId).allow
          ? {
              requestId: `${projectId}:deleted`,
              intent: { kind: "complete-project-deletion", ...target, projectId },
            }
          : undefined;
    if (finish !== undefined && read.operation(finish.requestId) === undefined)
      finishes.push(finish);
  }
  return finishes;
}

/** Submits each gone project's finish once, as the store proves it; the result stops. */
export function finishGoneProjects(
  options: GoneProjectsKey & {
    readonly store: AccountStore;
    readonly submit: (finish: GoneProjectFinish) => void;
  },
): () => void {
  // Asked already, before its submission is recorded in the store.
  const asked = new Set<string>();
  const pass = () => {
    for (const finish of goneProjectFinishes(readsOfState(options.store.state()), options)) {
      if (asked.has(finish.requestId)) continue;
      asked.add(finish.requestId);
      options.submit(finish);
    }
  };
  const stop = options.store.subscribe(pass);
  pass();
  return stop;
}
