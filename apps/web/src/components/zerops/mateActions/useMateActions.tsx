import { MateRestartError } from "~/zerops/mateRestartRefusal";
import {
  faceAction,
  mateDeletionOfProject,
  mateRestartOf,
  mateGoing,
  NO_FACE_ACTION,
  operationFailureDetails,
  projectMoveOf,
} from "@t3tools/client-runtime/data";
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
 * it accepts, nothing this browser remembers of the Mate is left to paint on
 * a reload, its row reads *Deleting…* on every device until HQ releases it
 * (`mateDeletionOf`), and a viewer who was in its conversation is taken to the
 * next Mate of its project, or to the projects.
 *
 * *Rename Mate* renames the Mate's project in Zerops, whose name is the Mate's own after its
 * application's (`renamedProjectName`), by the account's one writer of a project's record, where the platform takes it from this person.
 * *Change face…* writes the Mate's face to HQ, where every surface reads it from, where HQ's rule
 * lets them: its dialog open until HQ answers, a refusal said there.
 */
import { RegistryContext, useAtomValue } from "@effect/atom-react";
import {
  assignCandidateMateTints,
  buildCanonicalGroupTree,
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
import { heldCandidates } from "@t3tools/client-runtime/zerops/projections";
import { zeropsErrorMessage } from "@t3tools/client-runtime/zerops/errors";
import { heldOf } from "@t3tools/client-runtime/zerops/hq";
import type { MateContainerLevel } from "@t3tools/client-runtime/zerops/mateState";
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

import { moveAttemptFor, type MoveAttempt } from "./moveAttempt";
import { MateDeployConfirmation } from "./MateDeployConfirmation";
import { useMateStates } from "./useMateStates";
import { RestartMateConfirmation } from "./RestartMateConfirmation";
import type { HqMoveTo } from "@t3tools/shared/hqOffers";
import { useMateOffers, useOrgOffers } from "~/zerops/useHqOffers";
import { useAccountDataOptional, useDetailDemand } from "~/zerops/ZeropsAccountData";
import { useComposerDraftStore } from "~/composerDraftStore";
import type { ZeropsMenuEntry } from "../ZeropsProjectMenu";
import { ZeropsAssignMateDialog } from "../ZeropsAssignMateDialog";
import { ZeropsChangeFaceDialog } from "../ZeropsChangeFaceDialog";
import { CHANGE_FACE_VERB, mateFaceOf } from "../ZeropsChangeFaceDialog.logic";
import { ZeropsDeleteMateDialog } from "../ZeropsDeleteMateDialog";
import { mateDeletionLine } from "../SidebarMateRow.logic";
import {
  applicationHoldings,
  deleteApplicationWords,
  lastMateDeletionTarget,
  type DeleteApplicationTarget,
} from "../ZeropsDeleteApplicationDialog.logic";
import { useDeleteApplicationDialog } from "../deleteApplicationDialog";
import { useHqAppDetail } from "~/zerops/useHqAppDetail";
import {
  deleteMateServiceCount,
  deleteMateVerb,
  deleteMateWords,
  landingAfterDelete,
} from "../ZeropsDeleteMateDialog.logic";
import { ZeropsMoveToGroupDialog } from "../ZeropsMoveToGroupDialog";
import { ZeropsProjectAccessDialog } from "../ZeropsProjectAccessDialog";
import { emptyApplications } from "../projects/emptyApps.logic";
import { ZeropsRenameDialog } from "../ZeropsRenameDialog";
import { validateBotName } from "../ZeropsEnvironmentCreationDialog.logic";
import {
  moveAwaitsPlacement,
  moveChoices,
  movePlacementOf,
  type MoveMembership,
  type MovePlacement,
} from "../ZeropsMoveToGroupDialog.logic";
import { useEnvironmentLinks } from "~/routes/-environmentTargets";
import { resolveThreadRouteTarget } from "~/threadRoutes";
import {
  initialStream,
  organizationMembers,
  shownHqProjectPeopleAtom,
  shownMateVisibilitiesAtom,
  type MembersRead,
} from "@t3tools/client-runtime/data";
import { HAND_OVER_VERB, handOverCandidates } from "~/zerops/mateHandOver.logic";
import { hqNavigationAtom } from "~/state/zerops";
import { invalidateZerops } from "~/zerops/accountInvalidations";
import { configuredHq } from "~/zerops/accountHq";
import { useProjectDialog } from "~/zerops/inventoryContext";
import { captureAccountLifetime, currentAccountEpoch } from "~/zerops/accountLifetime";
import { useOpenMate } from "~/zerops/useOpenMate";
import { useProjectOrderOptions } from "~/zerops/projectOrderPreference";
import {
  useTakenBotNames,
  useZeropsDetailCandidates,
  type ZeropsCandidatePresentation,
} from "~/zerops/useZeropsCandidates";
import { useRestartMate } from "~/zerops/mateRestart";
import { renameStillDue } from "@t3tools/client-runtime/zerops/projectRenames";
import { lifecycleRemainders, NO_LIFECYCLE_REMAINDERS } from "@t3tools/client-runtime/data";
import { Atom } from "effect/reactivity";
import { useProjection } from "~/zerops/ZeropsAccountData";
import { randomUUID } from "~/lib/utils";
import { useAccountOperations } from "~/zerops/accountOperations";
import { submitZeropsWrite, writeTrouble, type ZeropsWrite } from "~/zerops/zeropsWrite";
import { HQ_HANDOVER_UNFINISHED } from "@t3tools/client-runtime/zerops/hq";
import { useZeropsSession } from "~/zerops/ZeropsSessionProvider";
import { sharedBirthsAtom, type SharedBirth } from "@t3tools/client-runtime/data";
import { useBirthActions } from "~/zerops/useBirthActions";
import { sharedBirthPresentation, useSharedBirths } from "~/zerops/sharedBirths";

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
      /** HQ refused a start from this placement as changed: no press until navigation shows another. */
      readonly heldChanged?: HeldChanged;
    }
  | {
      readonly kind: "delete";
      readonly candidate: ZeropsCandidatePresentation;
    };

/** HQ's `held_changed` answer to a move: what it said, and the placement it refused. */
interface HeldChanged {
  readonly said: string;
  readonly from: MovePlacement;
}

/**
 * Where a dialog's press stands — Delete's or Hand over's: the platform answering
 * it, or why it refused. One dialog is open at a time, and opening one starts it unpressed.
 */
interface DialogPress {
  readonly pending: boolean;
  readonly error: string | null;
}

const NO_REMAINDERS = Atom.make(NO_LIFECYCLE_REMAINDERS);
/** HQ's refusal of a move whose project it holds elsewhere than the person reviewed. */
const HELD_CHANGED = "held_changed";
/** A move HQ refused as `held_changed`: the dialog reads where it may go again. */
class MoveHeldChanged extends Error {}
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

interface MateMenuActions {
  readonly setupOnly: boolean;
  readonly entries: ReadonlyArray<ZeropsMenuEntry>;
}

export interface MateActions {
  /** The menu entries for one Mate: the verbs its state offers (`mateState`), and its version. */
  readonly actionsFor: (
    candidate: ZeropsCandidatePresentation,
    tags: ZeropsMembership,
    /** Entries the surface adds to the quick group — the update control's. */
    extraQuick?: ReadonlyArray<ZeropsMenuEntry>,
  ) => MateMenuActions;
  readonly birthFor: (birthId: string) => SharedBirth | undefined;
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
interface MateActionsInput {
  /** `candidate.key → "0.11.25"`, from `useZeropsContainers`. */
  readonly serverVersions: ReadonlyMap<string, string>;
  /** `candidate.key →` its container machine's level, from `useZeropsContainers`. */
  readonly levels: ReadonlyMap<string, MateContainerLevel>;
}

export function useMateActions({ serverVersions, levels }: MateActionsInput): MateActions {
  const { activeOrganization, user } = useZeropsSession();
  const operations = useAccountOperations();
  const atomRegistry = useContext(RegistryContext);
  const births = useSharedBirths();
  const birthActions = useBirthActions();
  const { listing, refresh } = useZeropsDetailCandidates();
  const candidates = useMemo(() => heldCandidates(listing).rows, [listing]);
  const stateOf = useMateStates(levels);
  const router = useRouter();
  const openMate = useOpenMate();
  const { linkTarget } = useEnvironmentLinks();
  const [press, setPress] = useState<DialogPress>(UNPRESSED);
  const [deletingBirth, setDeletingBirth] = useState<{
    readonly birthId: string;
    readonly orgId: string;
    readonly projectId: string | null;
    readonly adopted?: true;
    readonly name: string;
    readonly environment: string;
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
  const writing = useRef(new Set<string>());
  // A move's start id by its project and body, until HQ answered it.
  const moveAttempts = useRef(new Map<string, MoveAttempt>());
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
      buildCanonicalGroupTree(candidates, {
        rank: rankZeropsCandidateForListing,
        ...projectOrder,
        apps: emptyApplications(hqStructure, activeOrganization?.id),
      }),
    [activeOrganization?.id, candidates, hqStructure, projectOrder],
  );
  const taken = useTakenBotNames();
  // Every Mate's tint as every surface draws it: the face a Change face dialog opens on.
  const tints = useMemo(() => assignCandidateMateTints(candidates), [candidates]);
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
      const held = entry.environments.flatMap(({ item }) => (item === undefined ? [] : [item]));
      const mates = held.filter(hasMate);
      if (mates.length !== 1 || mates[0]!.project.id !== candidate.project.id) return undefined;
      const app =
        hqStructure.orgId === activeOrganization?.id
          ? hqStructure.structure?.apps.find(({ id }) => id === groupId)
          : undefined;
      return lastMateDeletionTarget(
        held.map((item) => item.project),
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
    (
      candidate: ZeropsCandidatePresentation,
      /** HQ's refusal that has the destinations read again, said while they are. */
      heldChanged?: HeldChanged,
    ) => {
      const isCurrent = captureAccountLifetime();
      const attempt = ++choiceRead.current.attempt;
      setPress(heldChanged === undefined ? UNPRESSED : { pending: false, error: heldChanged.said });
      const stale = heldChanged === undefined ? {} : { heldChanged };
      setDialog({ kind: "move", candidate, reading: true, ...stale });
      const replyToDialog = captureDialogReply();
      const settle = (
        answer: Pick<
          Extract<MateDialog, { kind: "move" }>,
          "moveTo" | "refused" | "readError" | "retryRead"
        >,
      ) => {
        if (!isCurrent() || attempt !== choiceRead.current.attempt) return;
        replyToDialog({ kind: "move", candidate, ...stale, ...answer });
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
      refused?: (reason: string, cause: unknown) => void,
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
          refused?.(reason, cause);
        }
      } finally {
        writing.current.delete(key);
        if (isCurrent()) setBusyKey(null);
      }
    },
    [activeOrganization],
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

  /** Opens a Mate's hand-over where its state offers it (`mateState`). */
  const handOver = useCallback(
    (candidate: ZeropsCandidatePresentation): (() => void) | undefined => {
      if (busyKey === candidate.key || !stateOf(candidate).verbs.assign) return undefined;
      return () => {
        setPress(UNPRESSED);
        setDialog({ kind: "assign", candidate });
      };
    },
    [busyKey, stateOf, setDialog],
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

  /**
   * Into another application as what the person picked, a new one named in the same start, or out
   * of all: one start at HQ (`start-project-move`) on the person's access token, from the placement
   * the person reviewed. HQ places it in the start's write, then renames its project in Zerops
   * after its application, with or without this tab; its row says how that stands on every device
   * (`projectMoveOf`). The dialog stays open until HQ answers the start: a refusal is said there,
   * and HQ's answer that the placement changed meanwhile reads the destinations again and holds the
   * press until navigation shows the new placement. A press again
   * after an answer that did not come sends the same id with the same body, which HQ answers again.
   */
  const move = useCallback(
    (candidate: ZeropsCandidatePresentation, membership: MoveMembership) => {
      if (activeOrganization === null || writing.current.has(candidate.key)) return;
      const held = heldOf(candidate.project);
      const from = movePlacementOf(readZeropsMembership(candidate.project).groupId, held);
      if (from === undefined) {
        setPress({
          pending: false,
          error:
            held === "plain"
              ? "HQ does not offer moving this project."
              : "HQ must read this Mate’s placement before Move.",
        });
        return;
      }
      const isCurrent = captureAccountLifetime();
      const replyToDialog = captureDialogReply();
      setPress({ pending: true, error: null });
      const orgId = activeOrganization.id;
      const projectId = candidate.project.id;
      const start = {
        from,
        to: {
          appId: membership.kind === "group" ? membership.appId : null,
          kind: membership.kind === "none" ? ("mate" as const) : kindOfRole(membership.role),
        },
        ...(membership.kind === "new" ? { newApp: { name: membership.name } } : {}),
      };
      const attempt = moveAttemptFor(
        moveAttempts.current.get(projectId),
        JSON.stringify(start),
        randomUUID,
      );
      const { id } = attempt;
      moveAttempts.current.set(projectId, attempt);
      void write(
        candidate.key,
        async () => {
          const { progress, evidence } = await operations.submit({
            kind: "start-project-move",
            orgId,
            projectId,
            id,
            ...start,
          });
          if (progress.stage !== "uncertain" && moveAttempts.current.get(projectId) === attempt)
            moveAttempts.current.delete(projectId);
          const trouble = writeTrouble(progress, evidence);
          if (trouble === null) return;
          throw progress.stage === "refused" && progress.code === HELD_CHANGED
            ? new MoveHeldChanged(trouble)
            : new Error(trouble);
        },
        () => {
          replyToDialog.ifCurrent(() => setPress(UNPRESSED));
          replyToDialog(null);
          refresh();
        },
        (reason, cause) => {
          replyToDialog.ifCurrent(() => {
            setPress({ pending: false, error: reason });
            // HQ holds it elsewhere than reviewed: read where it stands and may go again.
            if (isCurrent() && cause instanceof MoveHeldChanged) {
              refresh();
              askMove(candidate, { said: reason, from });
            }
          });
        },
      );
    },
    [activeOrganization, askMove, operations, refresh, captureDialogReply, write],
  );

  /** Sends the rename a move made before HQ ran moves left, as it was planned. */
  const finishRename = useCallback(
    (candidate: ZeropsCandidatePresentation) => {
      if (activeOrganization === null || currentAccountEpoch() !== remaindersEpoch) return;
      const left = renameStillDue(unrenamed.get(candidate.project.id), candidate.project.name);
      if (left === undefined) return;
      void write(
        candidate.key,
        () =>
          submitZeropsWrite(operations, activeOrganization.id, {
            kind: "rename-project",
            projectId: left.projectId,
            name: left.to,
            from: left.from,
          }),
        refresh,
      );
    },
    [activeOrganization, operations, refresh, remaindersEpoch, unrenamed, write],
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
        .flatMap(({ item }) => (item === undefined ? [] : [item]))
        .filter(hasMate);
      const landing = landingAfterDelete({
        deleted: deleted.project.id,
        viewing:
          onScreen !== undefined && onScreen === environmentId ? deleted.project.id : undefined,
        siblings: siblings.map((mate) => ({
          projectId: mate.project.id,
          opens:
            (visibilities[mate.project.id] ?? "open") === "open" &&
            !mateGoing(mateDeletionOfProject(mate.project, undefined)),
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
   * Deletes the Mate with one start at HQ (`start-mate-deletion`), on the person's access token,
   * with a fresh operation id and their answer whether to keep its application's Git: HQ deletes
   * its project, its key with it, and releases its records. The dialog stays open until HQ answers
   * the start: a refusal is said there, and a press again after an answer that did not come sends
   * the same id with the same body, which HQ answers again. Once HQ took it, its row says
   * *Deleting…* on every device from HQ's navigation (`mateDeletionOf`) until HQ releases it, and
   * nothing more runs in this tab.
   */
  const deleteMate = useCallback(
    (
      candidate: ZeropsCandidatePresentation | undefined,
      /**
       * Its project, where this is its last Mate: deleted too, its own Delete opens confirmed once
       * HQ took the Mate's and starts when HQ let go of the Mate (`applicationDeletionHold`); kept,
       * that choice answers HQ's question whether to keep the project's Git.
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
      const orgId = activeOrganization.id;
      setPress({ pending: true, error: null });
      const keptGit = application !== undefined && !application.also ? "keep" : undefined;
      // One id per start this tab makes: sent again only for the same body, until HQ took it. A
      // deletion HQ shows failed ended whatever start it took, so a Delete after it starts anew.
      const attempt = `${projectId}:${keptGit ?? ""}`;
      const ended =
        candidate !== undefined &&
        mateDeletionOfProject(candidate.project, undefined).kind === "failed";
      const id = (ended ? undefined : deletionRequests.current.get(attempt)) ?? randomUUID();
      deletionRequests.current.set(attempt, id);
      void (async () => {
        const { progress, evidence } = await operations.submit({
          kind: "start-mate-deletion",
          orgId,
          projectId,
          id,
          ...(keptGit === undefined ? {} : { keptGit }),
        });
        const trouble = writeTrouble(progress, evidence);
        if (trouble !== null) throw new Error(trouble);
        deletionRequests.current.delete(attempt);
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
    [activeOrganization, operations, leaveDeleted, captureDialogReply],
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
      if (busyKey === candidate.key || stateOf(candidate).verbs.face !== "offered") {
        return undefined;
      }
      return () => {
        setPress(UNPRESSED);
        setDialog({ kind: "face", candidate });
      };
    },
    [busyKey, stateOf, setDialog],
  );

  const birthFor = useCallback((id: string) => births.find((birth) => birth.id === id), [births]);
  const birthActionsFor = useCallback(
    (id: string): ReadonlyArray<ZeropsMenuEntry> => {
      const birth = birthFor(id);
      if (birth === undefined) return [];
      const key =
        candidates.find((candidate) => candidate.project.id === birth.projectId)?.key ??
        `birth:${birth.projectId ?? birth.id}`;
      const orgId = activeOrganization?.id;
      return [
        // HQ's operation waiting for this person, its maker: their current token resumes it there.
        ...(orgId !== undefined &&
        sharedBirthPresentation(birth).actions.includes("continue-operation")
          ? [
              {
                id: "continue-operation",
                label: "Continue",
                disabled: busyKey === key,
                onSelect: () => {
                  void write(key, async () => {
                    const { progress, evidence } = await operations.submit({
                      kind: "continue-operation",
                      orgId,
                      id: birth.id,
                    });
                    const trouble = writeTrouble(progress, evidence);
                    if (trouble !== null) throw new Error(trouble);
                  });
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
    [activeOrganization?.id, birthFor, busyKey, candidates, operations, write],
  );

  const actionsFor = useCallback(
    (
      candidate: ZeropsCandidatePresentation,
      tags: ZeropsMembership,
      extraQuick: ReadonlyArray<ZeropsMenuEntry> = [],
    ): MateMenuActions => {
      // HQ's deletion of it waiting for its maker's fresh token: Continue, to its maker alone;
      // nothing else, as a Mate on its way off Zerops offers nothing.
      const deletion = mateDeletionOfProject(candidate.project, user?.id);
      if (deletion.kind === "waiting") {
        const orgId = activeOrganization?.id;
        return {
          setupOnly: true,
          entries:
            deletion.yours && orgId !== undefined
              ? [
                  {
                    id: "continue-operation",
                    label: "Continue",
                    disabled: busyKey === candidate.key,
                    onSelect: () => {
                      void write(candidate.key, async () => {
                        const { progress, evidence } = await operations.submit({
                          kind: "continue-operation",
                          orgId,
                          id: deletion.id,
                          projectId: candidate.project.id,
                        });
                        const trouble = writeTrouble(progress, evidence);
                        if (trouble !== null) throw new Error(trouble);
                      });
                    },
                  },
                ]
              : [],
        };
      }
      const { menu, verbs } = stateOf(candidate);
      if (menu === "none") return { setupOnly: false, entries: [] };
      if (menu === "birth") {
        const birth = births.find((birth) => birth.projectId === candidate.project.id);
        return { setupOnly: true, entries: birth === undefined ? [] : birthActionsFor(birth.id) };
      }
      const busy = busyKey === candidate.key;
      // HQ's move or restart of it, running or waiting for its maker's fresh token: no second one
      // meanwhile, and its maker's Continue gives it the token.
      const moving = projectMoveOf(candidate.project, user?.id);
      const moveRuns = moving.kind === "going" || moving.kind === "waiting";
      const restarting = mateRestartOf(candidate.project, user?.id);
      const restartRuns = restarting.kind === "going" || restarting.kind === "waiting";
      const orgId = activeOrganization?.id;
      const continueOn = (id: string, label: string, standing: typeof restarting) =>
        standing.kind === "waiting" && standing.yours && orgId !== undefined
          ? {
              id,
              label,
              disabled: busy,
              onSelect: () => {
                void write(candidate.key, async () => {
                  const { progress, evidence } = await operations.submit({
                    kind: "continue-operation",
                    orgId,
                    id: standing.id,
                    projectId: candidate.project.id,
                  });
                  const trouble = writeTrouble(progress, evidence);
                  if (trouble !== null) throw new Error(trouble);
                });
              },
            }
          : undefined;
      const continueMove =
        moving.kind === "renamed-since"
          ? undefined
          : continueOn("continue-move", "Continue moving", moving);
      const continueRestart = continueOn("continue-restart", "Continue restarting", restarting);
      const deleteAction = verbs.delete
        ? {
            id: "delete",
            label: deleteMateVerb(projectNameInApp(candidate.project)),
            variant: "destructive" as const,
            disabled: busy,
            onSelect: () => {
              setPress(UNPRESSED);
              setDialog({ kind: "delete", candidate });
            },
          }
        : undefined;
      // A Mate still coming up holds Delete alone.
      if (menu === "setup")
        return { setupOnly: true, entries: deleteAction === undefined ? [] : [deleteAction] };
      const openFace = changeFace(candidate);
      const serverVersion = serverVersions.get(candidate.key);
      const quick: Array<ZeropsMenuEntry> = [];
      if (verbs.redeploy) {
        quick.push({
          id: "redeploy",
          label: "Redeploy",
          disabled: busy,
          onSelect: () => setDialog({ kind: "redeploy", candidate }),
        });
      }
      if (verbs.start) {
        quick.push({
          id: "start",
          label: "Start",
          disabled: busy,
          onSelect: () => start(candidate),
        });
      }
      if (verbs.restart) {
        quick.push({
          id: "restart",
          label: "Restart",
          disabled: busy || restartRuns,
          onSelect: () => {
            setPress(UNPRESSED);
            setDialog({ kind: "restart", candidate });
          },
        });
      }
      quick.push(...extraQuick);
      const entries: ZeropsMenuEntry[] = [
        ...quick,
        ...(quick.length > 0 ? [{ id: "quick", separator: true } as const] : []),
        ...(verbs.rename
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
          : verbs.face === "held"
            ? [{ id: "face", label: CHANGE_FACE_VERB, disabled: true, onSelect: () => {} }]
            : []),
        ...(verbs.assign
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
        ...(verbs.access
          ? [
              {
                id: "access",
                label: "Project access…",
                disabled: busy,
                onSelect: () => {
                  setDialog({ kind: "access", candidate });
                },
              },
            ]
          : []),
        ...(continueMove === undefined ? [] : [continueMove]),
        ...(continueRestart === undefined ? [] : [continueRestart]),
        ...(verbs.move !== "no"
          ? [
              {
                id: "move",
                label: tags.groupId === undefined ? "Move to a project" : "Change project or role",
                disabled: busy || moveRuns || verbs.move === "held",
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
        ...(verbs.leave !== "no"
          ? [
              {
                id: "leave",
                label: "Leave the project",
                disabled: busy || moveRuns || verbs.leave === "held",
                onSelect: () => {
                  setPress(UNPRESSED);
                  setDialog({ kind: "move", candidate, moveTo: {} });
                },
              },
            ]
          : []),
        // What takes the Mate away for good: last of the verbs, a line apart, in red.
        ...(deleteAction !== undefined
          ? [{ id: "delete-apart", separator: true } as const, deleteAction]
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
      return { setupOnly: false, entries };
    },
    [
      activeOrganization?.id,
      askMove,
      birthActionsFor,
      births,
      busyKey,
      operations,
      user?.id,
      write,
      changeFace,
      finishRename,
      remaindersEpoch,
      unrenamed,
      serverVersions,
      setDialog,
      start,
      stateOf,
    ],
  );

  const renameInPlace = useCallback(
    (candidate: ZeropsCandidatePresentation): MateRenameInPlace | undefined => {
      if (busyKey === candidate.key || !stateOf(candidate).verbs.rename) return undefined;
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
    [busyKey, stateOf, rename, taken],
  );

  const close = useCallback(() => {
    choiceRead.current.attempt += 1;
    setDialog(null);
  }, [setDialog]);
  // The last Mate's Delete holds its project's detail: what deleting the project too would take.
  const deletingApplication =
    dialog?.kind === "delete" ? lastMateApplication(dialog.candidate) : undefined;
  const deletingApplicationDetail = useHqAppDetail(deletingApplication?.appId ?? null);
  const deletion =
    dialog?.kind === "delete"
      ? mateDeletionOfProject(dialog.candidate.project, user?.id)
      : undefined;
  const deletionLine = mateDeletionLine(deletion);
  const failedDeletion =
    deletion?.kind === "failed" && deletionLine?.kind === "deletion-failed"
      ? { line: deletionLine.text, details: operationFailureDetails(deletion.failure) }
      : undefined;
  // The Mate a Move dialog is about as it stands now: a placement changed meanwhile included.
  const movingCandidate =
    dialog?.kind === "move"
      ? (candidates.find((entry) => entry.project.id === dialog.candidate.project.id) ??
        dialog.candidate)
      : undefined;
  const movingMembership =
    movingCandidate === undefined ? undefined : readZeropsMembership(movingCandidate.project);
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
      {dialog?.kind === "move" && movingCandidate !== undefined ? (
        <ZeropsMoveToGroupDialog
          currentGroupId={movingMembership?.groupId}
          currentRole={movingMembership?.role}
          choices={
            dialog.moveTo === undefined
              ? { apps: [], newApp: [], none: false }
              : moveChoicesFor(movingCandidate, dialog.moveTo, dialog.refused)
          }
          reading={
            dialog.reading === true ||
            moveAwaitsPlacement(
              dialog.heldChanged?.from,
              movePlacementOf(movingMembership?.groupId, heldOf(movingCandidate.project)),
            )
          }
          readError={dialog.readError}
          onReadAgain={
            dialog.retryRead ? () => askMove(movingCandidate, dialog.heldChanged) : undefined
          }
          pending={press.pending}
          error={press.error}
          key={`move:${dialog.candidate.key}:${dialog.moveTo === undefined ? "reading" : "read"}:${movingMembership?.groupId}:${movingMembership?.role}`}
          onCancel={close}
          onOpenChange={(open) => {
            if (!open) close();
          }}
          onSubmit={(membership) => {
            move(movingCandidate, membership);
          }}
          open
          name={projectNameInApp(movingCandidate.project)}
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
          failed={failedDeletion}
          key={`delete:${dialog.candidate.key}`}
          name={projectNameInApp(dialog.candidate.project)}
          onCancel={close}
          onConfirm={(alsoApplication) => {
            deleteMate(
              dialog.candidate,
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
              current === undefined ||
              !current.canDelete ||
              current.projectId !== open.projectId ||
              current.adopted !== open.adopted
            ) {
              setPress({ pending: false, error: "The birth or your access has changed." });
              return;
            }
            if (open.projectId !== null && open.adopted !== true) {
              deleteMate(
                candidates.find((candidate) => candidate.project.id === open.projectId),
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
    birthActionsFor,
    dialogs,
    handOver,
    busyKey,
    trouble,
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
