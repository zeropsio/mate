import { MateRestartError } from "./mateRestartRefusal";
import { faceAction, NO_FACE_ACTION } from "@t3tools/client-runtime/data";
/**
 * What can be done to a Mate, from wherever a Mate is listed.
 *
 * Eight verbs — *Start*, *Restart*, *Rename Mate*, *Change face…*,
 * *Hand over this Mate*, *Change project or role*, *Leave the project*,
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
import { RegistryContext, useAtomValue } from "@effect/atom-react";
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
  type ZeropsMembership,
  type ZeropsMateFace,
} from "@t3tools/client-runtime/zerops";
import { candidatesComplete, heldCandidates } from "@t3tools/client-runtime/zerops/projections";
import { zeropsErrorMessage } from "@t3tools/client-runtime/zerops/errors";
import { heldOf } from "@t3tools/client-runtime/zerops/hq";
import { resolveMateVerbs } from "@t3tools/client-runtime/zerops/mateAccess";
import { handsOverMates, isMateKind } from "@t3tools/shared/zeropsRoles";
import { useRouter } from "@tanstack/react-router";
import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { MateDeployConfirmation } from "./MateDeployConfirmation";
import { useMateComingOf } from "./useMenuMateReadings";
import { RestartMateConfirmation } from "./RestartMateConfirmation";
import type { HqMoveTo, HqOfferState } from "@t3tools/shared/hqOffers";
import { useMateOffers, useOrgOffers } from "./useHqOffers";
import { useAccountDataOptional, useDetailDemand } from "./ZeropsAccountData";
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
  applicationHoldings,
  deleteApplicationWords,
  lastMateDeletionTarget,
  type DeleteApplicationTarget,
} from "../components/zerops/ZeropsDeleteApplicationDialog.logic";
import { useDeleteApplicationDialog } from "./deleteApplicationDialog";
import { useHqAppDetail } from "./useHqAppDetail";
import {
  deleteMateOffered,
  deleteMateServiceCount,
  deleteMateVerb,
  deleteMateWords,
  landingAfterDelete,
} from "../components/zerops/ZeropsDeleteMateDialog.logic";
import { ZeropsMoveToGroupDialog } from "../components/zerops/ZeropsMoveToGroupDialog";
import { ZeropsProjectAccessDialog } from "../components/zerops/ZeropsProjectAccessDialog";
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
import {
  initialStream,
  organizationMembers,
  shownHqProjectPeopleAtom,
  shownMateVisibilitiesAtom,
  type MembersRead,
} from "@t3tools/client-runtime/data";
import { HAND_OVER_VERB, handOverCandidates } from "./mateHandOver.logic";
import { hqNavigationAtom } from "../state/zerops";
import { invalidateZerops } from "./accountInvalidations";
import {
  deletingMates,
  markMateDeleting,
  mateDeleting,
  settleDeletingMates,
  useDeletingMates,
} from "./deletingMates";
import { configuredHq } from "./accountHq";
import { useProjectDialog } from "./inventoryContext";
import { captureAccountLifetime, currentAccountEpoch } from "./accountLifetime";
import { useOpenMate } from "./useOpenMate";
import { useProjectOrderOptions } from "./projectOrderPreference";
import {
  useTakenBotNames,
  useZeropsDetailCandidates,
  type ZeropsCandidatePresentation,
} from "./useZeropsCandidates";
import { forgetPress } from "./matePress";
import { useRestartMate } from "./mateRestart";
import {
  planProjectLeave,
  planProjectMove,
  projectRenameTrouble,
  renameStillDue,
  type ProjectRename,
} from "./projectRenames.logic";
import { lifecycleRemainders, NO_LIFECYCLE_REMAINDERS } from "@t3tools/client-runtime/data";
import { Atom } from "effect/reactivity";
import { useProjection } from "./ZeropsAccountData";
import { randomUUID } from "~/lib/utils";
import { useRenameProjects } from "./useRenameProjects";
import { useAccountOperations } from "./accountOperations";
import { useZeropsData } from "./zeropsDataContext";
import { submitZeropsWrite, writeTrouble, type ZeropsWrite } from "./zeropsWrite";
import { HQ_HANDOVER_UNFINISHED } from "@t3tools/client-runtime/zerops/hq";
import { useZeropsSession } from "./ZeropsSessionProvider";
import { sharedBirthsAtom, type SharedBirth } from "@t3tools/client-runtime/data";
import { useBirthActions } from "./useBirthActions";
import { useSharedBirths } from "./sharedBirths";

/** Which Mate a dialog is about, and which dialog it is. */
type MateDialog =
  | { readonly kind: "restart"; readonly candidate: ZeropsCandidatePresentation }
  | { readonly kind: "redeploy"; readonly candidate: ZeropsCandidatePresentation }
  | { readonly kind: "rename"; readonly candidate: ZeropsCandidatePresentation }
  | {
      readonly kind: "face";
      readonly candidate: ZeropsCandidatePresentation;
      /** Saved or let go: it closes the way a dialog does, over the face it leaves. */
      readonly closing?: true;
    }
  | { readonly kind: "assign"; readonly candidate: ZeropsCandidatePresentation }
  | { readonly kind: "access"; readonly candidate: ZeropsCandidatePresentation }
  /** Where it may go is HQ's answer as the move opened (`move-offers`), never listed ahead. */
  | {
      readonly kind: "move";
      readonly candidate: ZeropsCandidatePresentation;
      readonly moveTo?: HqMoveTo;
      readonly refused?: import("@t3tools/shared/hqOffers").HqMoveRefusals;
      readonly reading?: boolean;
      readonly readError?: string;
      readonly retryRead?: boolean;
    }
  | {
      readonly kind: "delete";
      readonly candidate: ZeropsCandidatePresentation;
      readonly cleanup?: {
        readonly preparedRequestId: string;
      };
    };

/**
 * Where a dialog's press stands — Delete's or Hand over's: the platform answering
 * it, or why it refused. One dialog is open at a time, and opening one starts it unpressed.
 */
interface DialogPress {
  readonly pending: boolean;
  readonly error: string | null;
}

const NO_REMAINDERS = Atom.make(NO_LIFECYCLE_REMAINDERS);
type FaceRequestIntent = { readonly requestId: string; readonly face: string };
const faceRequests = Atom.family((key: string) =>
  Atom.make<FaceRequestIntent | null>(null).pipe(
    Atom.keepAlive,
    Atom.withLabel(`face-intent:${key}`),
  ),
);
const NO_FACE_REQUEST = Atom.make<FaceRequestIntent | null>(null);
const EMPTY_FACE_ACTION = Atom.make(NO_FACE_ACTION);
const UNPRESSED: DialogPress = { pending: false, error: null };
const UNREAD_MEMBERS = Atom.make<MembersRead>({
  fact: { kind: "unknown" },
  coverage: "unknown",
  stream: initialStream({ parent: null, mode: "sampled" }),
  link: null,
  members: [],
  status: "loading",
  settled: false,
  refused: false,
});

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
  readonly birthFor: (birthId: string) => SharedBirth | undefined;
  readonly birthForProject: (projectId: string) => SharedBirth | undefined;
  readonly birthActionsFor: (birthId: string) => ReadonlyArray<ZeropsMenuEntry>;
  /** Mounted once by the caller: rename, hand over, move. */
  readonly dialogs: ReactNode;
  /**
   * Opens the Mate's hand-over, for a surface that places the verb itself (a Mate whose key Zerops
   * refused): `undefined` where HQ does not say this person may hand it over.
   */
  readonly handOver: (candidate: ZeropsCandidatePresentation) => (() => void) | undefined;
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
  /** The shared birth whose Continue runs from here, so its page says so until its Mate's view takes over. */
  readonly continuingBirth: string | null;
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
  /** `candidate.key → "0.11.25"`, from `useZeropsContainers`. */
  readonly serverVersions: ReadonlyMap<string, string>;
}

/** A verb of HQ's on a Mate: offered, held while HQ has not said or does not answer, or not drawn. */
type HqVerb = "offered" | "held" | "no";

export function useMateActions({ serverVersions }: MateActionsInput): MateActions {
  const { activeOrganization, user } = useZeropsSession();
  const { organizationRef } = useZeropsData();
  const operations = useAccountOperations();
  const atomRegistry = useContext(RegistryContext);
  const births = useSharedBirths();
  const birthActions = useBirthActions(births);
  const { listing, refresh } = useZeropsDetailCandidates();
  const candidates = useMemo(() => heldCandidates(listing).rows, [listing]);
  const comingOf = useMateComingOf(candidates);
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
  const [deletingBirth, setDeletingBirth] = useState<{
    readonly birthId: string;
    readonly orgId: string;
    readonly projectId: string | null;
    readonly adopted?: true;
    readonly name: string;
    readonly environment: string;
    readonly cleanup?: { readonly preparedRequestId: string };
  } | null>(null);
  // A dialog holds its Mate's project as it opened: it closes once the grant withholds it.
  const [dialog, setDialog, captureDialogReply] = useProjectDialog(
    (open: MateDialog) => open.candidate.project.id,
  );
  const faceRequest = useAtomValue(
    dialog?.kind === "face" && activeOrganization !== null
      ? faceRequests(
          JSON.stringify([
            currentAccountEpoch(),
            activeOrganization.id,
            dialog.candidate.project.id,
          ]),
        )
      : NO_FACE_REQUEST,
  );
  const facePress = useProjection(faceAction, faceRequest?.requestId ?? null, EMPTY_FACE_ACTION);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [trouble, setTrouble] = useState<string | null>(null);
  const [continuingBirth, setContinuingBirth] = useState<string | null>(null);
  const writing = useRef(new Set<string>());
  const moveAttempts = useRef(
    new Map<
      string,
      {
        readonly requestId: string;
        readonly intent: import("@t3tools/client-runtime/data").MoveProjectIntent;
      }
    >(),
  );
  const appAttempts = useRef(
    new Map<string, { readonly requestId: string; readonly name: string }>(),
  );
  const deletionRequests = useRef(new Map<string, string>());
  const choiceRead = useRef({ orgId: activeOrganization?.id, attempt: 0 });
  useEffect(() => {
    if (choiceRead.current.orgId === activeOrganization?.id) return;
    choiceRead.current = { orgId: activeOrganization?.id, attempt: choiceRead.current.attempt + 1 };
  }, [activeOrganization?.id]);
  // The same preference the projects screen's sort control writes — the
  // "move to" dialog's group choices should read the way the person set up
  // their own list, not a fixed order of their own.
  const projectOrder = useProjectOrderOptions();

  const hqStructure = useAtomValue(hqNavigationAtom);
  const projectPeople = useAtomValue(shownHqProjectPeopleAtom);
  // Each Mate's visibility for the person, as the account reads it from live Zerops data
  // (`mateVisibility`); one not judged yet is absent.
  const visibilities = useAtomValue(
    shownMateVisibilitiesAtom(candidates.map((candidate) => candidate.project.id).join(",")),
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
  const handsOver = handsOverMates(viewer ?? undefined);
  /** What is offered of each project and of the organization: drawn here, decided from Zerops roles. */
  const mateOffersOf = useMateOffers();
  const orgOffer = useOrgOffers();
  /**
   * The project a Mate's Delete may delete too (app-lifecycle.md): its own, where it is the last
   * Mate listed or coming in it and the person may delete the project.
   */
  const lastMateApplication = useCallback(
    (candidate: ZeropsCandidatePresentation): DeleteApplicationTarget | undefined => {
      if (orgOffer("delete_app").kind !== "allowed") return undefined;
      const { groupId } = readZeropsMembership(candidate.project);
      const entry = groupTree.groups.find(({ group }) => group.groupId === groupId);
      if (entry === undefined || entry.group.pending.some((member) => member.kind === "mate"))
        return undefined;
      const mates = entry.environments.filter(({ item }) => hasMate(item));
      if (mates.length !== 1 || mates[0]!.item.project.id !== candidate.project.id)
        return undefined;
      const app =
        hqStructure.orgId === activeOrganization?.id
          ? hqStructure.structure?.apps.find(({ id }) => id === groupId)
          : undefined;
      return lastMateDeletionTarget(
        entry.environments.map(({ item }) => item.project),
        {
          id: entry.group.groupId,
          name: entry.group.name,
          ...(app?.environments === undefined ? {} : { environments: app.environments }),
        },
      );
    },
    [activeOrganization?.id, groupTree.groups, hqStructure, orgOffer],
  );
  /**
   * Where a Mate may be moved, as HQ answered when the move opened (`moveTo`) and as it offers its
   * leaving (`detach`): each application listed, a new one, or none.
   */
  const moveChoicesFor = useCallback(
    (
      candidate: ZeropsCandidatePresentation,
      moveTo: HqMoveTo,
      refused?: import("@t3tools/shared/hqOffers").HqMoveRefusals,
    ) => {
      const offers = mateOffersOf(candidate.project.id);
      return moveChoices({
        moveTo,
        refused,
        detach: offers?.held === true && offers.detach.kind === "allowed",
        apps: groupTree.groups.map(({ group }) => ({ id: group.groupId, name: group.name })),
      });
    },
    [groupTree.groups, mateOffersOf],
  );
  const askMoveOffers = useAccountDataOptional()?.moveOffers;
  const askMove = useCallback(
    (candidate: ZeropsCandidatePresentation) => {
      const isCurrent = captureAccountLifetime();
      const attempt = ++choiceRead.current.attempt;
      setPress(UNPRESSED);
      setDialog({ kind: "move", candidate, reading: true });
      const replyToDialog = captureDialogReply();
      const settle = (
        answer: Pick<
          Extract<MateDialog, { kind: "move" }>,
          "moveTo" | "refused" | "readError" | "retryRead"
        >,
      ) => {
        if (!isCurrent() || attempt !== choiceRead.current.attempt) return;
        replyToDialog({ kind: "move", candidate, ...answer });
      };
      if (askMoveOffers === undefined) {
        settle({ readError: "HQ is not available to read destinations.", retryRead: true });
        return;
      }
      askMoveOffers(candidate.project.id).then(
        (offers) => settle(offers),
        (fault: unknown) =>
          settle({ readError: zeropsErrorMessage(fault), retryRead: !definitiveRefusal(fault) }),
      );
    },
    [askMoveOffers, setDialog, captureDialogReply],
  );
  /**
   * HQ's verbs on a Mate, as HQ offers them: its record, and its place among projects — each
   * offered; held while HQ has not said or does not answer (drawn, and not pressable); not drawn
   * where HQ refuses it. None on a Mate HQ holds no record of.
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
  const account = useAccountDataOptional();
  // Whom a Mate may be handed to: the organization's members as Zerops answers the person's own
  // read, demanded while its picker is open. HQ alone decides who may hand over, and to whom.
  const handingOver = dialog?.kind === "assign" ? activeOrganization : null;
  useDetailDemand("organizationMembers", undefined, handingOver?.id ?? null);
  const members = useProjection(
    organizationMembers,
    handingOver === null ? null : { orgId: handingOver.id, clientId: handingOver.id },
    UNREAD_MEMBERS,
  );

  /** One write, with its busy key and its refusal, wherever it came from. */
  const write = useCallback(
    async (
      key: string,
      run: () => Promise<unknown>,
      after?: () => void,
      refused?: (reason: string) => void,
    ) => {
      if (activeOrganization === null) return;
      const isCurrent = captureAccountLifetime();
      if (!isCurrent() || writing.current.has(key)) return;
      writing.current.add(key);
      setBusyKey(key);
      setTrouble(null);
      try {
        await run();
        if (isCurrent()) after?.();
      } catch (cause) {
        if (isCurrent()) {
          const reason = zeropsErrorMessage(cause);
          setTrouble(reason);
          refused?.(reason);
        }
      } finally {
        writing.current.delete(key);
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
      const visibility = visibilities[candidate.project.id];
      return {
        candidate,
        coming: comingOf(candidate),
        health: undefined,
        waiting: false,
        can: mateRowCan(mateOffersOf(candidate.project.id)),
        ...(visibility === undefined ? {} : { visibility }),
      };
    },
    [comingOf, mateOffersOf, visibilities],
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
  const restart = useCallback(
    (candidate: ZeropsCandidatePresentation) => {
      const serviceId = candidate.service?.id;
      if (activeOrganization === null || serviceId === undefined) return;
      const isCurrent = captureAccountLifetime();
      const replyToDialog = captureDialogReply();
      void restartMate({
        key: candidate.key,
        projectId: candidate.project.id,
        serviceId,
        status: candidate.service?.status,
      }).then(
        () => {
          if (isCurrent()) {
            replyToDialog(null);
            refresh();
          }
        },
        (cause: unknown) => {
          // Receipt guidance belongs to the retained recovery outcome, including after close.
          if (!(cause instanceof MateRestartError) && isCurrent())
            setPress({ pending: false, error: zeropsErrorMessage(cause) });
        },
      );
    },
    [activeOrganization, refresh, restartMate, captureDialogReply],
  );

  /**
   * Renames the Mate's project in Zerops: `name` is the Mate's own, its project's is built from it
   * under its application (`renamedProjectName`).
   */
  const rename = useCallback(
    (candidate: ZeropsCandidatePresentation, name: string) => {
      if (activeOrganization === null || writing.current.has(candidate.key)) return;
      const full = renamedProjectName(candidate.project, name);
      if (full === undefined) return;
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
        ? { delete: false, rename: false }
        : resolveMateVerbs({ project: candidate.project, viewer }),
    [user, viewer],
  );

  /**
   * Hands a Mate over, as the account's `hand-over-mate` operation: one HQ call with the person's
   * own token, which moves its project's `OWNER` override to the person picked and replaces its key.
   * The dialog stays open until HQ answers: a refusal, or the phase a stop part way names, is said
   * there, and Hand it over asks again (HQ finishes what it started). Wherever something may have
   * been written, the access grant reads every project's grants again at once (`grants-written`),
   * so the person who handed the Mate over sees what the platform holds now (F11).
   */
  const assign = useCallback(
    (candidate: ZeropsCandidatePresentation, ownerUserId: string) => {
      if (activeOrganization === null) return;
      const isCurrent = captureAccountLifetime();
      const replyToDialog = captureDialogReply();
      if (!isCurrent() || writing.current.has(candidate.key)) return;
      writing.current.add(candidate.key);
      setBusyKey(candidate.key);
      setPress({ pending: true, error: null });
      void operations
        .submit({
          kind: "hand-over-mate",
          orgId: activeOrganization.id,
          projectId: candidate.project.id,
          ownerUserId,
        })
        .then(
          ({ progress, evidence }) => {
            if (!isCurrent()) return;
            const trouble = writeTrouble(progress, evidence);
            if (
              progress.stage === "done" ||
              progress.stage === "unresolved" ||
              progress.stage === "uncertain" ||
              (progress.stage === "refused" && progress.code === HQ_HANDOVER_UNFINISHED)
            )
              invalidateZerops({ topic: "access", change: "grants-written" });
            if (trouble !== null) setPress({ pending: false, error: trouble });
            else replyToDialog(null);
          },
          (cause: unknown) => {
            if (isCurrent()) setPress({ pending: false, error: zeropsErrorMessage(cause) });
          },
        )
        .finally(() => {
          writing.current.delete(candidate.key);
          if (isCurrent()) setBusyKey(null);
        });
    },
    [activeOrganization, operations, captureDialogReply],
  );

  /** Opens a Mate's hand-over for an owner or admin of the organization (`handsOverMates`). */
  const handOver = useCallback(
    (candidate: ZeropsCandidatePresentation): (() => void) | undefined => {
      if (busyKey === candidate.key || !handsOver) return undefined;
      return () => {
        setPress(UNPRESSED);
        setDialog({ kind: "assign", candidate });
      };
    },
    [busyKey, handsOver, setDialog],
  );

  /**
   * The renames Zerops has not taken after a move, by the original HQ receipt: HQ has the
   * Mate in its new application, its project still carries the old name. Finished by *Finish
   * renaming*, with the targets planned before the move — while the project is named as planned from.
   */
  const remainders = useProjection(
    lifecycleRemainders,
    activeOrganization === null
      ? null
      : { orgId: activeOrganization.id, hqProjectId: configuredHq().projectId },
    NO_REMAINDERS,
  );
  const unrenamed = remainders.renames;
  const remaindersEpoch = currentAccountEpoch();
  const renameProjects = useRenameProjects();
  const settleRenames = useCallback(
    async (renames: ReadonlyArray<ProjectRename>, lead: string) => {
      const isCurrent = captureAccountLifetime();
      const failures = await renameProjects(renames);
      if (!isCurrent()) return;
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
      if (activeOrganization === null || writing.current.has(candidate.key)) return;
      const isCurrent = captureAccountLifetime();
      const replyToDialog = captureDialogReply();
      setPress({ pending: true, error: null });
      const newApp =
        membership.kind === "none"
          ? undefined
          : membership.kind === "new"
            ? membership.name
            : groupTree.groups.find(({ group }) => group.groupId === membership.appId)?.group.name;
      const project = { id: candidate.project.id, name: candidate.project.name };
      const oldApp = readZeropsMembership(candidate.project).label;
      const plan =
        membership.kind === "none"
          ? planProjectLeave(project, oldApp)
          : newApp === undefined
            ? []
            : planProjectMove(project, oldApp, newApp);
      let placed = false;
      void write(
        candidate.key,
        async () => {
          const hq = configuredHq();
          if (membership.kind === "new") {
            const previous = appAttempts.current.get(candidate.project.id);
            if (previous !== undefined && previous.name !== membership.name)
              throw new Error(
                "Check the original project creation before choosing another destination.",
              );
            if (previous === undefined)
              appAttempts.current.set(candidate.project.id, {
                requestId: randomUUID(),
                name: membership.name,
              });
          }
          const appId =
            membership.kind === "none"
              ? null
              : membership.kind === "new"
                ? (
                    await operations.run(
                      { kind: "create-app", orgId: activeOrganization.id, name: membership.name },
                      {
                        orgId: activeOrganization.id,
                        requestId: appAttempts.current.get(candidate.project.id)!.requestId,
                        unobserved:
                          "HQ may have created the project. Check it before starting another Move.",
                      },
                    )
                  ).appId
                : membership.appId;
          if (!isCurrent()) return;
          const requestId =
            moveAttempts.current.get(candidate.project.id)?.requestId ?? randomUUID();
          const held = heldOf(candidate.project);
          if (held === "unknown")
            throw new Error("HQ must read this Mate’s placement before Move.");
          if (held === "plain") throw new Error("HQ does not offer moving this project.");
          const intent = moveAttempts.current.get(candidate.project.id)?.intent ?? {
            kind: "move-project" as const,
            orgId: activeOrganization.id,
            hqProjectId: hq.projectId,
            projectId: candidate.project.id,
            from: {
              appId: readZeropsMembership(candidate.project).groupId ?? null,
              kind: held === "none" ? "mate" : held,
            },
            to: { appId, kind: membership.kind === "none" ? "mate" : kindOfRole(membership.role) },
            rename: { from: project.name, name: plan[0]?.to ?? project.name },
          };
          moveAttempts.current.set(candidate.project.id, { requestId, intent });
          await operations.run(intent, {
            orgId: activeOrganization.id,
            requestId,
            unobserved:
              "HQ may have taken this Move. Read its original receipt before moving again.",
          });
          placed = true;
          moveAttempts.current.delete(candidate.project.id);
          appAttempts.current.delete(candidate.project.id);
          if (!isCurrent()) return;
          const remainder = await operations.untilMoveRemainder({
            orgId: intent.orgId,
            hqProjectId: intent.hqProjectId,
            requestId,
          });
          if (!isCurrent()) return;
          if (remainder.kind === "rename")
            await settleRenames(
              [{ projectId: remainder.projectId, from: remainder.from, to: remainder.name }],
              "Moved, but not renamed in Zerops. ",
            );
        },
        () => {
          setPress(UNPRESSED);
          replyToDialog(null);
          refresh();
        },
        (reason) => {
          setPress({ pending: false, error: reason });
          const attempt = moveAttempts.current.get(candidate.project.id);
          if (
            attempt !== undefined &&
            operations.readProgress(attempt.requestId).stage === "refused"
          )
            moveAttempts.current.delete(candidate.project.id);
          // Placement already landed: Finish renaming owns the remainder, never another Move.
          if (placed) replyToDialog(null);
        },
      );
    },
    [
      activeOrganization,
      groupTree.groups,
      operations,
      refresh,
      captureDialogReply,
      settleRenames,
      write,
    ],
  );

  /** Sends the renames a move left, as they were planned. */
  const finishRename = useCallback(
    (candidate: ZeropsCandidatePresentation) => {
      if (currentAccountEpoch() !== remaindersEpoch) return;
      const left = renameStillDue(unrenamed.get(candidate.project.id), candidate.project.name);
      if (left === undefined) return;
      void write(candidate.key, () => settleRenames([left], ""), refresh);
    },
    [refresh, remaindersEpoch, settleRenames, unrenamed, write],
  );

  /** Whose Mate it is, where that is a colleague: "Ada's Mate", as its row says it. */
  const colleagueOf = useCallback(
    (candidate: ZeropsCandidatePresentation): string | undefined => {
      const owner = projectPeople[candidate.project.id]?.owner;
      return owner == null || owner.userId === user?.id ? undefined : owner.name;
    },
    [projectPeople, user?.id],
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
            (visibilities[mate.project.id] ?? "open") === "open" &&
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
    [groupTree.groups, linkTarget, openMate, router, visibilities],
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
      candidate: ZeropsCandidatePresentation | undefined,
      cleanup?: {
        readonly preparedRequestId: string;
      },
      /**
       * Its project, where this is its last Mate: deleted too, its own Delete runs once the Mate
       * is gone; kept, that choice answers HQ's question whether to keep the project's Git.
       */
      application?: { readonly target: DeleteApplicationTarget; readonly also: boolean },
      birthTarget?: { readonly birthId: string; readonly projectId: string },
    ) => {
      if (activeOrganization === null) return;
      const projectId = candidate?.project.id ?? birthTarget?.projectId;
      if (projectId === undefined) return;
      const key = candidate?.key ?? `birth:${projectId}`;
      if (writing.current.has(key)) return;
      const isCurrent = captureAccountLifetime();
      const replyToDialog = captureDialogReply();
      if (!isCurrent()) return;
      writing.current.add(key);
      setBusyKey(key);
      const clientId = activeOrganization.id;
      const organization = organizationRef(clientId);
      setPress({ pending: true, error: null });
      const recordCleanup = (preparedRequestId: string) => {
        if (birthTarget !== undefined) {
          setDeletingBirth((open) =>
            open?.birthId === birthTarget.birthId
              ? { ...open, cleanup: { preparedRequestId } }
              : open,
          );
        } else if (candidate !== undefined) {
          replyToDialog({ kind: "delete", candidate, cleanup: { preparedRequestId } });
        }
      };
      void (async () => {
        const hqProjectId = configuredHq().projectId;
        const preparedRequestId =
          cleanup?.preparedRequestId ?? deletionRequests.current.get(projectId) ?? randomUUID();
        deletionRequests.current.set(projectId, preparedRequestId);
        const prepared = await operations.run(
          { kind: "prepare-mate-deletion", orgId: clientId, hqProjectId, projectId },
          {
            orgId: clientId,
            requestId: preparedRequestId,
            unobserved:
              "HQ may have prepared this deletion. Read its original receipt before trying again.",
          },
        );
        const { keyTokenId, completion } = prepared;
        if (!isCurrent()) return;
        if (cleanup === undefined) {
          if (!isCurrent()) return;
          const environments = currentAccountEnvironments();
          environments?.setDeleting(projectId, true);
          try {
            await operations.run(
              { kind: "delete-project", orgId: clientId, projectId },
              {
                orgId: clientId,
                requestId: `${preparedRequestId}:delete`,
                unobserved: "Check the original deletion process before deleting again.",
              },
            );
          } catch (cause) {
            environments?.setDeleting(projectId, false);
            throw cause;
          }
          if (!isCurrent()) return;
          markMateDeleting(projectId);
          forgetPress(projectId);
          invalidateZerops({ topic: "inventory", organization });
          recordCleanup(preparedRequestId);
        }
        {
          if (!isCurrent()) return;
          await operations.run(
            {
              kind: "complete-mate-deletion",
              orgId: clientId,
              hqProjectId,
              projectId,
              preparedRequestId,
              completion,
            },
            {
              orgId: clientId,
              requestId: `${preparedRequestId}:complete`,
              unobserved: "HQ may have completed this deletion. Read its original receipt.",
            },
          );
          if (!isCurrent()) return;
          recordCleanup(preparedRequestId);
        }
        if (keyTokenId !== null) {
          if (!isCurrent()) return;
          await operations.run(
            {
              kind: "retire-mate-key",
              orgId: clientId,
              projectId,
              tokenId: keyTokenId,
              preparedRequestId,
              completionRequestId: `${preparedRequestId}:complete`,
            },
            {
              orgId: clientId,
              requestId: `${preparedRequestId}:retire`,
              unobserved: "Read the original key before trying cleanup again.",
            },
          );
        }
        if (!isCurrent()) return;
        await operations.run(
          {
            kind: "complete-key-retirement",
            orgId: clientId,
            hqProjectId,
            projectId,
            preparedRequestId,
            completionRequestId: `${preparedRequestId}:complete`,
          },
          {
            orgId: clientId,
            requestId: `${preparedRequestId}:retired`,
            unobserved: "HQ must confirm the key cleanup before this deletion is finished.",
          },
        );
        // HQ asks Owners and Admins whether to keep the Git of a project its last Mate left; the
        // person already said keep. An answer HQ does not take leaves the question in the menu.
        if (application !== undefined && !application.also && isCurrent())
          await operations.submit({
            kind: "answer-kept-git",
            orgId: clientId,
            appId: application.target.appId,
            answer: "keep",
          });
      })()
        .finally(() => {
          writing.current.delete(key);
          if (isCurrent()) setBusyKey(null);
        })
        .then(
          () => {
            if (!isCurrent()) return;
            setPress(UNPRESSED);
            if (birthTarget !== undefined) setDeletingBirth(null);
            else replyToDialog(null);
            if (candidate !== undefined) leaveDeleted(candidate);
            if (application?.also === true)
              useDeleteApplicationDialog
                .getState()
                .open({ target: application.target, confirmed: true });
          },
          (cause: unknown) => {
            if (!isCurrent()) return;
            setPress({ pending: false, error: zeropsErrorMessage(cause) });
          },
        );
    },
    [activeOrganization, operations, leaveDeleted, organizationRef, captureDialogReply],
  );

  /**
   * Writes the Mate's face to HQ, which every surface redraws from once its stream says so. The
   * dialog stays open until HQ answers: a refusal is said there, and nothing changes.
   */
  const saveFace = useCallback(
    (candidate: ZeropsCandidatePresentation, face: ZeropsMateFace) => {
      const isCurrent = captureAccountLifetime();
      const replyToDialog = captureDialogReply();
      Promise.resolve()
        .then(() => {
          if (!isCurrent()) return;
          if (activeOrganization === null) throw new Error("Choose an organization first.");
          const value = changedMateFace(readZeropsMembership(candidate.project).face, face);
          const key = JSON.stringify([
            currentAccountEpoch(),
            activeOrganization.id,
            candidate.project.id,
          ]);
          const selected = atomRegistry.get(faceRequests(key));
          const previous =
            selected?.face === value &&
            !["done", "refused"].includes(operations.readProgress(selected.requestId).stage)
              ? selected.requestId
              : undefined;
          const requestId = previous ?? randomUUID();
          atomRegistry.set(faceRequests(key), { requestId, face: value });
          return (async () => {
            if (previous !== undefined) await operations.askAgain(requestId);
            if (!isCurrent()) return;
            await operations.run(
              {
                kind: "update-mate-face",
                orgId: activeOrganization.id,
                projectId: candidate.project.id,
                face: value,
              },
              {
                orgId: activeOrganization.id,
                requestId,
                unobserved: "HQ may have saved the face. Ask HQ again before changing it.",
              },
            );
          })();
        })
        .then(
          () => {
            if (!isCurrent()) return;
            // Still saying Saving… as it fades: the face it saved shows through it.
            replyToDialog({ kind: "face", candidate, closing: true });
          },
          // The face projection retains HQ refusal or the uncertain request for this dialog.
          () => undefined,
        );
    },
    [activeOrganization, atomRegistry, operations, captureDialogReply],
  );

  const changeFace = useCallback(
    (candidate: ZeropsCandidatePresentation): (() => void) | undefined => {
      if (busyKey === candidate.key) return undefined;
      if (!changeFaceOffered({ candidate, mayEdit: hqVerbsOf(candidate).edit === "offered" })) {
        return undefined;
      }
      return () => {
        setPress(UNPRESSED);
        setDialog({ kind: "face", candidate });
      };
    },
    [busyKey, hqVerbsOf, setDialog],
  );

  const birthFor = useCallback((id: string) => births.find((birth) => birth.id === id), [births]);
  const birthForProject = useCallback(
    (id: string) => births.find((birth) => birth.projectId === id),
    [births],
  );
  const birthActionsFor = useCallback(
    (id: string): ReadonlyArray<ZeropsMenuEntry> => {
      const birth = birthFor(id);
      if (birth === undefined) return [];
      const key =
        candidates.find((candidate) => candidate.project.id === birth.projectId)?.key ??
        `birth:${birth.projectId ?? birth.id}`;
      return [
        ...(birth.canContinue
          ? [
              {
                id: "continue",
                label: "Continue",
                disabled: busyKey === key,
                onSelect: () => {
                  setContinuingBirth(birth.id);
                  void write(key, () => birthActions.proceed(birth.id)).finally(() =>
                    setContinuingBirth(null),
                  );
                },
              },
            ]
          : []),
        ...(birth.canDelete
          ? [
              {
                id: "delete",
                label: "Delete",
                variant: "destructive" as const,
                disabled: busyKey === key,
                onSelect: () => {
                  setPress(UNPRESSED);
                  setDeletingBirth({
                    birthId: birth.id,
                    orgId: activeOrganization?.id ?? "",
                    projectId: birth.projectId,
                    ...(birth.adopted === true ? { adopted: true as const } : {}),
                    name: birth.intent?.placement.name ?? "Mate",
                    environment: birth.intent?.projectName ?? "Mate",
                  });
                },
              },
            ]
          : []),
      ];
    },
    [activeOrganization?.id, birthFor, birthActions, busyKey, candidates, write],
  );

  const actionsFor = useCallback(
    (
      candidate: ZeropsCandidatePresentation,
      tags: ZeropsMembership,
      extraQuick: ReadonlyArray<ZeropsMenuEntry> = [],
    ): ReadonlyArray<ZeropsMenuEntry> => {
      const birth = birthForProject(candidate.project.id);
      if (birth !== undefined) return birthActionsFor(birth.id);
      // The platform's own verbs — delete, rename — and HQ's, its hand-over among them, by the
      // person's Zerops roles. Either way, a person the session does not name is offered none.
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
      const serverVersion = serverVersions.get(candidate.key);
      const busy = busyKey === candidate.key;
      const quick: Array<ZeropsMenuEntry> = [];
      if (rowAction.kind === "redeploy") {
        quick.push({
          id: "redeploy",
          label: rowAction.label,
          disabled: busy,
          onSelect: () => setDialog({ kind: "redeploy", candidate }),
        });
      }
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
                disabled: busy,
                onSelect: () => setDialog({ kind: "rename", candidate }),
              },
            ]
          : []),
        ...(openFace !== undefined
          ? [{ id: "face", label: CHANGE_FACE_VERB, disabled: busy, onSelect: openFace }]
          : hqVerbs.edit === "held" && changeFaceOffered({ candidate, mayEdit: true })
            ? [{ id: "face", label: CHANGE_FACE_VERB, disabled: true, onSelect: () => {} }]
            : []),
        ...(handsOver
          ? [
              {
                id: "assign",
                label: HAND_OVER_VERB,
                disabled: busy,
                onSelect: () => {
                  setPress(UNPRESSED);
                  setDialog({ kind: "assign", candidate });
                },
              },
            ]
          : []),
        // Who reaches the Mate's project: anyone may look, an owner or admin changes it there.
        {
          id: "access",
          label: "Project access…",
          disabled: busy,
          onSelect: () => {
            setDialog({ kind: "access", candidate });
          },
        },
        ...(hqVerbs.move !== "no"
          ? [
              {
                id: "move",
                label: tags.groupId === undefined ? "Move to a project" : "Change project or role",
                disabled: busy || hqVerbs.move === "held",
                onSelect: () => askMove(candidate),
              },
            ]
          : []),
        ...(currentAccountEpoch() === remaindersEpoch &&
        renameStillDue(unrenamed.get(candidate.project.id), candidate.project.name) !== undefined
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
                onSelect: () => {
                  setPress(UNPRESSED);
                  setDialog({ kind: "move", candidate, moveTo: {} });
                },
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
      askMove,
      birthActionsFor,
      birthForProject,
      busyKey,
      changeFace,
      deleting,
      finishRename,
      remaindersEpoch,
      unrenamed,
      rowInputFor,
      serverVersions,
      setDialog,
      start,
      hqVerbsOf,
      platformVerbsOf,
      handsOver,
    ],
  );

  const renameInPlace = useCallback(
    (candidate: ZeropsCandidatePresentation): MateRenameInPlace | undefined => {
      if (busyKey === candidate.key || !platformVerbsOf(candidate).rename) return undefined;
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
    [busyKey, platformVerbsOf, rename, taken],
  );

  const close = useCallback(() => {
    choiceRead.current.attempt += 1;
    setDialog(null);
  }, [setDialog]);
  // The last Mate's Delete holds its project's detail: what deleting the project too would take.
  const deletingApplication =
    dialog?.kind === "delete" && dialog.cleanup === undefined
      ? lastMateApplication(dialog.candidate)
      : undefined;
  const deletingApplicationDetail = useHqAppDetail(deletingApplication?.appId ?? null);
  const dialogs = (
    <>
      {dialog?.kind === "redeploy" ? (
        <MateDeployConfirmation candidate={dialog.candidate} onClose={close} />
      ) : null}
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
          error={facePress.error}
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
          pending={facePress.pending}
        />
      ) : null}
      {dialog?.kind === "access" ? (
        <ZeropsProjectAccessDialog
          key={`access:${dialog.candidate.key}`}
          name={projectNameInApp(dialog.candidate.project)}
          onClose={close}
          projectId={dialog.candidate.project.id}
        />
      ) : null}
      {dialog?.kind === "assign" ? (
        <ZeropsAssignMateDialog
          error={press.error}
          key={`assign:${dialog.candidate.key}`}
          candidates={handOverCandidates(members.members)}
          readingOrganization={
            members.status === "loading" && members.members.length === 0
              ? activeOrganization?.name
              : undefined
          }
          readFailed={
            members.status === "failed" && activeOrganization !== null
              ? {
                  organization: activeOrganization.name,
                  onReadAgain: () =>
                    account?.retryDetail({
                      family: "organizationMembers",
                      ownerId: activeOrganization.id,
                    }),
                }
              : undefined
          }
          onCancel={close}
          onOpenChange={(open) => {
            if (!open) close();
          }}
          onSubmit={(ownerUserId) => {
            assign(dialog.candidate, ownerUserId);
          }}
          pending={press.pending}
          projectName={projectNameInApp(dialog.candidate.project)}
        />
      ) : null}
      {dialog?.kind === "move" ? (
        <ZeropsMoveToGroupDialog
          currentGroupId={readZeropsMembership(dialog.candidate.project).groupId}
          currentRole={readZeropsMembership(dialog.candidate.project).role}
          choices={
            dialog.moveTo === undefined
              ? { apps: [], newApp: [], none: false }
              : moveChoicesFor(dialog.candidate, dialog.moveTo, dialog.refused)
          }
          reading={dialog.reading}
          readError={dialog.readError}
          onReadAgain={dialog.retryRead ? () => askMove(dialog.candidate) : undefined}
          pending={press.pending}
          error={press.error}
          key={`move:${dialog.candidate.key}:${dialog.moveTo === undefined ? "reading" : "read"}`}
          onCancel={close}
          onOpenChange={(open) => {
            if (!open) close();
          }}
          onSubmit={(membership) => {
            const { candidate } = dialog;
            move(candidate, membership);
          }}
          open
          name={projectNameInApp(dialog.candidate.project)}
        />
      ) : null}
      {dialog?.kind === "delete" ? (
        <ZeropsDeleteMateDialog
          application={
            deletingApplication === undefined
              ? undefined
              : {
                  name: deletingApplication.name,
                  words: deleteApplicationWords(
                    deletingApplication,
                    applicationHoldings(deletingApplicationDetail),
                  ),
                }
          }
          error={press.error}
          cleanup={dialog.cleanup !== undefined}
          key={`delete:${dialog.candidate.key}`}
          name={projectNameInApp(dialog.candidate.project)}
          onCancel={close}
          onConfirm={(alsoApplication) => {
            deleteMate(
              dialog.candidate,
              dialog.cleanup,
              deletingApplication === undefined
                ? undefined
                : { target: deletingApplication, also: alsoApplication },
            );
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
      {deletingBirth === null ? null : (
        <ZeropsDeleteMateDialog
          error={press.error}
          cleanup={deletingBirth.cleanup !== undefined}
          key={`delete-birth:${deletingBirth.birthId}`}
          name={deletingBirth.name}
          onCancel={() => setDeletingBirth(null)}
          onOpenChange={(open) => {
            if (!open) setDeletingBirth(null);
          }}
          onConfirm={() => {
            const open = deletingBirth;
            if (activeOrganization?.id !== open.orgId || user === null) {
              setPress({ pending: false, error: "This sign-in has changed." });
              return;
            }
            const current = atomRegistry
              .get(sharedBirthsAtom(user.id))
              .open.find((birth) => birth.id === open.birthId);
            if (
              open.cleanup === undefined &&
              (current === undefined ||
                !current.canDelete ||
                current.projectId !== open.projectId ||
                current.adopted !== open.adopted)
            ) {
              setPress({ pending: false, error: "The birth or your access has changed." });
              return;
            }
            if (open.projectId !== null && open.adopted !== true) {
              deleteMate(
                candidates.find((candidate) => candidate.project.id === open.projectId),
                open.cleanup,
                undefined,
                { birthId: open.birthId, projectId: open.projectId },
              );
              return;
            }
            const isCurrent = captureAccountLifetime();
            setPress({ pending: true, error: null });
            void birthActions.deleteBirthOnly(open.birthId, open.projectId).then(
              () => {
                if (isCurrent()) {
                  setPress(UNPRESSED);
                  setDeletingBirth(null);
                }
              },
              (cause: unknown) => {
                if (isCurrent()) setPress({ pending: false, error: zeropsErrorMessage(cause) });
              },
            );
          }}
          open
          pending={press.pending}
          words={
            deletingBirth.projectId === null || deletingBirth.adopted === true
              ? {
                  title: `Delete ${deletingBirth.name}?`,
                  body:
                    deletingBirth.adopted === true
                      ? "This stops setting up the Mate and leaves the existing project and its services untouched."
                      : "This removes the unfinished setup from the application. A project may still exist in Zerops.",
                  label: `Type ${deletingBirth.name} to confirm`,
                  submit: `Delete ${deletingBirth.name}`,
                  pending: "Deleting…",
                }
              : deleteMateWords({
                  name: deletingBirth.name,
                  environment: deletingBirth.environment,
                  services: undefined,
                  owner: undefined,
                })
          }
        />
      )}
    </>
  );

  return {
    actionsFor,
    birthFor,
    birthForProject,
    birthActionsFor,
    dialogs,
    handOver,
    busyKey,
    trouble,
    continuingBirth,
    renameInPlace,
    changeFace,
  };
}

/** Whether an HQ answer failed for good (`StreamFault` outcome `definitive-refusal`). */
function definitiveRefusal(fault: unknown): boolean {
  return (
    typeof fault === "object" &&
    fault !== null &&
    (fault as { readonly outcome?: unknown }).outcome === "definitive-refusal"
  );
}
