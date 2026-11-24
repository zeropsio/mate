/**
 * Renaming a project, wherever it is offered — the projects screen's row and the project's own page.
 *
 * Rename is one start at HQ (`useRenameGroup`): HQ renames the project, then each of its projects
 * in Zerops after it, as its operation, with or without this tab. The dialog says HQ's refusal of
 * the start, and then, on every device, how HQ's rename stands from its navigation
 * (`appRenameView`): each project's result while it runs, whose Continue it waits for, or the
 * projects it left, which keep their names until another start. It closes once HQ holds the new
 * name and shows no rename running or failed. Unless
 * dismissed — HQ runs on regardless.
 */
import { useAtomValue } from "@effect/atom-react";
import { hqOperationOf } from "@t3tools/client-runtime/data";
import type { CanonicalGroup } from "@t3tools/client-runtime/zerops";
import { zeropsErrorMessage } from "@t3tools/client-runtime/zerops/errors";
import { Atom } from "effect/reactivity";
import { useContext, useEffect, useRef, useState } from "react";

import { cn, randomUUID } from "~/lib/utils";
import { applicationOperationAtom, hqNavigationAtom } from "~/state/zerops";
import { useAccountOperations } from "~/zerops/accountOperations";
import { HeldInventoryContext } from "~/zerops/inventoryContext";
import { useRenameGroup } from "~/zerops/useRenameGroup";
import { useHqPersonNames } from "~/zerops/useZeropsMateOwners";
import { useZeropsInventory } from "~/zerops/ZeropsInventoryProvider";
import { writeTrouble } from "~/zerops/zeropsWrite";
import { useZeropsSession } from "~/zerops/ZeropsSessionProvider";
import { Button } from "../ui/button";
import { ZeropsOperationEnd } from "./ZeropsOperationEnd";
import { endOperationIntent } from "./ZeropsOperationEnd.logic";
import { APP_RENAME, appRenameView, renameAttemptFor } from "./ZeropsRenameProjectDialog.logic";
import { ZeropsRenameDialog } from "./ZeropsRenameDialog";

/** The application's name as HQ's navigation holds it; absent while unread. */
const applicationNameAtom = Atom.family((appId: string) =>
  Atom.make(
    (get) => get(hqNavigationAtom).structure?.apps.find((app) => app.id === appId)?.name,
  ).pipe(Atom.withLabel(`zerops:app-name:${appId}`)),
);

/** Whom a stopped rename waits for, by the member list's name of them; mounted only for one. */
function RenameWaitingWords({
  orgId,
  userId,
}: {
  readonly orgId: string;
  readonly userId: string;
}) {
  const name = useHqPersonNames(orgId)(userId);
  return `Renaming stopped: waiting for ${name ?? "the person who renamed it"}`;
}

export function ZeropsRenameProjectDialog({
  group,
  onClose,
}: {
  readonly group: Pick<CanonicalGroup, "groupId" | "name" | "nameSource">;
  readonly onClose: () => void;
}) {
  const rename = useRenameGroup();
  const operations = useAccountOperations();
  const { activeOrganization } = useZeropsSession();
  const inventory = useZeropsInventory();
  // Every project the account holds, one the grant withholds included: it is a member still.
  const held = useContext(HeldInventoryContext);
  const projects = held?.projects ?? inventory.projects;
  const operation = useAtomValue(applicationOperationAtom(group.groupId));
  const standing = hqOperationOf(operation, APP_RENAME);
  const hqName = useAtomValue(applicationNameAtom(group.groupId));
  const view = appRenameView(
    standing,
    operation,
    (projectId) => projects.find((project) => project.id === projectId)?.name,
  );
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const close = () => {
    if (!active.current) return;
    active.current = false;
    onClose();
  };
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Reuse the id only for the same press, including another try after a lost answer.
  const start = useRef<ReturnType<typeof renameAttemptFor> | null>(null);
  // The name HQ took from this dialog: it closes once HQ holds it and shows nothing running.
  const [taken, setTaken] = useState<string | null>(null);
  useEffect(() => {
    if (taken !== null && hqName === taken && standing.kind === "none") close();
  }, [taken, hqName, standing.kind]);
  const settle = (press: Promise<void>, after?: () => void) => {
    setPending(true);
    setError(null);
    press.then(
      () => {
        if (!active.current) return;
        setPending(false);
        after?.();
      },
      (cause: unknown) => {
        if (!active.current) return;
        setPending(false);
        setError(zeropsErrorMessage(cause));
      },
    );
  };
  const orgId = activeOrganization?.id;
  const running = standing.kind === "going" || standing.kind === "waiting";
  const end = endOperationIntent(standing, orgId, group.groupId);
  const beginRename = (name: string) => {
    const after = standing.kind === "failed" ? operation?.id : undefined;
    start.current = renameAttemptFor(start.current, name, after, randomUUID);
    settle(rename(group.groupId, name, start.current.id), () => setTaken(name));
  };

  return (
    <ZeropsRenameDialog
      description="Mate shows the new name, and HQ renames its projects in Zerops to match."
      error={error}
      // An unread name's id is a handle, not a name to edit.
      initialValue={group.nameSource === "unread" ? "" : group.name}
      label="Project name"
      onCancel={close}
      onOpenChange={(open) => {
        if (!open) close();
      }}
      onSubmit={beginRename}
      open
      pending={pending || running}
      // While HQ renames, the name is HQ's: it is not asked again until it ends.
      readOnly={running}
      reportOnly={!view.mayRename}
      submitLabel="Rename"
      title="Rename the project"
      validate={(value) => (value.trim().length === 0 ? "Give the project a name." : undefined)}
    >
      {view.line === undefined && standing.kind !== "waiting" ? null : (
        <div className="mt-3 space-y-1 text-line" data-zerops-surface="rename-progress">
          {standing.kind === "waiting" ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <span className="me-auto">
                {standing.yours || orgId === undefined ? (
                  `Renaming stopped: ${standing.why}`
                ) : (
                  <RenameWaitingWords orgId={orgId} userId={standing.continueBy} />
                )}
              </span>
              {standing.yours && orgId !== undefined ? (
                <Button
                  disabled={pending}
                  onClick={() =>
                    settle(
                      operations
                        .submit({
                          kind: "continue-operation",
                          orgId,
                          id: standing.id,
                          appId: group.groupId,
                        })
                        .then(({ progress, evidence }) => {
                          const trouble = writeTrouble(progress, evidence);
                          if (trouble !== null) throw new Error(trouble);
                        }),
                    )
                  }
                  size="sm"
                  type="button"
                  variant="secondary"
                >
                  {standing.press}
                </Button>
              ) : null}
              {end === undefined ? null : (
                <ZeropsOperationEnd
                  disabled={pending}
                  kind={APP_RENAME}
                  name={hqName ?? group.name}
                  onEnd={() =>
                    settle(
                      operations.submit(end).then(({ progress, evidence }) => {
                        const trouble = writeTrouble(progress, evidence);
                        if (trouble !== null) throw new Error(trouble);
                      }),
                    )
                  }
                />
              )}
            </div>
          ) : view.line === undefined ? null : (
            <p
              className={view.line.failed ? "text-status-failed-text" : "text-muted-foreground"}
              role="status"
            >
              {view.line.words}
            </p>
          )}
          {view.projects.length === 0 ? null : (
            <ul className="space-y-0.5">
              {view.projects.map((project) => (
                <li
                  className={cn(
                    "truncate",
                    project.failed ? "text-status-failed-text" : "text-muted-foreground",
                  )}
                  key={project.projectId}
                >
                  {project.words}
                </li>
              ))}
            </ul>
          )}
          {standing.kind === "failed" ? (
            <Button
              disabled={pending || hqName === undefined}
              onClick={() => {
                if (hqName !== undefined) beginRename(hqName);
              }}
              size="sm"
              type="button"
              variant="secondary"
            >
              Rename again
            </Button>
          ) : null}
        </div>
      )}
    </ZeropsRenameDialog>
  );
}
