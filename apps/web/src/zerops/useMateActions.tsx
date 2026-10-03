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
 * runtime's commands, the account's registry and the org's member list — all
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
 * *Change face…* writes the Mate's face to HQ, where every surface reads it from: offered where
 * *Rename Mate* is, its dialog open until HQ answers, a refusal said there.
 */
import { useAtomValue } from "@effect/atom-react";
import {
  assignCandidateMateTints,
  botDisplayName,
  buildZeropsGroupTree,
  changedMateFace,
  hasMate,
  kindOfRole,
  rankZeropsCandidateForListing,
  readZeropsMembership,
  heldOf,
  mayOffer,
  offerAsker,
  canWriteRegistry,
  finishMateSetupScope,
  finishMateSetupVerb,
  resolveMateRegistration,
  type ZeropsMembership,
  type ZeropsMateFace,
} from "@t3tools/client-runtime/zerops";
import { ZeropsServiceId } from "@t3tools/client-runtime/zerops/data";
import { candidatesComplete, heldCandidates } from "@t3tools/client-runtime/zerops/projections";
import { zeropsErrorMessage } from "@t3tools/client-runtime/zerops/errors";
import type { HqPlacement } from "@t3tools/client-runtime/zerops/hq";
import {
  mateIsViewers,
  resolveMateOwnerPerson,
  resolveMateVerbs,
  resolveMateVisibility,
} from "@t3tools/client-runtime/zerops/mateAccess";
import { isMateKind } from "@t3tools/shared/zeropsRoles";
import { useRouter } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";

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
  movesAnywhere,
  type MoveMembership,
} from "../components/zerops/ZeropsMoveToGroupDialog.logic";
import { useEnvironmentLinks } from "../routes/-environmentTargets";
import { resolveThreadRouteTarget } from "../threadRoutes";
import { hqPeopleAtom, hqPlacementsAtom, hqStructureAtom } from "../state/zerops";
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
import { rememberMenu, withoutMate } from "./menuMemory";
import { useOpenMate } from "./useOpenMate";
import { useProjectOrderOptions } from "./projectOrderPreference";
import {
  useTakenBotNames,
  useZeropsCandidates,
  type ZeropsCandidatePresentation,
} from "./useZeropsCandidates";
import { useZeropsOrganizationMembersRead } from "./useZeropsMateOwners";
import { finishSetupContainer, mateProjectPastGrace } from "./finishSetup.logic";
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
import { mateRestartPorts, restartMateContainer } from "./mateRestart";
import { sessionOfferViewer } from "./offerViewer";
import { intendContainer, readContainerInitAt } from "./zeropsContainers";
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
 * Where a dialog's press stands — Delete's, Change face's or Hand over's: the platform answering
 * it, or why it refused. One dialog is open at a time, and opening one starts it unpressed.
 */
interface DialogPress {
  readonly pending: boolean;
  readonly error: string | null;
}

const UNPRESSED: DialogPress = { pending: false, error: null };

/** The Mate's name, as its row says it. */
function mateName(candidate: ZeropsCandidatePresentation): string {
  return botDisplayName({
    bot: readZeropsMembership(candidate.project).bot,
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

  const accountHq = useAccountHq(activeOrganization?.id);
  // Whether HQ's structure is known: only then does a Mate it places nowhere have no record.
  const hqPlacements = useAtomValue(hqPlacementsAtom);
  const hqStructure = useAtomValue(hqStructureAtom);
  const people = useAtomValue(hqPeopleAtom);
  const hqKnown = hqPlacements !== null && hqStructure?.current === true;
  const presses = useMatePresses();
  // A press interrupted before its close-off, on a Mate made in any browser: the store's markers,
  // at no cost of their own, for anyone who could finish it — its own adder too.
  const interrupted = useInterruptedPresses(candidates, { runtime, projectRef });
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
  /**
   * Whom HQ's rule (`mayOffer`) is asked about: the person the session names, with their membership
   * and every project listed as the facts the client holds. Nobody where the session names nobody,
   * and nothing is then offered.
   */
  const asker = useMemo(
    () =>
      offerAsker(
        sessionOfferViewer(user, activeOrganization),
        candidates.map((candidate) => candidate.project),
      ),
    [activeOrganization, candidates, user],
  );
  /**
   * Where a Mate may be moved, by HQ's rule: each application as the projects listed in it — HQ's
   * own list of an application decides no differently over these facts, which hold no project the
   * listing does not — a new one, or none.
   */
  const moveChoicesFor = useCallback(
    (candidate: ZeropsCandidatePresentation) =>
      moveChoices({
        asker,
        projectId: candidate.project.id,
        held: heldOf(candidate.project),
        apps: groupTree.groups.map(({ group, environments }) => ({
          id: group.groupId,
          name: group.name,
          projectIds: environments.map(({ item }) => item.project.id),
        })),
      }),
    [asker, groupTree.groups],
  );
  /**
   * HQ's verbs on a Mate, as HQ's rule offers them: its record, and its place among projects. None
   * on a Mate HQ holds no record of — *Finish setup* is its verb.
   */
  const hqVerbsOf = useCallback(
    (candidate: ZeropsCandidatePresentation) => {
      const projectId = candidate.project.id;
      const held = heldOf(candidate.project);
      if (!isMateKind(held)) return { edit: false, move: false, leave: false };
      return {
        edit: mayOffer(asker, "edit_mate_record", { projectId, held }),
        // Where to, and as what, is the dialog's to choose among what HQ's rule lets them.
        move: movesAnywhere(moveChoicesFor(candidate)),
        leave: mayOffer(asker, "detach", { projectId, held }),
      };
    },
    [asker, moveChoicesFor],
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
        can: mateRowCan(asker, candidate.project.id),
        ...(visibility === undefined ? {} : { visibility }),
      };
    },
    [asker, viewer],
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
      const service = {
        kind: "service" as const,
        project,
        serviceId: ZeropsServiceId.make(serviceId),
      };
      // A container that failed is stopped and started: the platform refuses to restart it.
      void write(
        candidate.key,
        // The container's initAt is read before the verb: the restart is over once it moves.
        () =>
          readContainerInitAt(candidate.key).then((initAt) =>
            restartMateContainer(
              candidate.service?.status,
              mateRestartPorts({ client, runtime, service }),
            ).then(() => {
              intendContainer(candidate.key, { kind: "restart", initAt });
            }),
          ),
        refresh,
      );
    },
    [activeOrganization, client, projectRef, refresh, runtime, write],
  );

  /** HQ's API, where a Mate's name and face and its application live (ADR 0002). */
  const hqApi = useCallback(() => {
    if (activeOrganization === null) throw new Error("No organization is open.");
    return accountHqApi(client, activeOrganization.id, officialHq(accountHq));
  }, [accountHq, activeOrganization, client]);

  const rename = useCallback(
    (candidate: ZeropsCandidatePresentation, name: string) => {
      void write(candidate.key, () => hqApi().updateMate(candidate.project.id, { name }));
    },
    [hqApi, write],
  );

  /**
   * Hands a Mate over (guide 0.8, D11): a transfer — a Mate has one OWNER (F23, 2026-10-03). The
   * person picked gets a per-project override to OWNER on their own role list
   * (`ZeropsApiClient.setProjectMemberRole`); then whoever else the project names OWNER, as the
   * platform answers that write, has the project taken off theirs. The key's grant, not an OWNER,
   * stays. The dialog stays open until the platform answers: a refusal of the first write is said
   * there and nothing changes; one of the second says the hand over is not complete — the person
   * picked has it, the previous owner still does too. Once anything was written, the access grant
   * reads every project's grants again at once (`grants-written`), so the person who handed the
   * Mate over sees what the platform holds now (F11).
   */
  const assign = useCallback(
    (candidate: ZeropsCandidatePresentation, clientUserId: string) => {
      if (activeOrganization === null) return;
      const isCurrent = captureAccountLifetime();
      const project = projectRef(activeOrganization.id, candidate.project.id);
      const writeRole = (input: {
        readonly clientUserId: string;
        readonly roleCode: "OWNER" | null;
      }) => runZeropsCommand(runtime.commands.setProjectMemberRole(project, input));
      const refused = (error: string) => {
        if (isCurrent()) setPress({ pending: false, error });
      };
      setPress({ pending: true, error: null });
      writeRole({ clientUserId, roleCode: "OWNER" }).then(
        async (handed) => {
          const previous = (handed?.userRoles ?? []).filter(
            (entry) => entry.roleCode === "OWNER" && entry.clientUserId !== clientUserId,
          );
          try {
            for (const owner of previous) {
              await writeRole({ clientUserId: owner.clientUserId, roleCode: null });
            }
          } catch (cause) {
            if (isCurrent()) invalidateZerops({ topic: "access", change: "grants-written" });
            refused(
              `It was handed over, but its previous owner still owns it too: ${zeropsErrorMessage(cause)}`,
            );
            return;
          }
          if (!isCurrent()) return;
          invalidateZerops({ topic: "access", change: "grants-written" });
          setDialog(null);
        },
        (cause: unknown) => {
          refused(zeropsErrorMessage(cause));
        },
      );
    },
    [activeOrganization, projectRef, runtime.commands, setDialog],
  );

  /** Into another application as what the person picked, a new one made first, or out of all. */
  const move = useCallback(
    (candidate: ZeropsCandidatePresentation, membership: MoveMembership) => {
      void write(candidate.key, async () => {
        const api = hqApi();
        if (membership.kind === "none") {
          return api.moveProject(candidate.project.id, { appId: null, kind: "mate" });
        }
        const appId =
          membership.kind === "new" ? (await api.createApp(membership.name)).id : membership.appId;
        return api.moveProject(candidate.project.id, {
          appId,
          kind: kindOfRole(membership.role),
        });
      });
    },
    [hqApi, write],
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
  /** Whether HQ's rule lets the viewer write the record of a Mate it holds none of. */
  const mayCreateRecord = useCallback(
    (candidate: ZeropsCandidatePresentation) =>
      mayOffer(asker, "create_mate_record", { projectId: candidate.project.id, held: "none" }),
    [asker],
  );
  const finishSetupVerbFor = useCallback(
    (candidate: ZeropsCandidatePresentation, tags: ZeropsMembership): string | undefined => {
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
          grouped && mateContainerMissing(candidate, press !== undefined, Date.now()),
        closedOffMissing: candidate.service !== undefined && interrupted.has(candidate.service.id),
        pressStopped: press?.state.kind === "failed",
        pastGrace: mateProjectPastGrace(candidate.project, Date.now()),
        viewerIsAdder: mateAddedBy(candidate.project, user?.id),
        hasContainer: candidate.service !== undefined,
        writer: canWriteRegistry(sessionOfferViewer(user, activeOrganization)),
        recordMissing: recordMissing(candidate),
        mayCreateRecord: mayCreateRecord(candidate),
      });
    },
    [
      activeOrganization,
      groupTree.groups,
      interrupted,
      mayCreateRecord,
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
      const whole =
        finishMateSetupScope(canWriteRegistry(sessionOfferViewer(user, activeOrganization))) ===
        "whole";
      // A Mate HQ holds no record of is adopted, and only then is its key lowered from ADMIN — by
      // the harden itself, which reads its key as it runs; never from a token list read on a load
      // (step A, A11).
      const adopting = recordMissing(candidate) && mayCreateRecord(candidate);
      // What it registers, by the rule Set up Mate registers by: in the application HQ or the
      // press this tab holds places it in, under that name and face; a new Mate in no application
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
        taken: taken.names,
        random: (bytes) => crypto.getRandomValues(bytes),
      });
      // A close-off alone has nothing to finish on a Mate with no container.
      if (!whole && !adopting && registration === null && candidate.service === undefined) {
        return;
      }
      // A container only where its project has none and no press elsewhere may still be importing
      // one (`finishSetupContainer`).
      const container = whole
        ? finishSetupContainer({
            hasService: candidate.service !== undefined,
            pressStopped,
            pastGrace: mateProjectPastGrace(candidate.project, Date.now()),
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
            inputs: { client, data: { runtime, organizationRef, projectRef }, organizationId },
            projectId,
            projectName: candidate.project.name,
            container,
            harden: adopting,
            registration,
            hq: accountHq.hq.kind === "official" ? accountHq.hq : null,
            isCurrent: captureAccountLifetime(),
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
      organizationRef,
      projectRef,
      recordMissing,
      refresh,
      registry,
      runtime,
      taken.names,
      user,
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
    async (projectId: string): Promise<string | null> => {
      try {
        return await hqApi().mateKey(projectId);
      } catch {
        return null;
      }
    },
    [hqApi],
  );

  /**
   * Deletes the Mate's project, and its key with it — by the id the Mate named to HQ, read before
   * its project goes; none is matched by name (audit K3: a deleted Mate's key was left on the
   * account, and a member holding tokens cannot be taken off the org). The dialog stays open until
   * the platform answers: a refusal is said there, and nothing else changes. Once it accepts, the
   * row says *Deleting…* until the listing lets it go, the listing is read again, and nothing this
   * browser remembers of the Mate — its row, its crew, a birth — is left for a reload to paint.
   */
  const deleteMate = useCallback(
    (candidate: ZeropsCandidatePresentation) => {
      if (activeOrganization === null) return;
      const isCurrent = captureAccountLifetime();
      const clientId = activeOrganization.id;
      const organization = organizationRef(clientId);
      const projectId = candidate.project.id;
      setPress({ pending: true, error: null });
      void (async () => {
        const keyTokenId = await mateKeyOf(projectId);
        await runZeropsCommand(runtime.commands.deleteProject({ organization, projectId }));
        // Its project gone, its key goes too; a key Zerops will not delete stays behind.
        if (keyTokenId !== null) {
          await client
            .deleteIntegrationToken({ clientId, tokenId: keyTokenId })
            .catch(() => undefined);
        }
      })().then(
        () => {
          if (!isCurrent()) return;
          markMateDeleting(projectId);
          rememberMenu((memory) => withoutMate(memory, projectId));
          forgetPress(projectId);
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
    [
      activeOrganization,
      client,
      leaveDeleted,
      mateKeyOf,
      organizationRef,
      runtime.commands,
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
      if (!changeFaceOffered({ candidate, mayRename: hqVerbsOf(candidate).edit })) return undefined;
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
      // The platform's own verbs — delete, hand over — by the role function the platform enforces;
      // HQ's by HQ's rule. Either way, a person the session does not name is offered none.
      const platformVerbs =
        viewer === null || user === null
          ? { delete: false, assign: false }
          : resolveMateVerbs({ project: candidate.project, viewer });
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
          onSelect: () => restart(candidate),
        });
      }
      quick.push(...extraQuick);
      return [
        ...quick,
        ...(quick.length > 0 ? [{ id: "quick", separator: true } as const] : []),
        ...(hqVerbs.edit
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
        ...(finishSetupLabel === undefined
          ? []
          : [
              {
                id: "finish-setup",
                label: finishSetupLabel,
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
        ...(hqVerbs.move
          ? [
              {
                id: "move",
                label: tags.groupId === undefined ? "Move to a project" : "Change project or role",
                onSelect: () => setDialog({ kind: "move", candidate }),
              },
            ]
          : []),
        ...(hqVerbs.leave && tags.groupId !== undefined
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
      finishSetup,
      finishSetupVerbFor,
      restart,
      rowInputFor,
      serverVersions,
      setDialog,
      start,
      hqVerbsOf,
      user,
      viewer,
    ],
  );

  const renameInPlace = useCallback(
    (candidate: ZeropsCandidatePresentation): MateRenameInPlace | undefined => {
      if (!hqVerbsOf(candidate).edit) return undefined;
      const current = readZeropsMembership(candidate.project).bot;
      return {
        initialValue: current ?? "",
        validate: (value) =>
          validateBotName(value, taken, current === undefined ? {} : { current }),
        commit: (value) => {
          rename(candidate, value.replace(/\s+/g, " ").trim());
        },
      };
    },
    [hqVerbsOf, rename, taken],
  );

  const close = useCallback(() => setDialog(null), [setDialog]);
  const dialogs = (
    <>
      {dialog?.kind === "rename" ? (
        <ZeropsRenameDialog
          initialValue={readZeropsMembership(dialog.candidate.project).bot ?? ""}
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
            const current = readZeropsMembership(dialog.candidate.project).bot;
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
          projectName={dialog.candidate.project.name}
        />
      ) : null}
      {dialog?.kind === "move" ? (
        <ZeropsMoveToGroupDialog
          currentGroupId={readZeropsMembership(dialog.candidate.project).groupId}
          currentRole={readZeropsMembership(dialog.candidate.project).role}
          choices={moveChoicesFor(dialog.candidate)}
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
          name={mateName(dialog.candidate)}
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
 * Whether a Mate's container never came: its project lists no zcp, it is past the moments a press
 * takes to import one, and this tab is not pressing it — a listing read that soon may not show a
 * container just imported, and importing one again would make a second.
 */
export function mateContainerMissing(
  candidate: Pick<ZeropsCandidatePresentation, "service" | "project">,
  pressedHere: boolean,
  nowMs: number,
): boolean {
  if (candidate.service !== undefined || pressedHere) return false;
  return mateProjectPastGrace(candidate.project, nowMs);
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
