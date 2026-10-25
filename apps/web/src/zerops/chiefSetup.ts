/**
 * Setting up the organization's Chief, as this tab runs it (`chiefSetup.logic.ts`): the New project
 * that makes its project and container, and HQ's mark on it. The Chief page shows it and presses it (`ChiefPage`); the runner is mounted once,
 * above every view (`ChiefSetupHost`), so its steps run on wherever the person goes.
 *
 * Its state is this tab's memory: it survives leaving the page, not a reload.
 */
import { useRoleOffers } from "./usePlatformCapabilities";
import { shownProjectsAtom } from "@t3tools/client-runtime/data";
import { useAtomValue } from "@effect/atom-react";
import { generateZeropsGroupId } from "@t3tools/client-runtime/zerops";
import { MATE_SHAPE_OF_TINT } from "@t3tools/shared/brand";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { create } from "zustand";

import {
  CHIEF_SETUP_IDLE,
  chiefProjectProgress,
  chiefSetupAfter,
  finishChiefSetup,
  type ChiefSetup,
  type ChiefSetupEvent,
} from "../components/zerops/chief/chiefSetup.logic";
import { officialHq, useAccountHq } from "./accountHq";
import { onAccountLifetimeClose } from "./accountLifetime";
import { HQ_UNFOLLOWED, useAccountOperationsOptional } from "./accountOperations";
import { chiefNames, chiefOffered, chiefSetupEntry, chiefSetupLine, othersChiefs } from "./chief";
import { beginCreation, tryCreationAgain, useCreation } from "./creations";
import { useMatePresses } from "./matePress";
import type { NewProjectAsk } from "./newProjectBirth";
import { useHqOwnChief, useOwnChief } from "./ownChief";
import { useOrgOffers } from "./useHqOffers";
import { useRunNewProject } from "./useRunNewProject";
import { useZeropsRegistry } from "./useZeropsRegistry";
import { useZeropsSession } from "./ZeropsSessionProvider";

interface ChiefSetupState {
  /** The organization the setup runs in. */
  readonly orgId: string | null;
  readonly setup: ChiefSetup;
  /** When this tab pressed *Set up Chief*: its progress row's clock; `null` when resumed. */
  readonly startedAtMs: number | null;
}

const INITIAL: ChiefSetupState = { orgId: null, setup: CHIEF_SETUP_IDLE, startedAtMs: null };

const useChiefSetupStore = create<ChiefSetupState>(() => INITIAL);

onAccountLifetimeClose(() => useChiefSetupStore.setState(INITIAL));

/** What the runner does on a press, as the mounted runner last made it (`useChiefSetupRunner`). */
let runnerPresses: { readonly start: () => void; readonly again: () => void } | null = null;

/** *Set up Chief*: the mounted runner starts the setup; nothing while none is mounted. */
export function startChiefSetup(): void {
  runnerPresses?.start();
}

/** *Try again*: the mounted runner resumes the step that stopped. */
export function tryChiefSetupAgain(): void {
  runnerPresses?.again();
}

function dispatch(event: ChiefSetupEvent): void {
  useChiefSetupStore.setState((state) => ({ setup: chiefSetupAfter(state.setup, event) }));
}

/** The setup in the organization in view; idle in any other. */
export function useChiefSetup(): ChiefSetupState {
  const { activeOrganization } = useZeropsSession();
  const state = useChiefSetupStore();
  return state.orgId === null || state.orgId === activeOrganization?.id
    ? state
    : { ...state, setup: CHIEF_SETUP_IDLE };
}

/**
 * Both navigation entries share the same current HQ verdict and setup state, and the viewer's role:
 * a Chief is a project of their own, so a role that may not create projects is offered none.
 */
export function useChiefSetupEntry(): boolean {
  const own = useHqOwnChief();
  const { setup } = useChiefSetup();
  const offered = useRoleOffers().setUpChief;
  return offered && chiefSetupEntry(own, setup.phase);
}

/**
 * Whether the account menu offers *Set up Chief* (`chiefOffered`): to a person who may set one up
 * and has none, once the organization holds a second project.
 */
export function useChiefOffer(): boolean {
  const entry = useChiefSetupEntry();
  const { registry, loading } = useZeropsRegistry();
  const roster = useAtomValue(shownProjectsAtom).projects;
  const chiefs = useMemo(() => othersChiefs(roster, null), [roster]);
  return chiefOffered({ entry, apps: loading ? undefined : registry.groups, chiefs });
}

/** Where setting up a Chief stands, as the menu's top row says it (`chiefSetupLine`). */
export function useChiefSetupLine(): ReturnType<typeof chiefSetupLine> {
  const own = useOwnChief();
  const { setup } = useChiefSetup();
  const mayCreate = useOrgOffers()("create_app").kind === "allowed";
  return chiefSetupLine({ own, mayCreate, setup: setup.phase });
}

/** The face a Chief's record carries: every surface draws a Chief as the product's mark. */
const CHIEF_FACE = { tint: "slate", shape: MATE_SHAPE_OF_TINT.slate } as const;

/**
 * Runs the setup: *Set up Chief* starts its New project; once its container is added, HQ marks it
 * as the organization's Chief; *Try again* resumes the step that stopped. Mounted
 * once, above every view: its presses reach the page through `startChiefSetup` and
 * `tryChiefSetupAgain`.
 */
export function useChiefSetupRunner(): {
  readonly start: () => void;
  readonly again: () => void;
} {
  const { user, activeOrganization } = useZeropsSession();
  const accountHq = useAccountHq(activeOrganization?.id);
  const hqOpen = accountHq.hq.kind === "official";
  const operations = useAccountOperationsOptional();
  const runNewProject = useRunNewProject();
  const { setup, orgId } = useChiefSetupStore();
  const own = useOwnChief();
  const birthId = setup.phase === "idle" ? null : setup.birthId;
  const creation = useCreation(birthId ?? "");
  const presses = useMatePresses();
  const press =
    creation?.projectId == null
      ? undefined
      : presses.find((entry) => entry.projectId === creation.projectId);

  const start = useCallback(() => {
    if (activeOrganization === null || accountHq.hq.kind !== "official") return;
    if (useChiefSetupStore.getState().setup.phase !== "idle") return;
    const ask: NewProjectAsk = {
      organizationId: activeOrganization.id,
      birthId: generateZeropsGroupId((bytes) => crypto.getRandomValues(bytes)),
      ...chiefNames(user),
      face: CHIEF_FACE,
      locationId: null,
      // Every agent: it runs on the person's own sign-in, whichever they use.
      agents: [],
      chief: true,
    };
    useChiefSetupStore.setState({ orgId: activeOrganization.id, startedAtMs: Date.now() });
    dispatch({ type: "start", birthId: ask.birthId });
    beginCreation({ ask, hq: officialHq(accountHq), now: Date.now(), run: runNewProject });
  }, [accountHq, activeOrganization, runNewProject, user]);

  const again = useCallback(() => {
    if (setup.phase !== "failed") return;
    if (setup.step === "project") {
      // The same creation, resumed where it stopped: never a second project.
      if (creation?.failed != null) tryCreationAgain(creation);
      else if (press?.state.kind === "failed") void press.state.retry?.();
    }
    dispatch({ type: "again" });
  }, [creation, press, setup]);

  // Its project: made once its container is added.
  const progress = useMemo(
    () => chiefProjectProgress({ creation: creation ?? undefined, press }),
    [creation, press],
  );
  const awaitingProject = setup.phase === "running" && setup.step === "project";
  useEffect(() => {
    if (!awaitingProject) return;
    if (progress.kind === "made") dispatch({ type: "project-made", projectId: progress.projectId });
    else if (progress.kind === "failed") dispatch({ type: "failed", reason: progress.reason });
  }, [awaitingProject, progress]);

  // HQ's mark on its project, once at a time.
  const finishing = useRef(false);
  const chiefProject = setup.phase === "running" && setup.step === "hq" ? setup.projectId : null;
  useEffect(() => {
    if (chiefProject === null || !hqOpen || operations === null || orgId === null) return;
    if (finishing.current) return;
    finishing.current = true;
    void finishChiefSetup({
      projectId: chiefProject,
      setChief: (projectId) =>
        operations.run(
          { kind: "set-chief", orgId, projectId },
          { orgId, unobserved: HQ_UNFOLLOWED },
        ),
      dispatch,
    }).finally(() => {
      finishing.current = false;
    });
  }, [chiefProject, hqOpen, operations, orgId]);

  useEffect(() => {
    if (orgId === activeOrganization?.id && setup.phase === "done" && own === setup.projectId) {
      dispatch({ type: "observed", projectId: own });
    }
  }, [activeOrganization?.id, orgId, own, setup]);

  useEffect(() => {
    runnerPresses = { start, again };
    return () => {
      runnerPresses = null;
    };
  }, [again, start]);

  return { start, again };
}
