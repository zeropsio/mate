/**
 * Setting up the person's Chief, as this tab sends it (`chiefSetup.logic.ts`): one Create at HQ,
 * whose birth makes its project and container and registers it as the person's Chief. The Chief
 * page shows it and presses it (`ChiefPage`); the runner is mounted once, above every view
 * (`ChiefSetupHost`), so it follows the setup wherever the person goes.
 *
 * Its state is this tab's memory: it survives leaving the page, not a reload. HQ's birth, which
 * every surface reads first (`useOwnChiefBirth`), survives both.
 */
import { useRoleOffers } from "./usePlatformCapabilities";
import { randomUUID } from "~/lib/utils";
import { MATE_SHAPE_OF_TINT } from "@t3tools/shared/brand";
import { useCallback, useEffect } from "react";
import { create } from "zustand";

import {
  CHIEF_SETUP_IDLE,
  chiefBirthEvent,
  chiefSetupAfter,
  type ChiefSetup,
  type ChiefSetupEvent,
} from "./chiefSetup.logic";
import { configuredHq } from "./accountHq";
import { onAccountLifetimeClose } from "./accountLifetime";
import { chiefNames, chiefSetupEntry, chiefSetupLine } from "@t3tools/client-runtime/zerops/chief";
import { beginCreation, tryCreationAgain, useCreation } from "./creations";
import type { NewProjectAsk } from "./newProjectBirth";
import { useHqOwnChief, useOwnChief } from "./ownChief";
import { useOrgOffers } from "./useHqOffers";
import { useCreateBirth } from "./useRunNewProject";
import { useZeropsSession } from "./ZeropsSessionProvider";
import { sharedBirthPresentation, useOwnChiefBirth } from "./sharedBirths";

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

/** *Try again*: the mounted runner sends the same Create again, under the same birth id. */
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
 * Whether the account menu offers *Set up Chief*: to a person who may set one up and has none,
 * however many projects the organization holds — from HQ's current verdict, the setup state and
 * the viewer's role: a Chief is a project of their own, so a role that may not create projects is
 * offered none.
 */
export function useChiefSetupEntry(): boolean {
  const own = useHqOwnChief();
  const { setup } = useChiefSetup();
  const offered = useRoleOffers().setUpChief;
  const birth = useOwnChiefBirth();
  return birth === undefined && offered && chiefSetupEntry(own, setup.phase);
}

/** Where setting up a Chief stands, as the menu's top row says it (`chiefSetupLine`). */
export function useChiefSetupLine(): ReturnType<typeof chiefSetupLine> {
  const own = useOwnChief();
  const { setup } = useChiefSetup();
  const mayCreate = useOrgOffers()("create_app").kind === "allowed";
  const birth = useOwnChiefBirth();
  if (birth !== undefined) return sharedBirthPresentation(birth).attention ? "stopped" : "running";
  return chiefSetupLine({ own, mayCreate, setup: setup.phase });
}

/** The face a Chief's record carries: every surface draws a Chief as the product's mark. */
const CHIEF_FACE = { tint: "slate", shape: MATE_SHAPE_OF_TINT.slate } as const;

/**
 * Runs the setup: *Set up Chief* sends its one Create (`create-birth`, placed as the person's
 * Chief); HQ runs its birth and registers the Chief, and the setup follows that birth until the
 * person's Chief is observed; *Try again* sends the same Create where HQ refused it or did not
 * answer. Mounted once, above every view: its presses reach the page through `startChiefSetup`
 * and `tryChiefSetupAgain`.
 */
export function useChiefSetupRunner(): {
  readonly start: () => void;
  readonly again: () => void;
} {
  const { user, activeOrganization } = useZeropsSession();
  const createBirth = useCreateBirth();
  const { setup, orgId } = useChiefSetupStore();
  const own = useOwnChief();
  const ownBirth = useOwnChiefBirth();
  const birthId = setup.phase === "idle" ? null : setup.birthId;
  const creation = useCreation(birthId ?? "");

  const start = useCallback(() => {
    if (activeOrganization === null || ownBirth !== undefined) return;
    if (useChiefSetupStore.getState().setup.phase !== "idle") return;
    const ask: NewProjectAsk = {
      organizationId: activeOrganization.id,
      creator: activeOrganization.membershipId,
      creatorRole: activeOrganization.roleCode,
      birthId: randomUUID(),
      ...chiefNames(user),
      face: CHIEF_FACE,
      locationId: null,
      // Every agent: it runs on the person's own sign-in, whichever they use.
      agents: [],
      chief: true,
    };
    useChiefSetupStore.setState({ orgId: activeOrganization.id, startedAtMs: Date.now() });
    dispatch({ type: "start", birthId: ask.birthId });
    beginCreation({ ask, hq: configuredHq(), now: Date.now(), run: createBirth });
  }, [activeOrganization, createBirth, ownBirth, user]);

  const again = useCallback(() => {
    if (setup.phase !== "failed") return;
    // The same Create, under the same birth id: HQ makes it once.
    if (creation?.failed != null) tryCreationAgain(creation);
    dispatch({ type: "again" });
  }, [creation, setup]);

  // Its Create: HQ's refusal, or its silence, stops the setup in HQ's words.
  const refused = setup.phase === "running" ? (creation?.failed?.reason ?? null) : null;
  useEffect(() => {
    if (refused !== null) dispatch({ type: "failed", reason: refused });
  }, [refused]);

  // HQ's birth of it: made once it took its project; released once it stopped, its row saying why.
  const event = chiefBirthEvent(
    birthId !== null && ownBirth?.id === birthId ? ownBirth : undefined,
  );
  const madeProject = event?.type === "made" ? event.projectId : null;
  const released = event?.type === "released";
  useEffect(() => {
    if (released) dispatch({ type: "released" });
    else if (madeProject !== null) dispatch({ type: "made", projectId: madeProject });
  }, [madeProject, released]);

  // The person's Chief, once HQ supplies it, ends the setup (`chiefSetupAfter`).
  const settingUp = setup.phase !== "idle";
  useEffect(() => {
    if (orgId === activeOrganization?.id && settingUp && typeof own === "string") {
      dispatch({ type: "observed", projectId: own });
    }
  }, [activeOrganization?.id, orgId, own, settingUp]);

  useEffect(() => {
    runnerPresses = { start, again };
    return () => {
      runnerPresses = null;
    };
  }, [again, start]);

  return { start, again };
}
