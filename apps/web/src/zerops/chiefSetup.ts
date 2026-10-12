/**
 * Setting up the person's Chief, as this tab runs it (`chiefSetup.logic.ts`): the dialog that
 * explains it, the New project that makes its project and container, HQ's record of it, and its
 * zcp handed the organization's view as the person.
 *
 * Its state is this tab's memory: what a step needs survives the dialog closing, not a reload.
 */
import { NOT_READ_VAULT, serviceVariableIds } from "@t3tools/client-runtime/data";
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
import { officialHq, useAccountHq, useOfficialHq } from "./accountHq";
import { onAccountLifetimeClose } from "./accountLifetime";
import { chiefNames, chiefSetupLine } from "./chief";
import { beginCreation, tryCreationAgain, useCreation } from "./creations";
import { useMatePresses } from "./matePress";
import type { NewProjectAsk } from "./newProjectBirth";
import { useDetailDemand, useProjection, useProjectServices } from "./accountData";
import { useKeepOwnChief, useOwnChief } from "./ownChief";
import { useOrgOffers } from "./useHqOffers";
import { useRunNewProject } from "./useRunNewProject";
import { useZeropsSession } from "./ZeropsSessionProvider";

interface ChiefSetupState {
  /** The dialog is open. */
  readonly open: boolean;
  /** The organization the setup runs in. */
  readonly orgId: string | null;
  readonly setup: ChiefSetup;
}

const INITIAL: ChiefSetupState = { open: false, orgId: null, setup: CHIEF_SETUP_IDLE };

const useChiefSetupStore = create<ChiefSetupState>(() => INITIAL);

onAccountLifetimeClose(() => useChiefSetupStore.setState(INITIAL));

/** Opens the dialog: from the menu's line, or an ask of the Chief where the person has none. */
export function openChiefSetup(): void {
  useChiefSetupStore.setState({ open: true });
}

export function closeChiefSetup(): void {
  useChiefSetupStore.setState({ open: false });
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

/** What the menu says of setting up a Chief beside its Overview row (`chiefSetupLine`). */
export function useChiefSetupLine(): ReturnType<typeof chiefSetupLine> {
  const own = useOwnChief();
  const { setup } = useChiefSetup();
  const mayCreate = useOrgOffers()("create_app").kind === "allowed";
  return chiefSetupLine({ own, mayCreate, setup: setup.phase });
}

const NO_IDS = Atom.make<Readonly<Record<string, string>> | null>(null);

/** The face a Chief's record carries: every surface draws a Chief as the product's mark. */
const CHIEF_FACE = { tint: "slate", shape: MATE_SHAPE_OF_TINT.slate } as const;

/**
 * Runs the setup: *Set up Chief* starts its New project; once its container is added, HQ records
 * it and its zcp is handed what HQ answered; *Try again* resumes the step that stopped. Mounted
 * once, with the dialog.
 */
export function useChiefSetupRunner(): {
  readonly start: () => void;
  readonly again: () => void;
} {
  const { user, activeOrganization } = useZeropsSession();
  const accountHq = useAccountHq(activeOrganization?.id);
  const official = useOfficialHq();
  const runNewProject = useRunNewProject();
  const keep = useKeepOwnChief();
  const { setup, orgId } = useChiefSetupStore();
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
    useChiefSetupStore.setState({ orgId: activeOrganization.id });
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
    if (chiefProject === null || official === null || orgId === null || serviceId === undefined)
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
      setChief: (projectId) => official.api.setChief(projectId),
      writeVariables,
      dispatch,
    }).finally(() => {
      finishing.current = false;
    });
  }, [chiefProject, official, orgId, run, serviceId]);

  // Set up: the menu's top row is the Chief, coming up as any new Mate does.
  const doneProject = setup.phase === "done" ? setup.projectId : null;
  useEffect(() => {
    if (doneProject === null || orgId === null) return;
    keep(orgId, doneProject);
    closeChiefSetup();
  }, [doneProject, keep, orgId]);

  return { start, again };
}
