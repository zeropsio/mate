/**
 * What can be done to a Mate, from wherever a Mate is listed.
 *
 * Nine verbs — *Start*, *Restart*, *Rename Mate*, *Change face…*, *Finish
 * setup*, *Hand this Mate over*, *Change project or role*, *Leave the project*,
 * *Delete {name}…* — and the server's version under them. Most lived inside
 * the projects screen's own row menu, wired to that page's state, so a
 * project's own page listed its Mates and could do nothing to any of them.
 *
 * None of them needs that page. They need the active organization, the
 * account's operations, the account's registry and the org's member list — all
 * context, all reachable from any surface. So they live here, once, in the
 * same shape as `useEnableRoute`: the writes, the busy
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
 * *Rename Mate* renames the Mate's project in Zerops, whose name is the Mate's own after its
 * application's (`renamedProjectName`), by the account's one writer of a project's record, where the platform takes it from this person.
 * *Change face…* writes the Mate's face to HQ, where every surface reads it from, where HQ's rule
 * lets them: its dialog open until HQ answers, a refusal said there.
 */
import { useAtomValue } from "@effect/atom-react";
import {
  assignCandidateMateTints,
  buildZeropsGroupTree,
  changedMateFace,
  hasMate,
  kindOfRole,
  projectNameInApp,
  rankZeropsCandidateForListing,
  readZeropsMembership,
  renamedProjectName,
  finishMateSetupScope,
  finishMateSetupVerb,
  resolveMateRegistration,
  type ZeropsMembership,
  type ZeropsMateFace,
} from "@t3tools/client-runtime/zerops";
import { candidatesComplete, heldCandidates } from "@t3tools/client-runtime/zerops/projections";
import { zeropsErrorMessage } from "@t3tools/client-runtime/zerops/errors";
import { heldOf, type HqPlacement } from "@t3tools/client-runtime/zerops/hq";
import {
  mateIsViewers,
  resolveMateOwnerPerson,
  resolveMateVerbs,
  resolveMateVisibility,
} from "@t3tools/client-runtime/zerops/mateAccess";
import type { HqOfferState } from "@t3tools/shared/hqOffers";
import { isMateKind } from "@t3tools/shared/zeropsRoles";
import { useRouter } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";

import { RestartMateConfirmation } from "./RestartMateConfirmation";
import type { HqMoveTo } from "@t3tools/shared/hqOffers";
import { useMateOffers, useOrgOffers } from "./useHqOffers";
import { useAccountDataOptional } from "./ZeropsAccountData";
import { useComposerDraftStore } from "../composerDraftStore";
import {
  deriveZeropsRestartAction,
  deriveZeropsRowAction,
  mateRowCan,
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
  deleteMateServiceCount,
  deleteMateVerb,
  deleteMateWords,
  landingAfterDelete,
} from "../components/zerops/ZeropsDeleteMateDialog.logic";
import { ZeropsMoveToGroupDialog } from "../components/zerops/ZeropsMoveToGroupDialog";
import { emptyApplications } from "../components/zerops/projects/emptyApps.logic";
import { ZeropsRenameDialog } from "../components/zerops/ZeropsRenameDialog";
import { validateBotName } from "../components/zerops/ZeropsEnvironmentCreationDialog.logic";
import {
  moveChoices,
  type MoveMembership,
} from "../components/zerops/ZeropsMoveToGroupDialog.logic";
import { currentAccountEnvironments } from "./accountEnvironments";
import { useEnvironmentLinks } from "../routes/-environmentTargets";
import { resolveThreadRouteTarget } from "../threadRoutes";
import { hqPeopleAtom, hqPlacementsAtom, hqNavigationAtom } from "../state/zerops";
import { invalidateZerops } from "./accountInvalidations";
import {
  deletingMates,
  markMateDeleting,
  mateDeleting,
  settleDeletingMates,
  useDeletingMates,
} from "./deletingMates";
import { accountHqApi, officialHq, useAccountHq } from "./accountHq";
import { useProjectDialog } from "./inventoryContext";
import { captureAccountLifetime } from "./accountLifetime";
import { useOpenMate } from "./useOpenMate";
import { useProjectOrderOptions } from "./projectOrderPreference";
import {
  useTakenBotNames,
  useZeropsCandidates,
  type ZeropsCandidatePresentation,
} from "./useZeropsCandidates";
import { useZeropsOrganizationMembersRead } from "./useZeropsMateOwners";
import { finishSetupContainer } from "./finishSetup.logic";
import { usePressesElsewhere } from "./usePressesElsewhere";
import {
  refinishNewProjectBirth,
  registrationUnfinished,
  useNewProjectBirths,
} from "./newProjectBirth";
import {
  beginPress,
  finishSetupRunning,
  finishMateSetup,
  forgetPress,
  matePressPlacement,
  mateFinishRegistration,
  readMatePress,
  useInterruptedPresses,
  useMatePresses,
} from "./matePress";
import { useDeleteProject } from "./deleteProject";
import { useRestartMate } from "./mateRestart";
import {
  planProjectLeave,
  planProjectMove,
  projectRenameTrouble,
  renameStillDue,
  type ProjectRename,
} from "./projectRenames.logic";
import { useUnrenamedProjects } from "./unrenamedProjects";
import { useRenameProjects } from "./useRenameProjects";
import { useAccountOperations } from "./accountOperations";
import { useZeropsData } from "./zeropsDataContext";
import { submitZeropsWrite, writeTrouble, type ZeropsWrite } from "./zeropsWrite";
import { useZeropsSession } from "./ZeropsSessionProvider";

/** Which Mate a dialog is about, and which dialog it is. */
type MateDialog =
  | { readonly kind: "restart"; readonly candidate: ZeropsCandidatePresentation }
  | { readonly kind: "rename"; readonly candidate: ZeropsCandidatePresentation }
  | {
      readonly kind: "face";
      readonly candidate: ZeropsCandidatePresentation;
      /** Saved or let go: it closes the way a dialog does, over the face it leaves. */
      readonly closing?: true;
    }
  | { readonly kind: "assign"; readonly candidate: ZeropsCandidatePresentation }
  /** Where it may go is HQ's answer as the move opened (`move-offers`), never listed ahead. */
  | {
      readonly kind: "move";
      readonly candidate: ZeropsCandidatePresentation;
      readonly moveTo: HqMoveTo;
    }
  | {
      readonly kind: "delete";
      readonly candidate: ZeropsCandidatePresentation;
      readonly cleanup?: {
        readonly keyTokenId: string | null;
        readonly completion: string;
        readonly hqDone: boolean;
      };
    };

/**
 * Where a dialog's press stands — Delete's, Change face's or Hand over's: the platform answering
 * it, or why it refused. One dialog is open at a time, and opening one starts it unpressed.
 */
interface DialogPress {
  readonly pending: boolean;
  readonly error: string | null;
}

const UNPRESSED: DialogPress = { pending: false, error: null };

/** HQ says this Mate's key reads other projects too (`keyWider`, ADR 0003's fallout). */
const keyWiderOf = (candidate: ZeropsCandidatePresentation): boolean =>
  candidate.project.hq?.mate?.keyWider === true;

/** Why *Finish setup* is on a Mate whose key reads other projects: what it takes off. */
export const KEY_WIDER_WHY =
  "Its key still reads other projects, production included. Finish setup leaves it on its own project.";

export interface MateActions {
  /**
   * The menu entries for one Mate, already gated by what this person may
   * finish (`resolveMateVerbs`, guide 0.8) — a verb the platform would refuse
   * is never offered.
   */
  readonly actionsFor: (
    candidate: ZeropsCandidatePresentation,
    tags: ZeropsMembership,
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

/** The two reads a caller already holds, handed over rather than taken again here. */
export interface MateActionsInput {
  readonly registry: RegistryState;
  /** `candidate.key → "0.11.25"`, from `useZeropsContainers`. */
  readonly serverVersions: ReadonlyMap<string, string>;
}

interface RegistryState {
  readonly registry: Parameters<typeof resolveMateRegistration>[0]["registry"];
}

/** A verb of HQ's on a Mate: offered, held while HQ has not said or does not answer, or not drawn. */
type HqVerb = "offered" | "held" | "no";

/** Whether HQ offers writing the registry; `undefined` while it has not said, or does not answer. */
const writes = (createApp: HqOfferState): boolean | undefined =>
  createApp.kind === "allowed" ? true : createApp.kind === "refused" ? false : undefined;

export function useMateActions({ registry, serverVersions }: MateActionsInput): MateActions {
  const { activeOrganization, client, user } = useZeropsSession();
  const { organizationRef, projectRef, runtime } = useZeropsData();
  const operations = useAccountOperations();
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

  const accountHq = useAccountHq(activeOrganization?.id);
  // Whether HQ's structure is known: only then does a Mate it places nowhere have no record.
  const hqPlacements = useAtomValue(hqPlacementsAtom);
  const hqStructure = useAtomValue(hqNavigationAtom);
  const people = useAtomValue(hqPeopleAtom);
  const hqKnown = hqPlacements !== null && hqStructure.live;
  const presses = useMatePresses();
  // What this tab made: a registration it saw refused is finished at once (`registrationUnfinished`).
  const births = useNewProjectBirths((state) => state.births);
  // A press interrupted before its close-off, on a Mate made in any browser: the store's markers,
  // at no cost of their own, for anyone who could finish it — its own adder too.
  const interrupted = useInterruptedPresses(candidates, { runtime, projectRef });
  // Whether each Mate's press in another browser is still at it, as HQ holds it (B5).
  const pressOf = usePressesElsewhere(candidates);
  const pressedElsewhere = useCallback(
    (projectId: string) => pressOf(projectId) !== "stopped",
    [pressOf],
  );
  // An application HQ holds with no project is one too: a Mate may be moved into it, as the
  // projects page draws it (F29: a birth cut before its Mate was attached leaves its one empty).
  const groupTree = useMemo(
    () =>
      buildZeropsGroupTree(candidates, {
        rank: rankZeropsCandidateForListing,
        ...projectOrder,
        apps: emptyApplications(hqStructure, activeOrganization?.id),
      }),
    [activeOrganization?.id, candidates, hqStructure, projectOrder],
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
  /** What HQ offers of each project and of the organization: drawn here, decided by HQ. */
  const mateOffersOf = useMateOffers();
  const orgOffer = useOrgOffers();
  /**
   * Where a Mate may be moved, as HQ answered when the move opened (`moveTo`) and as it offers its
   * leaving (`detach`): each application listed, a new one, or none.
   */
  const moveChoicesFor = useCallback(
    (candidate: ZeropsCandidatePresentation, moveTo: HqMoveTo) => {
      const offers = mateOffersOf(candidate.project.id);
      return moveChoices({
        moveTo,
        detach: offers?.held === true && offers.detach.kind === "allowed",
        apps: groupTree.groups.map(({ group }) => ({ id: group.groupId, name: group.name })),
      });
    },
    [groupTree.groups, mateOffersOf],
  );
  const askMoveOffers = useAccountDataOptional()?.moveOffers;
  /**
   * HQ's verbs on a Mate, as HQ offers them: its record, and its place among projects — each
   * offered; held while HQ has not said or does not answer (drawn, and not pressable); not drawn
   * where HQ refuses it. None on a Mate HQ holds no record of — *Finish setup* is its verb.
   */
  const hqVerbsOf = useCallback(
    (candidate: ZeropsCandidatePresentation): Record<"edit" | "move" | "leave", HqVerb> => {
      const offers = mateOffersOf(candidate.project.id);
      if (offers?.held !== true || !isMateKind(heldOf(candidate.project))) {
        return { edit: "no", move: "no", leave: "no" };
      }
      const verb = (state: HqOfferState): HqVerb =>
        state.kind === "allowed" ? "offered" : state.kind === "refused" ? "no" : "held";
      return {
        edit: verb(offers.edit),
        // Where to, and as what, HQ answers as the move opens: offered to whoever may write its
        // record, HQ deciding the move again at the write.
        move: verb(offers.edit),
        leave: verb(offers.detach),
      };
    },
    [mateOffersOf],
  );
  // The member list is read only once a hand-over's picker opens: a load reads none, and a Mate
  // about to be deleted says whose it is from HQ's people.
  const { members, status: membersStatus } = useZeropsOrganizationMembersRead({
    clientId: activeOrganization?.id,
    enabled: dialog?.kind === "assign",
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
      return {
        candidate,
        health: undefined,
        waiting: false,
        can: mateRowCan(mateOffersOf(candidate.project.id)),
        ...(visibility === undefined ? {} : { visibility }),
      };
    },
    [mateOffersOf, viewer],
  );

  const start = useCallback(
    (candidate: ZeropsCandidatePresentation) => {
      if (activeOrganization === null) return;
      const projectId = candidate.project.id;
      const serviceId = candidate.service?.id;
      // A STOPPED project starts every service in it; a STOPPED service while
      // the project is ACTIVE starts only that service.
      const started: ZeropsWrite | null =
        candidate.project.status === "STOPPED"
          ? { kind: "start-project", projectId }
          : serviceId === undefined
            ? null
            : { kind: "start-service", projectId, serviceId };
      if (started === null) return;
      void write(
        candidate.key,
        () => submitZeropsWrite(operations, activeOrganization.id, started),
        refresh,
      );
    },
    [activeOrganization, operations, refresh, write],
  );

  const restartMate = useRestartMate();
  const deleteProject = useDeleteProject();
  const restart = useCallback(
    (candidate: ZeropsCandidatePresentation) => {
      const serviceId = candidate.service?.id;
      if (activeOrganization === null || serviceId === undefined) return;
      setPress({ pending: true, error: null });
      const isCurrent = captureAccountLifetime();
      // A container that failed is stopped and started: the platform refuses to restart it.
      void write(
        candidate.key,
        () =>
          restartMate({
            key: candidate.key,
            projectId: candidate.project.id,
            serviceId,
            status: candidate.service?.status,
          })
            .then(() => {
              if (isCurrent()) {
                setDialog(null);
                setPress(UNPRESSED);
              }
            })
            .catch((cause: unknown) => {
              if (isCurrent()) setPress({ pending: false, error: zeropsErrorMessage(cause) });
              throw cause;
            }),
        refresh,
      );
    },
    [activeOrganization, refresh, restartMate, setDialog, write],
  );

  /** HQ's API, where a Mate's face and its application live (ADR 0002). */
  const hqApi = useCallback(() => {
    if (activeOrganization === null) throw new Error("No organization is open.");
    return accountHqApi(client, activeOrganization.id, officialHq(accountHq));
  }, [accountHq, activeOrganization, client]);

  /**
   * Renames the Mate's project in Zerops: `name` is the Mate's own, its project's is built from it
   * under its application (`renamedProjectName`).
   */
  const rename = useCallback(
    (candidate: ZeropsCandidatePresentation, name: string) => {
      if (activeOrganization === null) return;
      const full = renamedProjectName(candidate.project, name);
      if (full === undefined) return;
      useUnrenamedProjects.getState().drop(candidate.project.id);
      void write(
        candidate.key,
        () =>
          submitZeropsWrite(operations, activeOrganization.id, {
            kind: "rename-project",
            projectId: candidate.project.id,
            name: full,
            from: candidate.project.name,
          }),
        refresh,
      );
    },
    [activeOrganization, operations, refresh, write],
  );

  /** The platform's verbs on a Mate, by the role function it enforces: none for nobody. */
  const platformVerbsOf = useCallback(
    (candidate: ZeropsCandidatePresentation) =>
      viewer === null || user === null
        ? { delete: false, rename: false, assign: false }
        : resolveMateVerbs({ project: candidate.project, viewer }),
    [user, viewer],
  );

  /**
   * Hands a Mate over (guide 0.8, D11), as the account's `assign-mate-owner` operation: a transfer
   * — a Mate has one OWNER (F23, 2026-10-03). The person picked is made its OWNER, then whoever
   * else the project names OWNER has it taken off theirs. The key's grant, not an OWNER, stays. The
   * dialog stays open until the platform answers: a refusal of the first write is said there and
   * nothing changes; one of a later write says the hand over is not complete — the person picked
   * has it, the previous owner still does too. Once anything was written, the access grant reads
   * every project's grants again at once (`grants-written`), so the person who handed the Mate
   * over sees what the platform holds now (F11).
   */
  const assign = useCallback(
    (candidate: ZeropsCandidatePresentation, clientUserId: string) => {
      if (activeOrganization === null) return;
      const isCurrent = captureAccountLifetime();
      setPress({ pending: true, error: null });
      void operations
        .submit({
          kind: "assign-mate-owner",
          orgId: activeOrganization.id,
          projectId: candidate.project.id,
          clientUserId,
        })
        .then(({ progress, evidence }) => {
          if (!isCurrent()) return;
          const trouble = writeTrouble(progress, evidence);
          // Something may have been written: the grants are read again.
          if (progress.stage === "done" || progress.stage === "unresolved")
            invalidateZerops({ topic: "access", change: "grants-written" });
          if (trouble !== null) setPress({ pending: false, error: trouble });
          else setDialog(null);
        });
    },
    [activeOrganization, operations, setDialog],
  );

  /**
   * The renames Zerops has not taken after a move, by project (`unrenamedProjects.ts`): HQ has the
   * Mate in its new application, its project still carries the old name. Finished by *Finish
   * renaming*, with the targets planned before the move — while the project is named as planned from.
   */
  const unrenamed = useUnrenamedProjects((store) => store.left);
  const renameProjects = useRenameProjects();
  const settleRenames = useCallback(
    async (renames: ReadonlyArray<ProjectRename>, lead: string) => {
      const failures = await renameProjects(renames);
      useUnrenamedProjects.getState().settle(
        renames,
        failures.map(({ rename }) => rename),
      );
      if (failures.length > 0) throw new Error(`${lead}${projectRenameTrouble(failures)}`);
    },
    [renameProjects],
  );

  /**
   * Into another application as what the person picked, a new one made first, or out of all. HQ's
   * move first; then the project is renamed in Zerops, which names it in full after its
   * application (`planProjectMove`), the targets planned before anything is written.
   */
  const move = useCallback(
    (candidate: ZeropsCandidatePresentation, membership: MoveMembership) => {
      const newApp =
        membership.kind === "none"
          ? undefined
          : membership.kind === "new"
            ? membership.name
            : groupTree.groups.find(({ group }) => group.groupId === membership.appId)?.group.name;
      // Whatever a move before left is stale from here: this one plans from the name as it stands.
      useUnrenamedProjects.getState().drop(candidate.project.id);
      const project = { id: candidate.project.id, name: candidate.project.name };
      const oldApp = readZeropsMembership(candidate.project).label;
      const plan =
        membership.kind === "none"
          ? planProjectLeave(project, oldApp)
          : newApp === undefined
            ? []
            : planProjectMove(project, oldApp, newApp);
      void write(
        candidate.key,
        async () => {
          const api = hqApi();
          if (membership.kind === "none") {
            await api.moveProject(candidate.project.id, { appId: null, kind: "mate" });
            await settleRenames(plan, "Left the project, but not renamed in Zerops. ");
            return;
          }
          const appId =
            membership.kind === "new"
              ? (await api.createApp(membership.name)).id
              : membership.appId;
          await api.moveProject(candidate.project.id, {
            appId,
            kind: kindOfRole(membership.role),
          });
          await settleRenames(plan, "Moved, but not renamed in Zerops. ");
        },
        refresh,
      );
    },
    [groupTree.groups, hqApi, refresh, settleRenames, write],
  );

  /** Sends the renames a move left, as they were planned. */
  const finishRename = useCallback(
    (candidate: ZeropsCandidatePresentation) => {
      const left = renameStillDue(unrenamed.get(candidate.project.id), candidate.project.name);
      if (left === undefined) return;
      void write(candidate.key, () => settleRenames([left], ""), refresh);
    },
    [refresh, settleRenames, unrenamed, write],
  );

  /**
   * *Finish setup* — the press's own steps on a half-made Mate (`finishMateSetupVerb`): what a
   * colleague's Mate waits on, what a press a closed tab cut short left, a container that never
   * came. Every step is safe to ask again; for a Mate it adopts, which HQ holds no record of, its
   * close-off also lowers a key still at `ADMIN` (`hardenMate`).
   */
  /** HQ holds no record of this Mate, as its structure says once it is known. */
  const recordMissing = useCallback(
    (candidate: ZeropsCandidatePresentation) => hqKnown && heldOf(candidate.project) === "none",
    [hqKnown],
  );
  /**
   * Whether HQ offers the viewer editing the record of a Mate it holds (`edit_mate_record`): the
   * one HQ tells its key's id to, which a widened key's harden narrows.
   */
  const mayEditRecord = useCallback(
    (candidate: ZeropsCandidatePresentation) => {
      const offers = mateOffersOf(candidate.project.id);
      return offers?.held === true && offers.edit.kind === "allowed";
    },
    [mateOffersOf],
  );
  /** Whether HQ offers the viewer writing the record of a Mate it holds none of. */
  const mayCreateRecord = useCallback(
    (candidate: ZeropsCandidatePresentation) => {
      const offers = mateOffersOf(candidate.project.id);
      return offers?.held === false && offers.createRecord.kind === "allowed";
    },
    [mateOffersOf],
  );
  const finishSetupVerbFor = useCallback(
    (candidate: ZeropsCandidatePresentation, tags: ZeropsMembership): string | undefined => {
      // A stage or a production is no Mate: its own setup is finished as its tier
      // (`halfMadeGroupEnvironments`), never as a Mate's.
      if (tags.role === "stage" || tags.role === "prod") return undefined;
      const press = presses.find((entry) => entry.projectId === candidate.project.id);
      // A Mate claimed from the pool is in no group: no registration of its, no container to make.
      const grouped = tags.groupId !== undefined;
      const group = groupTree.groups.find((entry) => entry.group.groupId === tags.groupId)?.group;
      if (grouped && group === undefined) return undefined;
      // Every fact from the platform, so any browser offers it, after a reload too.
      return finishMateSetupVerb({
        registration: grouped
          ? resolveMateRegistration({
              registry: registry.registry,
              projectId: candidate.project.id,
            })
          : "registered",
        containerMissing:
          grouped &&
          mateContainerMissing(
            candidate,
            press !== undefined,
            pressedElsewhere(candidate.project.id),
          ),
        closedOffMissing: candidate.service !== undefined && interrupted.has(candidate.service.id),
        // A press this tab saw stop, or saw end with its registration refused: no press
        // elsewhere is still at it.
        pressStopped:
          press?.state.kind === "failed" || registrationUnfinished(births, candidate.project.id),
        pressedElsewhere: pressedElsewhere(candidate.project.id),
        viewerIsAdder: mateAddedBy(candidate.project, user?.id),
        hasContainer: candidate.service !== undefined,
        writer: writes(orgOffer("create_app")),
        recordMissing: recordMissing(candidate),
        mayCreateRecord: mayCreateRecord(candidate),
        keyWider: keyWiderOf(candidate),
        mayEditRecord: mayEditRecord(candidate),
      });
    },
    [
      births,
      groupTree.groups,
      interrupted,
      mayCreateRecord,
      mayEditRecord,
      orgOffer,
      pressedElsewhere,
      presses,
      recordMissing,
      registry.registry,
      user,
    ],
  );

  const finishSetup = useCallback(
    (candidate: ZeropsCandidatePresentation) => {
      if (activeOrganization === null) return;
      const organizationId = activeOrganization.id;
      const projectId = candidate.project.id;
      const press = readMatePress(projectId);
      const pressStopped = press?.state.kind === "failed";
      // An owner or an admin finishes all of it; the Mate's own adder, its close-off.
      const whole = finishMateSetupScope(orgOffer("create_app").kind === "allowed") === "whole";
      // A Mate HQ holds no record of is adopted, and only then is its key lowered from ADMIN — by
      // the harden itself, which reads its key as it runs; never from a token list read on a load
      // (step A, A11). A Mate whose key HQ says reads other projects has its harden too, for
      // whoever HQ tells that key's id, which takes those grants off (ADR 0003's fallout).
      const adopting = recordMissing(candidate) && mayCreateRecord(candidate);
      const keyWider = keyWiderOf(candidate) && mayEditRecord(candidate);
      // What it registers, by the rule Set up Mate registers by: in the application HQ or the
      // press this tab holds places it in, under that face; a new Mate in no application
      // only where neither does — the stand-up asked by whoever finishes a Mate its press made.
      const registration = mateFinishRegistration({
        hq: officialHq(accountHq),
        hqKnown,
        structure: hqStructure?.structure ?? null,
        project: candidate.project,
        press,
        writer: whole,
        mayCreateRecord: mayCreateRecord(candidate),
        standUp: candidate.service !== undefined && interrupted.has(candidate.service.id),
        candidates,
      });
      // A close-off alone has nothing to finish on a Mate with no container.
      if (!whole && !adopting && registration === null && candidate.service === undefined) {
        return;
      }
      // A container only where its project has none and no press elsewhere may still be importing
      // one (`finishSetupContainer`).
      const container = whole
        ? finishSetupContainer({
            containerMissing: candidate.missingContainer === true,
            pressStopped,
            pressedElsewhere: pressedElsewhere(candidate.project.id),
          })
        : null;
      // Its row says it runs and ends (`finishSetupRowLine`), on any screen; its view draws the
      // steps while a container comes up (`finishSetupView`). Only then is it coming.
      beginPress({
        projectId,
        organizationId,
        startedAt: Date.now(),
        // Still placed by the press it was made by, so a Finish setup asked again finishes it there.
        placement: matePressPlacement(press) ?? null,
        container: container !== null,
        finishing: true,
      });
      void write(
        candidate.key,
        async () => {
          const finished = await finishMateSetup({
            inputs: { client, operations, organizationId },
            projectId,
            projectName: candidate.project.name,
            container,
            harden: adopting || keyWider,
            keyWider,
            registration,
            hq: accountHq.hq.kind === "official" ? accountHq.hq : null,
            isCurrent: captureAccountLifetime(),
            // A Mate this tab made: its registration's own step follows this one.
            onProgress: (progress) => refinishNewProjectBirth(projectId, progress),
          });
          if (!finished.ok) throw new Error(finished.error);
        },
        refresh,
      );
    },
    [
      accountHq,
      activeOrganization,
      candidates,
      client,
      hqKnown,
      hqStructure?.structure,
      interrupted,
      mayCreateRecord,
      mayEditRecord,
      operations,
      orgOffer,
      pressedElsewhere,
      recordMissing,
      refresh,
      write,
    ],
  );

  /** Whose Mate it is, where that is a colleague: "Ada's Mate", as its row says it. */
  const colleagueOf = useCallback(
    (candidate: ZeropsCandidatePresentation): string | undefined => {
      const owner = resolveMateOwnerPerson({ project: candidate.project, people });
      return owner === undefined || owner.userId === user?.id ? undefined : owner.name;
    },
    [people, user?.id],
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
      const { groupId } = readZeropsMembership(deleted.project);
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
   * The id of the key a Mate's container holds, as the Mate named it to HQ; none where it named
   * none, or HQ does not say.
   */
  const mateKeyOf = useCallback(
    (projectId: string): Promise<string | null> => hqApi().mateKey(projectId),
    [hqApi],
  );

  /**
   * Deletes the Mate's project, and its key with it — by the id the Mate named to HQ, read before
   * its project goes; none is matched by name (audit K3: a deleted Mate's key was left on the
   * account, and a member holding tokens cannot be taken off the org). Connection demand ends
   * before the delete is sent, while the command follows its process; a refusal restores it.
   * The dialog stays open until the platform answers: a refusal is said there. Once it accepts, the
   * row says *Deleting…* until the listing lets it go, the listing is read again, and nothing this
   * browser remembers of the Mate — its row, its crew, a birth — is left for a reload to paint.
   * After the process finishes, HQ verifies the project is gone and releases its held records.
   * A failed completion stays here for Again; the platform delete is never repeated by that step.
   */
  const deleteMate = useCallback(
    (
      candidate: ZeropsCandidatePresentation,
      cleanup?: {
        readonly keyTokenId: string | null;
        readonly completion: string;
        readonly hqDone: boolean;
      },
    ) => {
      if (activeOrganization === null) return;
      const isCurrent = captureAccountLifetime();
      const clientId = activeOrganization.id;
      const organization = organizationRef(clientId);
      const projectId = candidate.project.id;
      setPress({ pending: true, error: null });
      void (async () => {
        const keyTokenId = cleanup === undefined ? await mateKeyOf(projectId) : cleanup.keyTokenId;
        const completion = cleanup?.completion ?? (await hqApi().prepareProjectDeletion(projectId));
        if (cleanup === undefined) {
          if (!isCurrent()) return;
          const environments = currentAccountEnvironments();
          environments?.setDeleting(projectId, true);
          try {
            await deleteProject(projectId);
          } catch (cause) {
            environments?.setDeleting(projectId, false);
            throw cause;
          }
          if (!isCurrent()) return;
          markMateDeleting(projectId);
          forgetPress(projectId);
          invalidateZerops({ topic: "inventory", organization });
          setDialog({
            kind: "delete",
            candidate,
            cleanup: { keyTokenId, completion, hqDone: false },
          });
        }
        if (!cleanup?.hqDone) {
          await hqApi().completeProjectDeletion(projectId, completion);
          if (!isCurrent()) return;
          setDialog({
            kind: "delete",
            candidate,
            cleanup: { keyTokenId, completion, hqDone: true },
          });
        }
        if (keyTokenId !== null) {
          await client.deleteIntegrationToken({ clientId, tokenId: keyTokenId });
        }
      })().then(
        () => {
          if (!isCurrent()) return;
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
    [
      activeOrganization,
      client,
      deleteProject,
      leaveDeleted,
      mateKeyOf,
      hqApi,
      organizationRef,
      setDialog,
    ],
  );

  /**
   * Writes the Mate's face to HQ, which every surface redraws from once its stream says so. The
   * dialog stays open until HQ answers: a refusal is said there, and nothing changes.
   */
  const saveFace = useCallback(
    (candidate: ZeropsCandidatePresentation, face: ZeropsMateFace) => {
      const isCurrent = captureAccountLifetime();
      setPress({ pending: true, error: null });
      Promise.resolve()
        .then(() =>
          hqApi().updateMate(candidate.project.id, {
            face: changedMateFace(readZeropsMembership(candidate.project).face, face),
          }),
        )
        .then(
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
    [hqApi, setDialog],
  );

  const changeFace = useCallback(
    (candidate: ZeropsCandidatePresentation): (() => void) | undefined => {
      if (!changeFaceOffered({ candidate, mayEdit: hqVerbsOf(candidate).edit === "offered" })) {
        return undefined;
      }
      return () => {
        setPress(UNPRESSED);
        setDialog({ kind: "face", candidate });
      };
    },
    [hqVerbsOf, setDialog],
  );

  const actionsFor = useCallback(
    (
      candidate: ZeropsCandidatePresentation,
      tags: ZeropsMembership,
      extraQuick: ReadonlyArray<ZeropsMenuEntry> = [],
    ): ReadonlyArray<ZeropsMenuEntry> => {
      // The platform's own verbs — delete, rename, hand over — by the role function the platform
      // enforces; HQ's by HQ's rule. Either way, a person the session does not name is offered none.
      const platformVerbs = platformVerbsOf(candidate);
      const hqVerbs = hqVerbsOf(candidate);
      const deletable = deleteMateOffered({
        candidate,
        mayDelete: platformVerbs.delete,
        deleting: mateDeleting(candidate.project, deleting),
      });
      const openFace = changeFace(candidate);
      const input = rowInputFor(candidate);
      const rowAction = deriveZeropsRowAction(input);
      const restartAction = deriveZeropsRestartAction(input);
      const finishSetupLabel = finishSetupVerbFor(candidate, tags);
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
          onSelect: () => {
            setPress(UNPRESSED);
            setDialog({ kind: "restart", candidate });
          },
        });
      }
      quick.push(...extraQuick);
      return [
        ...quick,
        ...(quick.length > 0 ? [{ id: "quick", separator: true } as const] : []),
        ...(platformVerbs.rename
          ? [
              {
                id: "rename-agent",
                label: "Rename Mate",
                onSelect: () => setDialog({ kind: "rename", candidate }),
              },
            ]
          : []),
        ...(openFace !== undefined
          ? [{ id: "face", label: CHANGE_FACE_VERB, onSelect: openFace }]
          : hqVerbs.edit === "held" && changeFaceOffered({ candidate, mayEdit: true })
            ? [{ id: "face", label: CHANGE_FACE_VERB, disabled: true, onSelect: () => {} }]
            : []),
        ...(finishSetupLabel === undefined
          ? []
          : [
              {
                id: "finish-setup",
                label: finishSetupLabel,
                ...(keyWiderOf(candidate) && mayEditRecord(candidate)
                  ? { why: KEY_WIDER_WHY }
                  : {}),
                disabled:
                  busy ||
                  finishSetupRunning(
                    presses.find((press) => press.projectId === candidate.project.id),
                  ),
                onSelect: () => finishSetup(candidate),
              },
            ]),
        ...(platformVerbs.assign
          ? [
              {
                id: "assign",
                label: "Hand this Mate over",
                onSelect: () => {
                  setPress(UNPRESSED);
                  setDialog({ kind: "assign", candidate });
                },
              },
            ]
          : []),
        ...(hqVerbs.move !== "no"
          ? [
              {
                id: "move",
                label: tags.groupId === undefined ? "Move to a project" : "Change project or role",
                disabled: hqVerbs.move === "held",
                onSelect: () => {
                  setPress(UNPRESSED);
                  if (askMoveOffers === undefined) return;
                  // Where it may go is asked as the move opens; HQ not answering opens nothing.
                  askMoveOffers(candidate.project.id).then(
                    (moveTo) => setDialog({ kind: "move", candidate, moveTo }),
                    () => undefined,
                  );
                },
              },
            ]
          : []),
        ...(renameStillDue(unrenamed.get(candidate.project.id), candidate.project.name) !==
        undefined
          ? [
              {
                id: "finish-rename",
                label: "Finish renaming in Zerops",
                disabled: busy,
                onSelect: () => finishRename(candidate),
              },
            ]
          : []),
        ...(hqVerbs.leave !== "no" && tags.groupId !== undefined
          ? [
              {
                id: "leave",
                label: "Leave the project",
                disabled: busy || hqVerbs.leave === "held",
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
                label: deleteMateVerb(projectNameInApp(candidate.project)),
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
      finishRename,
      unrenamed,
      finishSetup,
      finishSetupVerbFor,
      mayEditRecord,
      presses,
      rowInputFor,
      serverVersions,
      setDialog,
      start,
      hqVerbsOf,
      platformVerbsOf,
    ],
  );

  const renameInPlace = useCallback(
    (candidate: ZeropsCandidatePresentation): MateRenameInPlace | undefined => {
      if (!platformVerbsOf(candidate).rename) return undefined;
      const current = projectNameInApp(candidate.project);
      return {
        initialValue: current,
        validate: (value) =>
          validateBotName(value, taken, {
            current,
            appName: readZeropsMembership(candidate.project).label,
          }),
        commit: (value) => {
          rename(candidate, value.replace(/\s+/g, " ").trim());
        },
      };
    },
    [platformVerbsOf, rename, taken],
  );

  const close = useCallback(() => setDialog(null), [setDialog]);
  const dialogs = (
    <>
      {dialog?.kind === "restart" ? (
        <RestartMateConfirmation
          projectId={dialog.candidate.project.id}
          name={projectNameInApp(dialog.candidate.project)}
          environmentId={dialog.candidate.environmentId ?? linkTarget(dialog.candidate)}
          pending={press.pending}
          error={press.error}
          onCancel={close}
          onConfirm={() => {
            restart(dialog.candidate);
          }}
        />
      ) : null}
      {dialog?.kind === "rename" ? (
        <ZeropsRenameDialog
          initialValue={projectNameInApp(dialog.candidate.project)}
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
          title={`Rename ${projectNameInApp(dialog.candidate.project)}`}
          validate={(value) =>
            validateBotName(value, taken, {
              current: projectNameInApp(dialog.candidate.project),
              appName: readZeropsMembership(dialog.candidate.project).label,
            })
          }
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
          name={projectNameInApp(dialog.candidate.project)}
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
          error={press.error}
          key={`assign:${dialog.candidate.key}`}
          members={members}
          readingOrganization={
            membersStatus === "loading" && members.length === 0
              ? activeOrganization?.name
              : undefined
          }
          readFailed={
            membersStatus === "failed" && members.length === 0 && activeOrganization !== null
              ? { organization: activeOrganization.name, onReadAgain: accountHq.reread }
              : undefined
          }
          onCancel={close}
          onOpenChange={(open) => {
            if (!open) close();
          }}
          onSubmit={(clientUserId) => {
            assign(dialog.candidate, clientUserId);
          }}
          pending={press.pending}
          projectName={projectNameInApp(dialog.candidate.project)}
        />
      ) : null}
      {dialog?.kind === "move" ? (
        <ZeropsMoveToGroupDialog
          currentGroupId={readZeropsMembership(dialog.candidate.project).groupId}
          currentRole={readZeropsMembership(dialog.candidate.project).role}
          choices={moveChoicesFor(dialog.candidate, dialog.moveTo)}
          key={`move:${dialog.candidate.key}`}
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
          name={projectNameInApp(dialog.candidate.project)}
        />
      ) : null}
      {dialog?.kind === "delete" ? (
        <ZeropsDeleteMateDialog
          error={press.error}
          cleanup={dialog.cleanup !== undefined}
          key={`delete:${dialog.candidate.key}`}
          name={projectNameInApp(dialog.candidate.project)}
          onCancel={close}
          onConfirm={() => {
            deleteMate(dialog.candidate, dialog.cleanup);
          }}
          onOpenChange={(open) => {
            if (!open) close();
          }}
          open
          pending={press.pending}
          words={deleteMateWords({
            name: projectNameInApp(dialog.candidate.project),
            environment: projectNameInApp(dialog.candidate.project),
            services: deleteMateServiceCount(dialog.candidate),
            owner: colleagueOf(dialog.candidate),
          })}
        />
      ) : null}
    </>
  );

  return { actionsFor, dialogs, busyKey, trouble, renameInPlace, changeFace };
}

/**
 * Whether a Mate's container never came: a read of its project's services shows no zcp
 * (`missingContainer`) — services not read yet, or unreadable, are unknown, never missing — and no
 * press — this tab's, or one another browser holds at HQ (`pressElsewhere`) — is importing one:
 * importing one again would make a second.
 */
export function mateContainerMissing(
  candidate: Pick<ZeropsCandidatePresentation, "missingContainer">,
  pressedHere: boolean,
  pressedElsewhere: boolean,
): boolean {
  return candidate.missingContainer === true && !pressedHere && !pressedElsewhere;
}

/**
 * Whether the viewer added this Mate: HQ's record names them as its maker (New project or Add a
 * Mate), its stand-up was asked for by them, or its seat is theirs — as HQ's record of it says.
 */
export function mateAddedBy(
  project: { readonly hq?: HqPlacement | undefined },
  viewer: string | undefined,
): boolean {
  if (viewer === undefined || viewer.length === 0) return false;
  const membership = readZeropsMembership(project);
  return (
    membership.madeBy === viewer ||
    membership.standUp?.by === viewer ||
    mateIsViewers(project, viewer)
  );
}
