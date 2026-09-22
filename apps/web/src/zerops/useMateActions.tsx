/**
 * What can be done to a Mate, from wherever a Mate is listed.
 *
 * Seven verbs — *Start*, *Restart*, *Rename Mate*, *Register in …*, *Hand this
 * Mate over*, *Change project or role*, *Leave the project* — and the server's
 * version under them. Every one lived inside the projects screen's own row
 * menu, wired to that page's state, so a project's own page listed its Mates
 * and could do nothing to any of them.
 *
 * None of them needs that page. They need the active organization, the
 * runtime's commands, the account's registry and the org's member list — all
 * context, all reachable from any surface. So they live here, once, in the
 * same shape as `useRenameGroup` and `useEnableRoute`: the writes, the busy
 * key, the trouble, the menu entries, and the dialogs the caller mounts.
 *
 * What is deliberately **not** here: *Open*, *Set up a Mate*, *Enable* and
 * *Remove*. Those are about connecting a container and provisioning a project
 * — the projects screen's own job, and its own state. A Mate's page opens a
 * Mate by being its conversation.
 */
import {
  buildZeropsGroupTree,
  generateZeropsGroupId,
  rankZeropsCandidateForListing,
  readZeropsGroupTags,
  registerMateVerb,
  resolveMateRegistration,
  type ZeropsGroupTags,
} from "@t3tools/client-runtime/zerops";
import { ZeropsServiceId } from "@t3tools/client-runtime/zerops/data";
import { zeropsErrorMessage } from "@t3tools/client-runtime/zerops/errors";
import { resolveMateVerbs, resolveMateVisibility } from "@t3tools/client-runtime/zerops/mateAccess";
import { useCallback, useMemo, useState, type ReactNode } from "react";

import {
  deriveZeropsRestartAction,
  deriveZeropsRowAction,
  type ZeropsRowInput,
} from "../components/zerops/ZeropsProjectRow.logic";
import type { ZeropsMenuEntry } from "../components/zerops/ZeropsProjectMenu";
import { ZeropsAssignMateDialog } from "../components/zerops/ZeropsAssignMateDialog";
import { ZeropsMoveToGroupDialog } from "../components/zerops/ZeropsMoveToGroupDialog";
import { ZeropsRenameDialog } from "../components/zerops/ZeropsRenameDialog";
import { validateBotName } from "../components/zerops/ZeropsEnvironmentCreationDialog.logic";
import type { MoveMembership } from "../components/zerops/ZeropsMoveToGroupDialog.logic";
import { registerMateInGroup } from "./brokerGrant";
import { findAccountGitea } from "./giteaProject";
import { captureAccountLifetime } from "./accountLifetime";
import { useProjectOrderPreference } from "./projectOrderPreference";
import { useZeropsCandidates, type ZeropsCandidatePresentation } from "./useZeropsCandidates";
import { useZeropsInventory } from "./ZeropsInventoryProvider";
import { useZeropsOrganizationMembers } from "./useZeropsMateOwners";
import { runZeropsCommand, useZeropsData } from "./zeropsDataContext";
import { useZeropsSession } from "./ZeropsSessionProvider";

/** Which Mate a dialog is about, and which dialog it is. */
type MateDialog =
  | { readonly kind: "rename"; readonly candidate: ZeropsCandidatePresentation }
  | { readonly kind: "assign"; readonly candidate: ZeropsCandidatePresentation }
  | { readonly kind: "move"; readonly candidate: ZeropsCandidatePresentation };

export interface MateActions {
  /**
   * The menu entries for one Mate, already gated by what this person may
   * finish (`resolveMateVerbs`, guide 0.8) — a verb the platform would refuse
   * is never offered.
   */
  readonly actionsFor: (
    candidate: ZeropsCandidatePresentation,
    tags: ZeropsGroupTags,
    /** Entries the surface adds to the quick group — the update control's. */
    extraQuick?: ReadonlyArray<ZeropsMenuEntry>,
  ) => ReadonlyArray<ZeropsMenuEntry>;
  /** Mounted once by the caller: rename, hand over, move. */
  readonly dialogs: ReactNode;
  /** Which Mate has a write in flight, so its own row says so and takes no second press. */
  readonly busyKey: string | null;
  /** Why the last write failed; `null` when none did. */
  readonly trouble: string | null;
}

/**
 * The two reads a caller must already hold.
 *
 * Both are per-instance — a second `useZeropsRegistry` is a second poll of the
 * account's registry, not a shared one — so they are passed in rather than
 * taken again here. Each surface reads them once and hands them over.
 */
export interface MateActionsInput {
  readonly registry: RegistryState;
  /** `candidate.key → "0.11.25"`, from `useZeropsCandidateHealth`. */
  readonly serverVersions: ReadonlyMap<string, string>;
}

interface RegistryState {
  readonly registry: Parameters<typeof resolveMateRegistration>[0]["registry"];
  readonly refresh: () => void;
}

export function useMateActions({ registry, serverVersions }: MateActionsInput): MateActions {
  const { activeOrganization, client } = useZeropsSession();
  const { projectRef, runtime } = useZeropsData();
  const { candidates, refresh } = useZeropsCandidates();
  const inventory = useZeropsInventory();
  const [dialog, setDialog] = useState<MateDialog | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [trouble, setTrouble] = useState<string | null>(null);
  // The same preference the projects screen's sort control writes — the
  // "move to" dialog's group choices should read the way the person set up
  // their own list, not a fixed order of their own.
  const [projectOrder] = useProjectOrderPreference();

  const giteaProjectId = useMemo(
    () => findAccountGitea(inventory, activeOrganization?.id)?.projectId,
    [activeOrganization?.id, inventory],
  );
  const groupTree = useMemo(
    () =>
      buildZeropsGroupTree(candidates, {
        rank: rankZeropsCandidateForListing,
        order: projectOrder,
      }),
    [candidates, projectOrder],
  );
  const takenBotNames = useMemo(
    () =>
      candidates.flatMap((candidate) => {
        const bot = readZeropsGroupTags(candidate.project.tagList).bot;
        return bot === undefined ? [] : [bot];
      }),
    [candidates],
  );
  const viewer = useMemo(
    () =>
      activeOrganization === null
        ? null
        : {
            id: activeOrganization.id,
            membershipId: activeOrganization.membershipId,
            roleCode: activeOrganization.roleCode,
            canCreateProjects: activeOrganization.canCreateProjects,
          },
    [activeOrganization],
  );
  // The member list is read only where somebody could be handed a Mate.
  const anyAssignable = useMemo(
    () =>
      viewer !== null &&
      candidates.some(
        (candidate) => resolveMateVerbs({ project: candidate.project, viewer }).assign,
      ),
    [candidates, viewer],
  );
  const members = useZeropsOrganizationMembers({
    clientId: activeOrganization?.id,
    enabled: anyAssignable,
  });

  /** One write, with its busy key and its refusal, wherever it came from. */
  const write = useCallback(
    async (key: string, run: () => Promise<unknown>, after?: () => void) => {
      if (activeOrganization === null) return;
      const isCurrent = captureAccountLifetime();
      setBusyKey(key);
      setTrouble(null);
      try {
        await run();
        if (isCurrent()) after?.();
      } catch (cause) {
        if (isCurrent()) setTrouble(zeropsErrorMessage(cause));
      } finally {
        if (isCurrent()) setBusyKey(null);
      }
    },
    [activeOrganization],
  );

  /**
   * What the row logic needs to say whether this Mate can be started or
   * restarted. `waiting` is false here on purpose: a creation in flight is the
   * projects screen's own knowledge, and a menu is not where somebody waits.
   */
  const rowInputFor = useCallback(
    (candidate: ZeropsCandidatePresentation): ZeropsRowInput => {
      const visibility =
        viewer === null ? undefined : resolveMateVisibility({ project: candidate.project, viewer });
      const openable = visibility !== "listed";
      return {
        candidate,
        health: undefined,
        waiting: false,
        can: {
          open: openable,
          enable: openable,
          setUpMate: openable,
          start: openable,
          restart: openable,
          remove: openable,
        },
        ...(visibility === undefined ? {} : { visibility }),
      };
    },
    [viewer],
  );

  const start = useCallback(
    (candidate: ZeropsCandidatePresentation) => {
      if (activeOrganization === null) return;
      const project = projectRef(activeOrganization.id, candidate.project.id);
      const serviceId = candidate.service?.id;
      // A STOPPED project starts every service in it; a STOPPED service while
      // the project is ACTIVE starts only that service.
      const run =
        candidate.project.status === "STOPPED"
          ? () => runZeropsCommand(runtime.commands.startProject(project))
          : serviceId === undefined
            ? null
            : () =>
                runZeropsCommand(
                  runtime.commands.startService({
                    kind: "service",
                    project,
                    serviceId: ZeropsServiceId.make(serviceId),
                  }),
                );
      if (run === null) return;
      void write(candidate.key, run, refresh);
    },
    [activeOrganization, projectRef, refresh, runtime.commands, write],
  );

  const restart = useCallback(
    (candidate: ZeropsCandidatePresentation) => {
      const serviceId = candidate.service?.id;
      if (activeOrganization === null || serviceId === undefined) return;
      const project = projectRef(activeOrganization.id, candidate.project.id);
      void write(
        candidate.key,
        () =>
          runZeropsCommand(
            runtime.commands.restartService({
              kind: "service",
              project,
              serviceId: ZeropsServiceId.make(serviceId),
            }),
          ),
        refresh,
      );
    },
    [activeOrganization, projectRef, refresh, runtime.commands, write],
  );

  const rename = useCallback(
    (candidate: ZeropsCandidatePresentation, name: string) => {
      if (activeOrganization === null) return;
      void write(candidate.key, () =>
        runZeropsCommand(
          runtime.commands.nameProjectAgent(
            projectRef(activeOrganization.id, candidate.project.id),
            name,
          ),
        ),
      );
    },
    [activeOrganization, projectRef, runtime.commands, write],
  );

  /**
   * Hands a Mate over (guide 0.8, D11): a per-project role override to OWNER
   * for the person picked. The one write in the app that carries `userRoles`.
   */
  const assign = useCallback(
    (candidate: ZeropsCandidatePresentation, clientUserId: string) => {
      if (activeOrganization === null) return;
      void write(candidate.key, () =>
        runZeropsCommand(
          runtime.commands.setProjectMemberRole(
            projectRef(activeOrganization.id, candidate.project.id),
            { clientUserId, roleCode: "OWNER" },
          ),
        ),
      );
    },
    [activeOrganization, projectRef, runtime.commands, write],
  );

  const move = useCallback(
    (candidate: ZeropsCandidatePresentation, membership: MoveMembership) => {
      if (activeOrganization === null) return;
      const project = projectRef(activeOrganization.id, candidate.project.id);
      void write(candidate.key, () => {
        if (membership.kind === "none") {
          return runZeropsCommand(runtime.commands.updateProjectGroupTags(project, {}));
        }
        // Joining an existing group carries its name along, so the mirror on
        // this member agrees with the others'.
        const known = groupTree.groups.find(
          (entry) => entry.group.groupId === membership.groupId,
        )?.group;
        const label = membership.label ?? known?.name;
        return runZeropsCommand(
          runtime.commands.updateProjectGroupTags(project, {
            groupId: membership.groupId,
            role: membership.role,
            ...(label !== undefined && known?.nameSource !== "id" ? { label } : {}),
            ...(membership.label !== undefined ? { label: membership.label } : {}),
          }),
        );
      });
    },
    [activeOrganization, groupTree.groups, projectRef, runtime.commands, write],
  );

  /**
   * *Register in {group}* — the write a colleague's Mate is waiting on. A
   * member with *can create projects* makes a Mate and cannot write the
   * registry, so it runs with no group reach until an owner adds it (guide 4.2).
   */
  const registerVerbFor = useCallback(
    (candidate: ZeropsCandidatePresentation, tags: ZeropsGroupTags): string | undefined => {
      if (tags.groupId === undefined) return undefined;
      const group = groupTree.groups.find((entry) => entry.group.groupId === tags.groupId)?.group;
      if (group === undefined) return undefined;
      return registerMateVerb({
        registration: resolveMateRegistration({
          registry: registry.registry,
          projectId: candidate.project.id,
        }),
        viewerRole: activeOrganization?.roleCode,
        groupName: group.name,
      });
    },
    [activeOrganization?.roleCode, groupTree.groups, registry.registry],
  );

  const register = useCallback(
    (candidate: ZeropsCandidatePresentation, tags: ZeropsGroupTags) => {
      if (tags.groupId === undefined || giteaProjectId === undefined || activeOrganization === null)
        return;
      const groupId = tags.groupId;
      void write(candidate.key, async () => {
        // The broker's rights loop runs off the registry and the grant, so the
        // Mate gets its bot's access on the loop's next pass rather than on a
        // step this verb has to sequence.
        const outstanding = await registerMateInGroup({
          client,
          clientId: activeOrganization.id,
          giteaProjectId,
          registry: registry.registry,
          groupId,
          projectId: candidate.project.id,
        });
        registry.refresh();
        if (outstanding !== null) setTrouble(outstanding);
      });
    },
    [activeOrganization, client, giteaProjectId, registry, write],
  );

  const actionsFor = useCallback(
    (
      candidate: ZeropsCandidatePresentation,
      tags: ZeropsGroupTags,
      extraQuick: ReadonlyArray<ZeropsMenuEntry> = [],
    ): ReadonlyArray<ZeropsMenuEntry> => {
      const verbs =
        viewer === null
          ? { open: true, rename: true, tag: true, move: true, assign: false }
          : resolveMateVerbs({ project: candidate.project, viewer });
      const input = rowInputFor(candidate);
      const rowAction = deriveZeropsRowAction(input);
      const restartAction = deriveZeropsRestartAction(input);
      const registerLabel = registerVerbFor(candidate, tags);
      const serverVersion = serverVersions.get(candidate.key);
      const busy = busyKey === candidate.key;
      const quick: Array<ZeropsMenuEntry> = [];
      if (rowAction.kind === "start") {
        quick.push({
          id: "start",
          label: "Start",
          disabled: busy,
          onSelect: () => start(candidate),
        });
      }
      if (restartAction.kind === "restart") {
        quick.push({
          id: "restart",
          label: restartAction.label,
          disabled: busy,
          onSelect: () => restart(candidate),
        });
      }
      quick.push(...extraQuick);
      return [
        ...quick,
        ...(quick.length > 0 ? [{ id: "quick", separator: true } as const] : []),
        ...(verbs.rename
          ? [
              {
                id: "rename-agent",
                label: "Rename Mate",
                onSelect: () => setDialog({ kind: "rename", candidate }),
              },
            ]
          : []),
        ...(registerLabel === undefined
          ? []
          : [
              {
                id: "register",
                label: registerLabel,
                disabled: busy,
                onSelect: () => register(candidate, tags),
              },
            ]),
        ...(verbs.assign
          ? [
              {
                id: "assign",
                label: "Hand this Mate over",
                onSelect: () => setDialog({ kind: "assign", candidate }),
              },
            ]
          : []),
        ...(verbs.move
          ? [
              {
                id: "move",
                label: tags.groupId === undefined ? "Move to a project" : "Change project or role",
                onSelect: () => setDialog({ kind: "move", candidate }),
              },
            ]
          : []),
        ...(verbs.move && tags.groupId !== undefined
          ? [
              {
                id: "leave",
                label: "Leave the project",
                disabled: busy,
                onSelect: () => move(candidate, { kind: "none" }),
              },
            ]
          : []),
        // The server's version, off the card and into the menu: a fact worth
        // finding, never a line under the Mate's name.
        ...(serverVersion === undefined
          ? []
          : [
              { id: "version", separator: true } as const,
              {
                id: "server-version",
                label: `Server ${serverVersion}`,
                disabled: true,
                onSelect: () => {},
              },
            ]),
      ];
    },
    [busyKey, move, register, registerVerbFor, restart, rowInputFor, serverVersions, start, viewer],
  );

  const mintGroupId = useCallback(
    () => generateZeropsGroupId((bytes) => crypto.getRandomValues(bytes)),
    [],
  );
  const close = useCallback(() => setDialog(null), []);
  const dialogs = (
    <>
      {dialog?.kind === "rename" ? (
        <ZeropsRenameDialog
          initialValue={readZeropsGroupTags(dialog.candidate.project.tagList).bot ?? ""}
          key={`rename-agent:${dialog.candidate.key}`}
          label="Mate's name"
          onCancel={close}
          onOpenChange={(open) => {
            if (!open) close();
          }}
          onSubmit={(name) => {
            const { candidate } = dialog;
            close();
            rename(candidate, name);
          }}
          open
          submitLabel="Rename"
          title={`Rename the Mate in ${dialog.candidate.project.name}`}
          validate={(value) => {
            const current = readZeropsGroupTags(dialog.candidate.project.tagList).bot;
            return validateBotName(value, takenBotNames, current === undefined ? {} : { current });
          }}
        />
      ) : null}
      {dialog?.kind === "assign" ? (
        <ZeropsAssignMateDialog
          currentOwnerId={
            dialog.candidate.project.userRoles?.find((entry) => entry.roleCode === "OWNER")
              ?.clientUserId
          }
          key={`assign:${dialog.candidate.key}`}
          members={members}
          onCancel={close}
          onOpenChange={(open) => {
            if (!open) close();
          }}
          onSubmit={(clientUserId) => {
            const { candidate } = dialog;
            close();
            assign(candidate, clientUserId);
          }}
          projectName={dialog.candidate.project.name}
        />
      ) : null}
      {dialog?.kind === "move" ? (
        <ZeropsMoveToGroupDialog
          currentGroupId={readZeropsGroupTags(dialog.candidate.project.tagList).groupId}
          currentRole={readZeropsGroupTags(dialog.candidate.project.tagList).role}
          groups={groupTree.groups.map(({ group }) => ({ id: group.groupId, name: group.name }))}
          key={`move:${dialog.candidate.key}`}
          mintGroupId={mintGroupId}
          onCancel={close}
          onOpenChange={(open) => {
            if (!open) close();
          }}
          onSubmit={(membership) => {
            const { candidate } = dialog;
            close();
            move(candidate, membership);
          }}
          open
          projectName={dialog.candidate.project.name}
        />
      ) : null}
    </>
  );

  return { actionsFor, dialogs, busyKey, trouble };
}
