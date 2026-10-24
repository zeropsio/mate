/**
 * Setting up the person's Chief, as this tab runs it (`chiefSetup.logic.ts`): the New project that
 * makes its project and container, HQ's record of it, and its zcp handed the organization's view as
 * the person. The Chief page shows it and presses it (`ChiefPage`); the runner is mounted once,
 * above every view (`ChiefSetupHost`), so its steps run on wherever the person goes.
 *
 * Its state is this tab's memory: it survives leaving the page, not a reload.
 */
import { useRoleOffers } from "./usePlatformCapabilities";
import {
  NOT_READ_VAULT,
  serviceVariableIds,
  shownProjectsAtom,
} from "@t3tools/client-runtime/data";
import { useAtomValue } from "@effect/atom-react";
import { Atom } from "effect/reactivity";
import { generateZeropsGroupId } from "@t3tools/client-runtime/zerops";
import { MATE_SHAPE_OF_TINT } from "@t3tools/shared/brand";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { create } from "zustand";

import {
  CHIEF_SETUP_IDLE,
  chiefProjectProgress,
  chiefServiceOf,
  chiefSetupAfter,
  chiefVariableWrites,
  finishChiefSetup,
  type ChiefSetup,
  type ChiefSetupEvent,
  type ChiefVariable,
} from "../components/zerops/chief/chiefSetup.logic";
import { useVaultWriter } from "../components/zerops/vault/VaultPanelContainer";
import { officialHq, useAccountHq } from "./accountHq";
import { onAccountLifetimeClose } from "./accountLifetime";
import { HQ_UNFOLLOWED, useAccountOperationsOptional } from "./accountOperations";
import { chiefNames, chiefOffered, chiefSetupEntry, chiefSetupLine, othersChiefs } from "./chief";
import { takeChiefAccess } from "./chiefAccess";
import { beginCreation, tryCreationAgain, useCreation } from "./creations";
import { useMatePresses } from "./matePress";
import type { NewProjectAsk } from "./newProjectBirth";
import { useDetailDemand, useProjection, useProjectServices } from "./accountData";
import { useOrgChief } from "./orgChief";
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

/**
 * Finishes a Chief whose zcp holds no access — a reload between HQ's answer and its writes left
 * it so: HQ is asked again, and its fresh credential written, with the Chief page showing the steps.
 */
export function resumeChiefSetup(orgId: string, projectId: string): void {
  useChiefSetupStore.setState((state) => ({
    orgId,
    setup: chiefSetupAfter(state.setup, { type: "resume", projectId }),
    startedAtMs: null,
  }));
}

/** Whether the person's own Chief stands without its access: its zcp holds no `ZCP_ORG_TOKEN`. */
export function useChiefUnfinished(projectId: string | null): boolean {
  const { activeOrganization } = useZeropsSession();
  const orgId = activeOrganization?.id ?? null;
  const { setup } = useChiefSetupStore();
  useDetailDemand("serviceVariable", undefined, projectId);
  const serviceId = chiefServiceOf(useProjectServices(projectId).services);
  const ids = useProjection(
    serviceVariableIds,
    orgId === null || projectId === null || serviceId === undefined
      ? null
      : { orgId, projectId, serviceId },
    NO_IDS,
  );
  return setup.phase === "idle" && ids !== null && ids["ZCP_ORG_TOKEN"] === undefined;
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
  const own = useOrgChief();
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
  const own = useOrgChief();
  const { setup } = useChiefSetup();
  const mayCreate = useOrgOffers()("create_app").kind === "allowed";
  return chiefSetupLine({ own, mayCreate, setup: setup.phase });
}

/** HQ recorded the Chief, yet its access did not reach this set-up: asking again mints a fresh one. */
const CHIEF_ACCESS_LOST =
  "HQ recorded your Chief, but its access did not reach this tab. Try again.";

const NO_IDS = Atom.make<Readonly<Record<string, string>> | null>(null);

/** The face a Chief's record carries: every surface draws a Chief as the product's mark. */
const CHIEF_FACE = { tint: "slate", shape: MATE_SHAPE_OF_TINT.slate } as const;

/**
 * Runs the setup: *Set up Chief* starts its New project; once its container is added, HQ records
 * it and its zcp is handed what HQ answered; *Try again* resumes the step that stopped. Mounted
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
  const own = useOrgChief();
  const birthId = setup.phase === "idle" ? null : setup.birthId;
  const creation = useCreation(birthId ?? "");
  const presses = useMatePresses();
  const press =
    creation?.projectId == null
      ? undefined
      : presses.find((entry) => entry.projectId === creation.projectId);
  const { run } = useVaultWriter(undefined, NOT_READ_VAULT);

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

  // Its zcp and the values it holds, read while its access is handed over: what each write adds
  // or writes over, and what the vault's writes wait to see.
  const madeProject =
    (setup.phase === "running" || setup.phase === "failed") && setup.step !== "project"
      ? setup.projectId
      : null;
  useDetailDemand("serviceVariable", undefined, madeProject);
  useDetailDemand("projectVariables", undefined, madeProject);
  useDetailDemand("process", "history", madeProject);
  const serviceId = chiefServiceOf(useProjectServices(madeProject).services);
  const ids = useProjection(
    serviceVariableIds,
    orgId === null || madeProject === null || serviceId === undefined
      ? null
      : { orgId, projectId: madeProject, serviceId },
    NO_IDS,
  );
  const idsNow = useRef(ids);
  useEffect(() => {
    idsNow.current = ids;
  }, [ids]);

  // HQ's record and its zcp's access, once at a time, once its zcp and its values are read.
  const finishing = useRef(false);
  const chiefProject =
    setup.phase === "running" && setup.step === "hq" && serviceId !== undefined && ids !== null
      ? setup.projectId
      : null;
  useEffect(() => {
    if (
      chiefProject === null ||
      !hqOpen ||
      operations === null ||
      orgId === null ||
      serviceId === undefined
    )
      return;
    if (finishing.current) return;
    finishing.current = true;
    const writeVariables = async (values: ReadonlyArray<ChiefVariable>) => {
      // Written over where a stopped setup left them: a fresh credential replaces a revoked one.
      for (const write of chiefVariableWrites(values, idsNow.current ?? {})) {
        const outcome = await run({
          kind: "vault-write",
          orgId,
          projectId: chiefProject,
          scope: { kind: "service", serviceId },
          write,
        });
        if (!outcome.ok) throw new Error(outcome.message ?? `Zerops did not take ${write.key}.`);
      }
    };
    void finishChiefSetup({
      projectId: chiefProject,
      // HQ records it as the account's operation; its access is handed here alone, once.
      setChief: async (projectId) => {
        await operations.run(
          { kind: "set-chief", orgId, projectId },
          { orgId, unobserved: HQ_UNFOLLOWED },
        );
        const access = takeChiefAccess(projectId);
        if (access === undefined) throw new Error(CHIEF_ACCESS_LOST);
        return access;
      },
      writeVariables,
      dispatch,
    }).finally(() => {
      finishing.current = false;
    });
  }, [chiefProject, hqOpen, operations, orgId, run, serviceId]);

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
