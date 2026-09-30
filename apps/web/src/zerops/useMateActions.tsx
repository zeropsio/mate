/**
 * What can be done to a Mate, from wherever a Mate is listed.
 *
 * Nine verbs — *Start*, *Restart*, *Rename Mate*, *Change face…*, *Register
 * in …*, *Hand this Mate over*, *Change project or role*, *Leave the project*,
 * *Delete {name}…* — and the server's version under them. Most lived inside
 * the projects screen's own row menu, wired to that page's state, so a
 * project's own page listed its Mates and could do nothing to any of them.
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
 *
 * *Delete {name}…* takes a working Mate off Zerops, its environment whole
 * (*Remove* takes only a project whose creation the platform failed). Its
 * dialog stays open while the platform answers and says why it refused; once
 * it accepts, the listing is read again, nothing this browser remembers of
 * the Mate is left to paint on a reload, its row reads *Deleting…* until the
 * listing lets it go (`deletingMates.ts`), and a viewer who was in its
 * conversation is taken to the next Mate of its project, or to the projects.
 *
 * *Change face…* writes the Mate's face onto its project (`mate:face:`), where
 * every surface reads it, through the one tag writer: offered where *Rename
 * Mate* is, its dialog open until the platform answers, a refusal said there.
 */
import {
  assignCandidateMateTints,
  botDisplayName,
  buildZeropsGroupTree,
  generateZeropsGroupId,
  hasMate,
  rankZeropsCandidateForListing,
  readZeropsGroupTags,
  registerMateVerb,
  resolveMateRegistration,
  type ZeropsGroupTags,
  type ZeropsMateFace,
} from "@t3tools/client-runtime/zerops";
import { ZeropsServiceId } from "@t3tools/client-runtime/zerops/data";
import { candidatesComplete, heldCandidates } from "@t3tools/client-runtime/zerops/projections";
import { zeropsErrorMessage } from "@t3tools/client-runtime/zerops/errors";
import {
  resolveMateOwner,
  resolveMateVerbs,
  resolveMateVisibility,
} from "@t3tools/client-runtime/zerops/mateAccess";
import { useRouter } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";

import { useComposerDraftStore } from "../composerDraftStore";
import {
  deriveZeropsRestartAction,
  deriveZeropsRowAction,
  type ZeropsRowInput,
} from "../components/zerops/ZeropsProjectRow.logic";
import type { ZeropsMenuEntry } from "../components/zerops/ZeropsProjectMenu";
import { ZeropsAssignMateDialog } from "../components/zerops/ZeropsAssignMateDialog";
import { ZeropsChangeFaceDialog } from "../components/zerops/ZeropsChangeFaceDialog";
import {
  CHANGE_FACE_VERB,
  changeFaceOffered,
  mateFaceOf,
} from "../components/zerops/ZeropsChangeFaceDialog.logic";
import { ZeropsDeleteMateDialog } from "../components/zerops/ZeropsDeleteMateDialog";
import {
  deleteMateOffered,
  deleteMateVerb,
  deleteMateWords,
  landingAfterDelete,
} from "../components/zerops/ZeropsDeleteMateDialog.logic";
import { ZeropsMoveToGroupDialog } from "../components/zerops/ZeropsMoveToGroupDialog";
import { ZeropsRenameDialog } from "../components/zerops/ZeropsRenameDialog";
import { validateBotName } from "../components/zerops/ZeropsEnvironmentCreationDialog.logic";
import type { MoveMembership } from "../components/zerops/ZeropsMoveToGroupDialog.logic";
import { useEnvironmentLinks } from "../routes/-environmentTargets";
import { resolveThreadRouteTarget } from "../threadRoutes";
import { invalidateZerops } from "./accountInvalidations";
import { projectTagsWrite, registerMateInGroup } from "./brokerGrant";
import {
  deletingMates,
  markMateDeleting,
  mateDeleting,
  settleDeletingMates,
  useDeletingMates,
} from "./deletingMates";
import { useAccountGitea } from "./giteaProject";
import { useProjectDialog } from "./inventoryContext";
import { captureAccountLifetime } from "./accountLifetime";
import { rememberMenu, withoutMate } from "./menuMemory";
import { useOpenMate } from "./useOpenMate";
import { useProjectOrderOptions } from "./projectOrderPreference";
import {
  useTakenBotNames,
  useZeropsCandidates,
  type ZeropsCandidatePresentation,
} from "./useZeropsCandidates";
import { useZeropsOrganizationMembers, zeropsMateOwner } from "./useZeropsMateOwners";
import { forgetBirth } from "./zeropsBirths";
import { intendContainer } from "./zeropsContainers";
import { runZeropsCommand, useZeropsData } from "./zeropsDataContext";
import { useZeropsSession } from "./ZeropsSessionProvider";

/** Which Mate a dialog is about, and which dialog it is. */
type MateDialog =
  | { readonly kind: "rename"; readonly candidate: ZeropsCandidatePresentation }
  | {
      readonly kind: "face";
      readonly candidate: ZeropsCandidatePresentation;
      /** Saved or let go: it closes the way a dialog does, over the face it leaves. */
      readonly closing?: true;
    }
  | { readonly kind: "assign"; readonly candidate: ZeropsCandidatePresentation }
  | { readonly kind: "move"; readonly candidate: ZeropsCandidatePresentation }
  | { readonly kind: "delete"; readonly candidate: ZeropsCandidatePresentation };

/**
 * Where a dialog's press stands — Delete's, or Change face's: the platform answering it, or why
 * it refused. One dialog is open at a time, and opening one starts it unpressed.
 */
interface DialogPress {
  readonly pending: boolean;
  readonly error: string | null;
}

const UNPRESSED: DialogPress = { pending: false, error: null };

/** The Mate's name, as its row says it. */
function mateName(candidate: ZeropsCandidatePresentation): string {
  return botDisplayName({
    bot: readZeropsGroupTags(candidate.project.tagList).bot,
    projectName: candidate.project.name,
  });
}

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
  /**
   * *Rename Mate* without its dialog, for a surface that renames in place:
   * the same validation and the same write. `undefined` where this person
   * may not rename the Mate.
   */
  readonly renameInPlace: (candidate: ZeropsCandidatePresentation) => MateRenameInPlace | undefined;
  /**
   * Opens the Mate's *Change face…* dialog, for a menu that places the verb itself: `undefined`
   * where this person may not change it (where they may not rename it).
   */
  readonly changeFace: (candidate: ZeropsCandidatePresentation) => (() => void) | undefined;
  /** Which Mate has a write in flight, so its own row says so and takes no second press. */
  readonly busyKey: string | null;
  /** Why the last write failed; `null` when none did. */
  readonly trouble: string | null;
}

/** One Mate's name, edited where it stands. */
export interface MateRenameInPlace {
  readonly initialValue: string;
  /** Why this name will not do, or `undefined` when it will. */
  readonly validate: (value: string) => string | undefined;
  /** Writes the name — trimmed, inner spaces collapsed, as the dialog writes it. */
  readonly commit: (value: string) => void;
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
  /** `candidate.key → "0.11.25"`, from `useZeropsContainers`. */
  readonly serverVersions: ReadonlyMap<string, string>;
}

interface RegistryState {
  readonly registry: Parameters<typeof resolveMateRegistration>[0]["registry"];
  readonly refresh: () => void;
}

export function useMateActions({ registry, serverVersions }: MateActionsInput): MateActions {
  const { activeOrganization, client, user } = useZeropsSession();
  const { organizationRef, projectRef, runtime } = useZeropsData();
  const { listing, refresh } = useZeropsCandidates();
  const candidates = useMemo(() => heldCandidates(listing).rows, [listing]);
  const router = useRouter();
  const openMate = useOpenMate();
  const { linkTarget } = useEnvironmentLinks();
  // The Mates this tab deleted, until a complete listing no longer holds them.
  const deleting = useDeletingMates();
  const listingComplete = candidatesComplete(listing);
  useEffect(() => {
    if (!listingComplete) return;
    settleDeletingMates(new Set(candidates.map((candidate) => candidate.project.id)));
  }, [candidates, listingComplete]);
  const [press, setPress] = useState<DialogPress>(UNPRESSED);
  // A dialog holds its Mate's project as it opened: it closes once the grant withholds it.
  const [dialog, setDialog] = useProjectDialog((open: MateDialog) => open.candidate.project.id);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [trouble, setTrouble] = useState<string | null>(null);
  // The same preference the projects screen's sort control writes — the
  // "move to" dialog's group choices should read the way the person set up
  // their own list, not a fixed order of their own.
  const projectOrder = useProjectOrderOptions();

  const giteaProjectId = useAccountGitea(activeOrganization?.id)?.projectId;
  const groupTree = useMemo(
    () =>
      buildZeropsGroupTree(candidates, {
        rank: rankZeropsCandidateForListing,
        ...projectOrder,
      }),
    [candidates, projectOrder],
  );
  const taken = useTakenBotNames();
  // Every Mate's tint as every surface draws it: the face a Change face dialog opens on.
  const tints = useMemo(() => assignCandidateMateTints(candidates), [candidates]);
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
  // The member list is read only where somebody could be handed a Mate, and
  // where a Mate about to be deleted may be a colleague's, to say whose.
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
    enabled: anyAssignable || dialog?.kind === "delete",
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
          ).then((value) => {
            intendContainer(candidate.key, { kind: "restart" });
            return value;
          }),
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
          runtime.commands.updateProjectTags(
            projectRef(activeOrganization.id, candidate.project.id),
            { kind: "agent-name", name },
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
          return runZeropsCommand(
            runtime.commands.updateProjectTags(project, { kind: "group-membership", next: {} }),
          );
        }
        // Joining an existing group carries its name along, so the mirror on
        // this member agrees with the others'.
        const known = groupTree.groups.find(
          (entry) => entry.group.groupId === membership.groupId,
        )?.group;
        const label = membership.label ?? known?.name;
        return runZeropsCommand(
          runtime.commands.updateProjectTags(project, {
            kind: "group-membership",
            next: {
              groupId: membership.groupId,
              role: membership.role,
              ...(label !== undefined && known?.nameSource !== "id" ? { label } : {}),
              ...(membership.label !== undefined ? { label: membership.label } : {}),
            },
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
          writeTags: projectTagsWrite({ runtime, projectRef }, activeOrganization.id),
          clientId: activeOrganization.id,
          giteaProjectId,
          groupId,
          projectId: candidate.project.id,
        });
        registry.refresh();
        if (outstanding !== null) setTrouble(outstanding);
      });
    },
    [activeOrganization, client, giteaProjectId, projectRef, registry, runtime, write],
  );

  /** Whose Mate it is, where that is a colleague: "Ada's Mate", as its row says it. */
  const colleagueOf = useCallback(
    (candidate: ZeropsCandidatePresentation): string | undefined => {
      const owner = zeropsMateOwner(
        resolveMateOwner({ project: candidate.project, members }),
        user?.id,
      );
      return owner === undefined || owner.isViewer ? undefined : owner.name;
    },
    [members, user?.id],
  );

  /**
   * Once the Mate is gone, where the viewer stands: read after the platform's
   * yes, as the route stands then. In its conversation, the next Mate of its
   * project this viewer opens; none, the projects.
   */
  const leaveDeleted = useCallback(
    (deleted: ZeropsCandidatePresentation) => {
      const leaf = router.state.matches[router.state.matches.length - 1];
      const params: Readonly<Record<string, string | undefined>> | undefined = leaf?.params;
      const route = params === undefined ? null : resolveThreadRouteTarget(params);
      const onScreen =
        route?.kind === "server"
          ? route.threadRef.environmentId
          : route?.kind === "draft"
            ? useComposerDraftStore.getState().getDraftSession(route.draftId)?.environmentId
            : undefined;
      const environmentId = deleted.environmentId ?? linkTarget(deleted);
      const { groupId } = readZeropsGroupTags(deleted.project.tagList);
      const siblings = (
        groupTree.groups.find((entry) => entry.group.groupId === groupId)?.environments ?? []
      )
        .map(({ item }) => item)
        .filter(hasMate);
      const landing = landingAfterDelete({
        deleted: deleted.project.id,
        viewing:
          onScreen !== undefined && onScreen === environmentId ? deleted.project.id : undefined,
        siblings: siblings.map((mate) => ({
          projectId: mate.project.id,
          opens:
            (viewer === null ||
              resolveMateVisibility({ project: mate.project, viewer }) === "open") &&
            !mateDeleting(mate.project, deletingMates()),
        })),
      });
      if (landing.kind === "projects") {
        void router.navigate({ to: "/zerops" });
        return;
      }
      if (landing.kind === "mate") {
        const next = siblings.find((mate) => mate.project.id === landing.projectId);
        if (next !== undefined) openMate(next);
      }
    },
    [groupTree.groups, linkTarget, openMate, router, viewer],
  );

  /**
   * Deletes the Mate's project. The dialog stays open until the platform
   * answers: a refusal is said there, and nothing else changes. Once it
   * accepts, the row says *Deleting…* until the listing lets it go, the
   * listing is read again, and nothing this browser remembers of the Mate —
   * its row, its crew, a birth — is left for a reload to paint.
   */
  const deleteMate = useCallback(
    (candidate: ZeropsCandidatePresentation) => {
      if (activeOrganization === null) return;
      const isCurrent = captureAccountLifetime();
      const organization = organizationRef(activeOrganization.id);
      const projectId = candidate.project.id;
      setPress({ pending: true, error: null });
      runZeropsCommand(runtime.commands.deleteProject({ organization, projectId })).then(
        () => {
          if (!isCurrent()) return;
          markMateDeleting(projectId);
          rememberMenu((memory) => withoutMate(memory, projectId));
          forgetBirth(projectId);
          invalidateZerops({ topic: "inventory", organization });
          setPress(UNPRESSED);
          setDialog(null);
          leaveDeleted(candidate);
        },
        (cause: unknown) => {
          if (!isCurrent()) return;
          setPress({ pending: false, error: zeropsErrorMessage(cause) });
        },
      );
    },
    [activeOrganization, leaveDeleted, organizationRef, runtime.commands, setDialog],
  );

  /**
   * Writes the Mate's face: a patch the tag writer applies to the project's tags as the platform
   * holds them, every other tag kept, and reads back — the read every surface redraws from. The
   * dialog stays open until the platform answers: a refusal is said there, and nothing changes.
   */
  const saveFace = useCallback(
    (candidate: ZeropsCandidatePresentation, face: ZeropsMateFace) => {
      if (activeOrganization === null) return;
      const isCurrent = captureAccountLifetime();
      setPress({ pending: true, error: null });
      runZeropsCommand(
        runtime.commands.updateProjectTags(
          projectRef(activeOrganization.id, candidate.project.id),
          { kind: "mate-face", face },
        ),
      ).then(
        () => {
          if (!isCurrent()) return;
          // Still saying Saving… as it fades: the face it saved shows through it.
          setDialog({ kind: "face", candidate, closing: true });
        },
        (cause: unknown) => {
          if (!isCurrent()) return;
          setPress({ pending: false, error: zeropsErrorMessage(cause) });
        },
      );
    },
    [activeOrganization, projectRef, runtime.commands, setDialog],
  );

  const changeFace = useCallback(
    (candidate: ZeropsCandidatePresentation): (() => void) | undefined => {
      const mayRename =
        viewer === null ? true : resolveMateVerbs({ project: candidate.project, viewer }).rename;
      if (!changeFaceOffered({ candidate, mayRename })) return undefined;
      return () => {
        setPress(UNPRESSED);
        setDialog({ kind: "face", candidate });
      };
    },
    [setDialog, viewer],
  );

  const actionsFor = useCallback(
    (
      candidate: ZeropsCandidatePresentation,
      tags: ZeropsGroupTags,
      extraQuick: ReadonlyArray<ZeropsMenuEntry> = [],
    ): ReadonlyArray<ZeropsMenuEntry> => {
      const verbs =
        viewer === null
          ? { open: true, rename: true, tag: true, move: true, delete: false, assign: false }
          : resolveMateVerbs({ project: candidate.project, viewer });
      const deletable = deleteMateOffered({
        candidate,
        mayDelete: verbs.delete,
        deleting: mateDeleting(candidate.project, deleting),
      });
      const openFace = changeFace(candidate);
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
        ...(openFace === undefined
          ? []
          : [{ id: "face", label: CHANGE_FACE_VERB, onSelect: openFace }]),
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
        // What takes the Mate away for good: last of the verbs, a line apart, in red.
        ...(deletable
          ? [
              { id: "delete-apart", separator: true } as const,
              {
                id: "delete",
                label: deleteMateVerb(mateName(candidate)),
                variant: "destructive" as const,
                disabled: busy,
                onSelect: () => {
                  setPress(UNPRESSED);
                  setDialog({ kind: "delete", candidate });
                },
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
    [
      busyKey,
      changeFace,
      deleting,
      move,
      register,
      registerVerbFor,
      restart,
      rowInputFor,
      serverVersions,
      setDialog,
      start,
      viewer,
    ],
  );

  const renameInPlace = useCallback(
    (candidate: ZeropsCandidatePresentation): MateRenameInPlace | undefined => {
      const allowed =
        viewer === null ? true : resolveMateVerbs({ project: candidate.project, viewer }).rename;
      if (!allowed) return undefined;
      const current = readZeropsGroupTags(candidate.project.tagList).bot;
      return {
        initialValue: current ?? "",
        validate: (value) =>
          validateBotName(value, taken, current === undefined ? {} : { current }),
        commit: (value) => {
          rename(candidate, value.replace(/\s+/g, " ").trim());
        },
      };
    },
    [rename, taken, viewer],
  );

  const mintGroupId = useCallback(
    () => generateZeropsGroupId((bytes) => crypto.getRandomValues(bytes)),
    [],
  );
  const close = useCallback(() => setDialog(null), [setDialog]);
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
            return validateBotName(value, taken, current === undefined ? {} : { current });
          }}
        />
      ) : null}
      {dialog?.kind === "face" ? (
        <ZeropsChangeFaceDialog
          error={press.error}
          face={mateFaceOf(
            tints,
            // The face it wears now, a write landed since the dialog opened included.
            candidates.find((entry) => entry.project.id === dialog.candidate.project.id)?.project ??
              dialog.candidate.project,
          )}
          key={`face:${dialog.candidate.key}`}
          name={mateName(dialog.candidate)}
          onCancel={() => {
            setDialog({ ...dialog, closing: true });
          }}
          onOpenChange={(open) => {
            if (!open) setDialog({ ...dialog, closing: true });
          }}
          onOpenChangeComplete={(open) => {
            if (!open) close();
          }}
          onSave={(face) => {
            saveFace(dialog.candidate, face);
          }}
          open={dialog.closing !== true}
          pending={press.pending}
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
      {dialog?.kind === "delete" ? (
        <ZeropsDeleteMateDialog
          error={press.error}
          key={`delete:${dialog.candidate.key}`}
          name={mateName(dialog.candidate)}
          onCancel={close}
          onConfirm={() => {
            deleteMate(dialog.candidate);
          }}
          onOpenChange={(open) => {
            if (!open) close();
          }}
          open
          pending={press.pending}
          words={deleteMateWords({
            name: mateName(dialog.candidate),
            environment: dialog.candidate.project.name,
            services: dialog.candidate.services?.hostnames.length,
            owner: colleagueOf(dialog.candidate),
          })}
        />
      ) : null}
    </>
  );

  return { actionsFor, dialogs, busyKey, trouble, renameInPlace, changeFace };
}
