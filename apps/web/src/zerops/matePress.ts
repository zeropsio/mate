/**
 * The press: everything a new environment needs the person's rights for, done in the foreground
 * before Add returns (pass 28; the owner: "this should never ever be tied to user having to have
 * browser open"). For a Mate: its project, its key and its container (`ZCP_API_KEY`, with the
 * tier's runtimes for zcp to import on boot), its project closed off, its registration written.
 * Every step is safe to ask again, so a press that stopped resumes where it stopped, and a
 * half-made Mate is finished from its ⋯ menu, in any browser, by an owner or an admin (*Finish
 * setup*) — the same steps.
 *
 * After the press the container does the rest — zcp imports the runtimes, the broker delivers Git,
 * the server starts the stand-up — and any browser, or none, reads where that stands off
 * `/mate/setup.json` (`mateSetup.ts`).
 *
 * This tab keeps what it pressed, in memory, for as long as the screen needs it: where a new
 * environment is drawn before the listing holds it, and where its press stopped and how to try
 * again. Nothing is stored: a reload forgets it, and the listing — the project is tagged into its
 * group at birth — draws the rest.
 */
import {
  canWriteRegistry,
  findHeldMateKey,
  isZeropsMateClosedOff,
  planGroupReach,
  PRESS_STEP_ATTEMPTS,
  PRESS_STEP_RETRY_MS,
  PROJECT_ENV_ISOLATION_KEY,
  resumableEnvironmentCreationStep,
  runEnvironmentCreation,
  type BirthPlacement,
  type EnvironmentCreationOutcome,
  type EnvironmentCreationPlatform,
  type EnvironmentCreationStep,
  type EnvironmentCreationStepProgress,
  type RecipeRuntime,
  type ZeropsAgentType,
  type ZeropsApiClient,
  type ZeropsGroupReachWrite,
  type ZeropsIntegrationToken,
  type TokenWriteHold,
  type ZeropsPlacedBirth,
} from "@t3tools/client-runtime/zerops";
import { ZeropsServiceId } from "@t3tools/client-runtime/zerops/data";
import { zeropsErrorMessage } from "@t3tools/client-runtime/zerops/errors";
import type { RoleProjectKind } from "@t3tools/shared/zeropsRoles";
import { useEffect, useMemo } from "react";
import { create } from "zustand";

import { onAccountLifetimeClose } from "./accountLifetime";
import { tokenWrites } from "./tokenWriteLock";
import {
  browserLocks,
  matePressLockName,
  withExclusiveLock,
  withLockIfFree,
  type LockManagerLike,
} from "./mateLocks";
import { giteaClientFor } from "./accountGiteaSessions";
import { addGroupEnvironment, writeRegistryMember } from "./addGroupEnvironment";
import { brokerGrantTokens, grantBrokerProject, projectTagsWrite } from "./brokerGrant";
import {
  pressSteps,
  pressThrough,
  type PressStepView,
} from "../components/zerops/ZeropsEnvironmentCreationDialog.logic";
import { placedNewProjects, type NewProjectBirth } from "./newProjectBirth";
import {
  runZeropsCommand,
  useZeropsAtomSelections,
  type ZeropsDataContextValue,
} from "./zeropsDataContext";

/** Where a press stands. */
export type MatePressState =
  | { readonly kind: "pressing" }
  /** Every step is through: the container does the rest. */
  | { readonly kind: "pressed" }
  | {
      readonly kind: "failed";
      readonly step: EnvironmentCreationStep["kind"];
      readonly reason: string;
      /** Tries the press again from the step that stopped; null where that is not safe. */
      readonly retry: (() => Promise<void>) | null;
    };

/** A press this tab made, from the moment the platform took its project. */
export interface MatePress {
  readonly projectId: string;
  /** The organization the project was created in — never the one a tab has open now. */
  readonly organizationId: string;
  /** When the platform took the project, wall ms. */
  readonly startedAt: number;
  /** Its group, as the press knew it; null for a project already listed. */
  readonly placement: BirthPlacement | null;
  /** Whether a Mate container comes up at all: false for a stage or a production. */
  readonly container: boolean;
  /** Its copy's managed services, by hostname in the tier's order. */
  readonly managed?: ReadonlyArray<string>;
  /** The runtimes zcp imports on boot, as the plan named them. */
  readonly runtimes?: ReadonlyArray<RecipeRuntime>;
  /** *Finish setup* on a Mate made before, not an Add: its view draws the steps and their end. */
  readonly finishing?: boolean;
  /** Each step's state as the press moves. */
  readonly progress?: ReadonlyArray<EnvironmentCreationStepProgress>;
  readonly state: MatePressState;
}

interface MatePressStore {
  readonly presses: Readonly<Record<string, MatePress>>;
}

const usePressStore = create<MatePressStore>(() => ({ presses: {} }));

onAccountLifetimeClose(() => {
  usePressStore.setState({ presses: {} });
});

/** The platform took the project of a press: it is drawn from now on. */
export function beginPress(press: Omit<MatePress, "state">): void {
  usePressStore.setState((store) => ({
    presses: { ...store.presses, [press.projectId]: { ...press, state: { kind: "pressing" } } },
  }));
}

/** A press ran to its end, or stopped. */
export function settlePress(projectId: string, state: MatePressState): void {
  usePressStore.setState((store) => {
    const press = store.presses[projectId];
    if (press === undefined) return store;
    return { presses: { ...store.presses, [projectId]: { ...press, state } } };
  });
}

/** A press moved on: each step's state, kept on a press this tab holds. */
export function progressPress(
  projectId: string,
  progress: ReadonlyArray<EnvironmentCreationStepProgress>,
): void {
  usePressStore.setState((store) => {
    const press = store.presses[projectId];
    if (press === undefined) return store;
    return { presses: { ...store.presses, [projectId]: { ...press, progress } } };
  });
}

/**
 * Whether a press is over at this progress: its project marked closed off — the Mate needs no
 * browser — and its registration through or refused. Its record then goes; *Finish setup*'s after
 * its view has said it is done for a moment ({@link FINISHED_SHOWN_MS}), never waiting for a
 * connect that may not come.
 */
export function pressDoneAt(progress: ReadonlyArray<EnvironmentCreationStepProgress>): boolean {
  return pressThrough(progress);
}

/** How long Finish setup's view says it is done before its record goes. */
export const FINISHED_SHOWN_MS = 4_000;

/** A press is over: its record goes, Finish setup's after its view has said it is done. */
function endPress(projectId: string, finishing: boolean): void {
  if (!finishing) {
    forgetPress(projectId);
    return;
  }
  settlePress(projectId, { kind: "pressed" });
  setTimeout(() => {
    if (readMatePress(projectId)?.state.kind === "pressed") forgetPress(projectId);
  }, FINISHED_SHOWN_MS);
}

/** The presses whose Mate has connected: nothing of them is left to say. */
export function connectedPresses(
  presses: ReadonlyArray<MatePress>,
  candidates: ReadonlyArray<{ readonly project: { readonly id: string }; readonly group: string }>,
): ReadonlyArray<string> {
  const connected = new Set(
    candidates.flatMap((candidate) =>
      candidate.group === "connected" ? [candidate.project.id] : [],
    ),
  );
  return presses.flatMap((press) => (connected.has(press.projectId) ? [press.projectId] : []));
}

/** Ends the presses whose Mate has connected, as the listing reads them. */
export function useForgetConnectedPresses(
  candidates: ReadonlyArray<{ readonly project: { readonly id: string }; readonly group: string }>,
): void {
  const presses = useMatePresses();
  useEffect(() => {
    for (const projectId of connectedPresses(presses, candidates)) forgetPress(projectId);
  }, [candidates, presses]);
}

/**
 * The projects whose press or harden this tab is running — auto-connect holds them back
 * (`environments.ts`'s `pressing` port) — and a way to hear them change.
 */
export const pressingProjects = {
  read: (): ReadonlySet<string> =>
    new Set(
      Object.values(usePressStore.getState().presses).flatMap((press) =>
        press.state.kind === "pressing" ? [press.projectId] : [],
      ),
    ),
  subscribe: (listener: () => void): (() => void) => usePressStore.subscribe(listener),
};

/** The press this tab holds for a project, read outside a render. */
export function readMatePress(projectId: string): MatePress | undefined {
  return usePressStore.getState().presses[projectId];
}

/** The project is gone: nothing more is said of it. */
export function forgetPress(projectId: string): void {
  usePressStore.setState((store) => {
    if (store.presses[projectId] === undefined) return store;
    const { [projectId]: _gone, ...rest } = store.presses;
    return { presses: rest };
  });
}

/** Every press this tab made. */
export function useMatePresses(): ReadonlyArray<MatePress> {
  const presses = usePressStore((store) => store.presses);
  return useMemo(() => Object.values(presses), [presses]);
}

/** The press this tab made for a project, if any. */
export function useMatePress(projectId: string | undefined): MatePress | undefined {
  return usePressStore((store) => (projectId === undefined ? undefined : store.presses[projectId]));
}

/** Why a press stopped, in words, while it is stopped. */
export function pressFailure(press: MatePress | undefined): string | undefined {
  return press?.state.kind === "failed" ? press.state.reason : undefined;
}

/** A Mate closed off and running whose registration was refused: an owner finishes it. */
const AWAITING_OWNER_LINE = "It still needs an owner to register it.";

/** *Finish setup* through its close-off: the container does the rest. */
export const FINISHED_SETUP_LINE =
  "Its setup is finished. It comes up on its own now, with no browser needed.";

/**
 * *Finish setup* as a Mate's own view draws it: the steps the Add dialog draws, and — once its
 * project is marked closed off — a clear end. Undefined for any other press. A step that stops is
 * said by the press's failure (`pressFailure`), with *Try again*.
 */
export function finishSetupView(press: MatePress | undefined):
  | {
      readonly steps: ReadonlyArray<PressStepView>;
      readonly line: string;
      readonly done: boolean;
    }
  | undefined {
  if (press?.finishing !== true) return undefined;
  const progress = press.progress ?? [];
  const registered = progress.find((entry) => entry.step.kind === "register");
  const steps = pressSteps(progress);
  const done = press.state.kind === "pressed";
  return {
    steps,
    line: !done
      ? "Finishing its setup…"
      : registered?.state === "failed"
        ? `${FINISHED_SETUP_LINE} ${AWAITING_OWNER_LINE}`
        : FINISHED_SETUP_LINE,
    done,
  };
}

/** Each step of a press, as a person names it where it stopped. */
const PRESS_STEP_NAMES: Readonly<Record<EnvironmentCreationStep["kind"], string>> = {
  "create-project": "Creating the project",
  "import-project": "Creating the project",
  "import-managed": "Adding its services",
  "import-recipe": "Adding its services",
  "import-container": "Adding its container",
  "close-off": "Closing the project off",
  "share-reach": "Letting the project's other Mates see it",
  register: "Registering it",
  "await-ready": "Waiting for it",
};

/** Where a press stopped and why, in one line: "Closing the project off stopped: …". */
export function pressFailureLine(press: MatePress | undefined): string | undefined {
  if (press?.state.kind !== "failed") return undefined;
  return `${PRESS_STEP_NAMES[press.state.step]} stopped: ${press.state.reason}`;
}

/** A press as `mateComing` reads it. */
export function pressComing(press: MatePress | undefined):
  | {
      readonly startedAt: number;
      readonly container: boolean;
      readonly retryable: boolean;
    }
  | undefined {
  if (press === undefined) return undefined;
  return {
    startedAt: press.startedAt,
    container: press.container,
    retryable: press.state.kind === "failed" && press.state.retry !== null,
  };
}

/** Where a Mate this tab pressed stands, as every surface asks `mateComing` about it. */
export function pressComingInput(
  presses: ReadonlyArray<MatePress>,
  projectId: string,
): {
  readonly press: ReturnType<typeof pressComing>;
  readonly setUpFailed: string | undefined;
} {
  const press = presses.find((entry) => entry.projectId === projectId);
  return { press: pressComing(press), setUpFailed: pressFailure(press) };
}

/**
 * The creations this tab pressed in the organization in view, as the group tree places them
 * (`deriveZeropsGroups`' `births`): the projects page and the left menu read this one mapping, so
 * the two draw the same pending members. A press on a project already listed places nothing. The
 * New projects this tab is still making come after them, drawn from their press.
 */
export function placedPressesIn(
  presses: ReadonlyArray<MatePress>,
  organizationId: string | undefined,
  made: ReadonlyArray<NewProjectBirth> = [],
): ReadonlyArray<ZeropsPlacedBirth> {
  return [
    ...presses.flatMap(({ projectId, organizationId: madeIn, startedAt, placement }) =>
      placement === null || organizationId === undefined || madeIn !== organizationId
        ? []
        : [{ projectId, startedAt, placement }],
    ),
    ...placedNewProjects(made, organizationId),
  ];
}

// ── The press's ports ────────────────────────────────────────────────────────────────────────

/** What a press acts through: the account's command layer and its API client. */
export interface PressInputs {
  readonly client: ZeropsApiClient;
  readonly data: Pick<ZeropsDataContextValue, "runtime" | "organizationRef" | "projectRef">;
  readonly organizationId: string;
}

/** The group registration a press writes, as the person who pressed may write it. */
export interface PressRegistration {
  /** The account's Gitea project, where the registry lives. */
  readonly giteaProjectId: string;
  /** The account's Gitea, where a stage or a production is declared. */
  readonly giteaOrigin: string | null;
  readonly groupId: string;
  readonly kind: RoleProjectKind;
  readonly displayName: string;
}

/**
 * The `register` step: a Mate's registry entry and the broker's grant where an older broker needs
 * one; for a stage or a production, `addGroupEnvironment` — the entry, the grant, its deploy token
 * and its declaration. Each write reads what is there first, so asking again writes nothing twice.
 */
export function pressRegistration(
  inputs: PressInputs,
  registration: PressRegistration,
): (projectId: string) => Promise<void> {
  const writeTags = projectTagsWrite(inputs.data, inputs.organizationId);
  return async (projectId) => {
    if (registration.kind === "mate") {
      const written = await writeRegistryMember({
        client: inputs.client,
        writeTags,
        giteaProjectId: registration.giteaProjectId,
        groupId: registration.groupId,
        projectId,
        member: "mate",
      });
      if (written.kind === "refused") throw new Error(written.refusal.reason);
      const grant = await grantBrokerProject({
        client: brokerGrantTokens(inputs.data.runtime),
        clientId: inputs.organizationId,
        projectId,
      });
      if (grant.kind === "failed") throw new Error(grant.reason);
      return;
    }
    const added = await addGroupEnvironment({
      client: inputs.client,
      tokens: brokerGrantTokens(inputs.data.runtime),
      writeTags,
      gitea: registration.giteaOrigin === null ? null : giteaClientFor(registration.giteaOrigin),
      clientId: inputs.organizationId,
      giteaProjectId: registration.giteaProjectId,
      groupId: registration.groupId,
      environment: {
        displayName: registration.displayName,
        tier: registration.kind,
        project: projectId,
      },
    });
    if (added.failed !== undefined) throw new Error(added.failed.reason);
  };
}

/** Whose press it is, for what it may write beyond its own project. */
export interface PressViewer {
  readonly userId: string;
  /** The org role, as the platform spells it. */
  readonly roleCode: string | undefined;
}

/** The person pressing, where the session names them. */
export function pressViewer(
  user: { readonly id: string } | null | undefined,
  organization: { readonly roleCode?: string | undefined } | null | undefined,
): PressViewer | null {
  return user === null || user === undefined
    ? null
    : { userId: user.id, roleCode: organization?.roleCode };
}

/**
 * The writes that give a group's other Mates sight of a new project: each Mate's key extended to
 * `READ_ONLY` on it (`planGroupReach`), where this person may edit the key — an org owner, or its
 * creator. A key that reads the project already, or that this person may not edit, is left alone;
 * the group-reach reconcile covers it later.
 */
export function planShareReach(input: {
  readonly tokens: ReadonlyArray<ZeropsIntegrationToken & { readonly createdByUser?: unknown }>;
  /** The group's other environments: the Mates among them are those a key writes. */
  readonly siblingProjectIds: ReadonlyArray<string>;
  readonly projectId: string;
  readonly viewer: PressViewer;
}): ReadonlyArray<ZeropsGroupReachWrite & { readonly roleCode: string | undefined }> {
  return input.siblingProjectIds.flatMap((mateProjectId) => {
    // The key its container holds; where two are its and nothing tells them apart, none.
    const token = findHeldMateKey(input.tokens, mateProjectId, undefined);
    if (token === undefined) return [];
    const editable =
      input.viewer.roleCode === "OWNER" ||
      (token as { readonly createdByUser?: unknown }).createdByUser === input.viewer.userId;
    if (!editable) return [];
    if ((token.projects ?? []).some((grant) => grant.projectId === input.projectId)) return [];
    const plan = planGroupReach({
      token,
      selfProjectId: mateProjectId,
      groupProjectIds: [...(token.projects ?? []).map((grant) => grant.projectId), input.projectId],
    });
    // The key's own org role goes round: the write replaces the whole record.
    return plan === undefined ? [] : [{ ...plan, name: token.name, roleCode: token.roleCode }];
  });
}

/**
 * Gives the group's other Mates sight of a new project: every environment the key mint counts
 * (`buildGroupGrants`), never the services listing, which a press seconds after a load may not
 * hold yet. A Mate's key is found in the account's token list (`findHeldMateKey`) and read again,
 * live, under its lock (`tokenWrites`, every token writer's) right before its write — the write
 * replaces the key's whole project list, so an older read would undo a grant made meanwhile.
 * Best-effort: a key it could not write is counted and left to the group-reach reconcile.
 */
export async function shareGroupReach(input: {
  readonly client: Pick<ZeropsApiClient, "listIntegrationTokens" | "setIntegrationTokenProjects">;
  readonly organizationId: string;
  readonly groupProjectIds: ReadonlyArray<string>;
  readonly projectId: string;
  readonly viewer: PressViewer;
  /** Each key's read-then-write, one at a time with every other writer's; the page's own. */
  readonly hold?: TokenWriteHold;
}): Promise<{ readonly extended: number; readonly failed: number }> {
  const hold = input.hold ?? tokenWrites;
  const plan = (tokens: ReadonlyArray<ZeropsIntegrationToken>, siblingProjectId: string) =>
    planShareReach({
      tokens,
      siblingProjectIds: [siblingProjectId],
      projectId: input.projectId,
      viewer: input.viewer,
    })[0];
  let extended = 0;
  let failed = 0;
  for (const siblingProjectId of input.groupProjectIds) {
    if (siblingProjectId === input.projectId) continue;
    try {
      // A read that only finds the key; the write is planned from one read under its lock.
      const found = plan(
        await input.client.listIntegrationTokens(input.organizationId),
        siblingProjectId,
      );
      if (found === undefined) continue;
      const wrote = await hold(found.tokenId, async () => {
        const write = plan(
          await input.client.listIntegrationTokens(input.organizationId),
          siblingProjectId,
        );
        if (write?.tokenId !== found.tokenId) return false;
        await input.client.setIntegrationTokenProjects({
          clientId: input.organizationId,
          tokenId: write.tokenId,
          name: write.name,
          projects: write.projects,
          roleCode: write.roleCode,
        });
        return true;
      });
      if (wrote) extended += 1;
    } catch {
      failed += 1;
    }
  }
  return { extended, failed };
}

/** The press's platform calls, through the account's command layer. */
export function pressPlatform(
  inputs: PressInputs,
  options: {
    /** The group's other environments: the Mate's key reads them. */
    readonly groupProjectIds: ReadonlyArray<string>;
    readonly viewer: PressViewer | null;
    /** Null where the press writes no registration. */
    readonly register: ((projectId: string) => Promise<void>) | null;
    readonly readObservedServices: EnvironmentCreationPlatform["readObservedServices"];
  },
): EnvironmentCreationPlatform {
  const { client, data, organizationId } = inputs;
  const organization = data.organizationRef(organizationId);
  const projectOf = (projectId: string) => data.projectRef(organizationId, projectId);
  return {
    createProject: ({ clientId: _clientId, ...input }) =>
      runZeropsCommand(data.runtime.commands.createProject({ organization, ...input })),
    // Reads, not writes: the platform's verdict on what the press made, waited on by the runner.
    readProjectCreation: (input) => client.readProjectCreation(input),
    importDevelopmentContainer: ({ projectId, projectName, agents, setupRuntimesYaml }) =>
      runZeropsCommand(
        data.runtime.commands.importDevelopmentContainer({
          project: projectOf(projectId),
          projectName,
          agents,
          groupProjectIds: [...options.groupProjectIds, projectId],
          ...(setupRuntimesYaml === undefined ? {} : { setupRuntimesYaml }),
        }),
      ),
    importServices: (projectId, yaml) =>
      runZeropsCommand(data.runtime.commands.importServices(projectOf(projectId), yaml)),
    importProject: ({ clientId: _clientId, yaml }) =>
      runZeropsCommand(data.runtime.commands.importProject(organization, yaml)),
    // The same hardening a Mate made before this pass is finished with: for a key the press
    // minted it writes nothing to the key, and closes the project off.
    closeOff: async (projectId) => {
      await runZeropsCommand(data.runtime.commands.isolateProjectEnv(projectOf(projectId)));
    },
    readIsolation: async (projectId) =>
      (await client.readProjectEnv(organizationId, projectId)).find(
        (entry) => entry.key === PROJECT_ENV_ISOLATION_KEY,
      )?.content,
    markClosedOff: async (projectId) => {
      const written = await runZeropsCommand(
        data.runtime.commands.updateProjectTags(projectOf(projectId), { kind: "closed-off" }),
      );
      if (written.kind === "refused") throw new Error(written.refusal.reason);
    },
    register: async (projectId) => {
      await options.register?.(projectId);
    },
    shareReach: async (projectId) => {
      const viewer = options.viewer;
      if (viewer === null) return;
      const shared = await shareGroupReach({
        client,
        organizationId,
        groupProjectIds: options.groupProjectIds,
        projectId,
        viewer,
      });
      // Said on its step, never swallowed: the group-reach reconcile gives the sight later.
      if (shared.failed > 0) {
        throw new Error(
          `${shared.failed} of the group's Mates could not be given sight of it yet.`,
        );
      }
    },
    readObservedServices: options.readObservedServices,
  };
}

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * Runs a press's steps and settles its record: through, or stopped at a step with the reason and
 * — where the step is safe to ask again — a way to try again from it, on the same project.
 */
export async function runPress(input: {
  readonly organizationId: string;
  readonly steps: ReadonlyArray<EnvironmentCreationStep>;
  readonly platform: EnvironmentCreationPlatform;
  readonly isCurrent: () => boolean;
  readonly resume?: {
    readonly from: number;
    readonly projectId: string;
    readonly projectName: string;
  };
  readonly onProjectAccepted?: (projectId: string, projectName: string) => void;
  readonly onProgress?: Parameters<typeof runEnvironmentCreation>[0]["onProgress"];
  /** This browser's locks; the page's own where omitted. */
  readonly locks?: LockManagerLike | undefined;
  /** The caller holds the project's press lock already (`finishMateSetup`). */
  readonly heldLock?: boolean;
  /** Between a step's tries and reads; the clock's own where omitted. */
  readonly sleep?: (ms: number) => Promise<void>;
}): Promise<EnvironmentCreationOutcome> {
  const locks = "locks" in input ? input.locks : browserLocks();
  const resume = input.resume;
  // One press or *Finish setup* per project at a time, across this browser's tabs.
  if (resume !== undefined && input.heldLock !== true) {
    return withLockIfFree(
      locks,
      matePressLockName(resume.projectId),
      () => pressRun({ ...input, locks, heldLock: true }),
      () => pressedElsewhere(input, resume),
    );
  }
  return pressRun({ ...input, locks });
}

/** What a press says where another tab is running one for the project. */
export const PRESSED_ELSEWHERE = "Its setup is already running in another tab.";

function pressedElsewhere(
  input: Parameters<typeof runPress>[0],
  resume: NonNullable<Parameters<typeof runPress>[0]["resume"]>,
): EnvironmentCreationOutcome {
  const failedStep = input.steps[resume.from] ?? input.steps[0]!;
  if (input.isCurrent()) {
    settlePress(resume.projectId, {
      kind: "failed",
      step: failedStep.kind,
      reason: PRESSED_ELSEWHERE,
      retry: async () => {
        settlePress(resume.projectId, { kind: "pressing" });
        await runPress(input);
      },
    });
  }
  return { ok: false, projectId: resume.projectId, failedStep, error: PRESSED_ELSEWHERE };
}

async function pressRun(
  input: Parameters<typeof runPress>[0],
): Promise<EnvironmentCreationOutcome> {
  let projectName = input.resume?.projectName ?? "";
  for (const step of input.steps) {
    if (step.kind === "create-project" || step.kind === "import-project") projectName = step.name;
  }
  // Each step's state is kept on the press, once the platform has taken its project.
  let accepted = input.resume?.projectId;
  // A new project's press holds its lock from the moment the platform takes it to its end.
  let ended: () => void = () => undefined;
  const end = new Promise<void>((resolve) => {
    ended = resolve;
  });
  const outcome = await runEnvironmentCreation({
    clientId: input.organizationId,
    steps: input.steps,
    platform: input.platform,
    isCurrent: input.isCurrent,
    describeError: zeropsErrorMessage,
    sleep: input.sleep ?? sleep,
    ...(input.resume === undefined ? {} : { resume: input.resume }),
    onProjectAccepted: (projectId) => {
      accepted = projectId;
      if (input.heldLock !== true) {
        void withExclusiveLock(input.locks, matePressLockName(projectId), () => end);
      }
      input.onProjectAccepted?.(projectId, projectName);
    },
    onProgress: (progress) => {
      if (accepted !== undefined && input.isCurrent()) {
        const held = readMatePress(accepted);
        progressPress(accepted, progress);
        // Closed off and registered: the Mate needs no browser, and its press record goes —
        // Finish setup's once its view has said so.
        if (held !== undefined && pressDoneAt(progress))
          endPress(accepted, held.finishing === true);
      }
      input.onProgress?.(progress);
    },
  }).finally(ended);
  const projectId = outcome.projectId;
  if (projectId === undefined || !input.isCurrent()) return outcome;
  if (outcome.ok) {
    settlePress(projectId, { kind: "pressed" });
    return outcome;
  }
  const from = input.steps.indexOf(outcome.failedStep);
  const retry = resumableEnvironmentCreationStep(outcome.failedStep)
    ? async () => {
        settlePress(projectId, { kind: "pressing" });
        await runPress({ ...input, heldLock: false, resume: { from, projectId, projectName } });
      }
    : null;
  settlePress(projectId, {
    kind: "failed",
    step: outcome.failedStep.kind,
    reason: outcome.error,
    retry,
  });
  return outcome;
}

/** Who may finish a Mate's setup: an owner or an admin, who may write its registration. */
export const canFinishMateSetup = canWriteRegistry;

/**
 * The press's steps on a Mate whose project exists: its container with its key — nothing written
 * where it has one — its project closed off, its registration. A New project's first Mate goes on
 * with them once the platform took its project; *Finish setup* runs them on a half-made Mate, in
 * any browser — for one made before this pass, the close-off also lowers a key still at `ADMIN`
 * and moves it off the project's variables (`hardenMate`).
 */
export async function finishMateSetup(input: {
  readonly inputs: PressInputs;
  readonly projectId: string;
  readonly projectName: string;
  /**
   * The container to import where the project has none, with these agents; null where the
   * caller just imported it — a listing read this soon may not show it yet, and a second import
   * would make a second container.
   */
  readonly container: { readonly agents: ReadonlyArray<ZeropsAgentType> } | null;
  /** The group's other environments: a key minted here reads them. */
  readonly groupProjectIds: ReadonlyArray<string>;
  readonly viewer: PressViewer | null;
  /** Null where there is no registry to write it in. */
  readonly registration: PressRegistration | null;
  readonly isCurrent: () => boolean;
  /**
   * A Mate made before the press: its key lowered from `ADMIN`, its delegations dropped and its
   * key moved off the project's variables (`hardenMate`) before the steps run.
   */
  readonly harden?: boolean;
  /** Each step's state as the press moves, for a dialog that stays on it. */
  readonly onProgress?: (progress: ReadonlyArray<EnvironmentCreationStepProgress>) => void;
  /** This browser's locks; the page's own where omitted. */
  readonly locks?: LockManagerLike | undefined;
  /** Between the harden's tries; the clock's own where omitted. */
  readonly sleep?: (ms: number) => Promise<void>;
}): Promise<EnvironmentCreationOutcome> {
  const locks = "locks" in input ? input.locks : browserLocks();
  // The whole of it holds the project's press lock: no other tab presses it meanwhile.
  return withLockIfFree(
    locks,
    matePressLockName(input.projectId),
    () => finishLocked({ ...input, locks }),
    () => {
      if (input.isCurrent()) {
        settlePress(input.projectId, {
          kind: "failed",
          step: "close-off",
          reason: PRESSED_ELSEWHERE,
          retry: async () => {
            settlePress(input.projectId, { kind: "pressing" });
            await finishMateSetup(input);
          },
        });
      }
      return {
        ok: false,
        projectId: input.projectId,
        failedStep: { kind: "close-off" },
        error: PRESSED_ELSEWHERE,
      };
    },
  );
}

/**
 * An attempt tried again while it fails, a little apart, up to the press's own tries: what a
 * pool-claimed Mate's harden and *Finish setup*'s get.
 */
export async function withPressTries(
  attempt: () => Promise<void>,
  wait: (ms: number) => Promise<void> = sleep,
): Promise<{ readonly ok: true } | { readonly ok: false; readonly error: string }> {
  for (let tried = 1; ; tried += 1) {
    try {
      await attempt();
      return { ok: true };
    } catch (cause) {
      if (tried >= PRESS_STEP_ATTEMPTS) return { ok: false, error: zeropsErrorMessage(cause) };
      await wait(PRESS_STEP_RETRY_MS);
    }
  }
}

async function finishLocked(
  input: Parameters<typeof finishMateSetup>[0],
): Promise<EnvironmentCreationOutcome> {
  if (input.harden === true) {
    const hardened = await withPressTries(
      () =>
        runZeropsCommand(
          input.inputs.data.runtime.commands.isolateProjectEnv(
            input.inputs.data.projectRef(input.inputs.organizationId, input.projectId),
          ),
        ).then(() => undefined),
      input.sleep,
    );
    if (!hardened.ok) {
      if (input.isCurrent()) {
        settlePress(input.projectId, {
          kind: "failed",
          step: "close-off",
          reason: hardened.error,
          // The harden is safe to ask again: Finish setup runs again, whole.
          retry: async () => {
            settlePress(input.projectId, { kind: "pressing" });
            await finishMateSetup(input);
          },
        });
      }
      return {
        ok: false,
        projectId: input.projectId,
        failedStep: { kind: "close-off" },
        error: hardened.error,
      };
    }
  }
  const steps: ReadonlyArray<EnvironmentCreationStep> = [
    ...(input.container === null
      ? []
      : [{ kind: "import-container", agents: input.container.agents } as const]),
    // Isolated a moment ago by the harden, which the close-off trusts where no container comes
    // after it.
    input.harden === true && input.container === null
      ? { kind: "close-off", isolated: true }
      : { kind: "close-off" },
    // After the close-off: a refused registration leaves the Mate closed off and running.
    ...(input.registration === null ? [] : [{ kind: "register" } as const]),
    { kind: "share-reach" },
    { kind: "await-ready", withAgent: true },
  ];
  return runPress({
    organizationId: input.inputs.organizationId,
    steps,
    platform: pressPlatform(input.inputs, {
      groupProjectIds: input.groupProjectIds,
      viewer: input.viewer,
      register:
        input.registration === null ? null : pressRegistration(input.inputs, input.registration),
      readObservedServices: async () => [],
    }),
    isCurrent: input.isCurrent,
    resume: { from: 0, projectId: input.projectId, projectName: input.projectName },
    ...(input.onProgress === undefined ? {} : { onProgress: input.onProgress }),
    locks: input.locks,
    heldLock: true,
    ...(input.sleep === undefined ? {} : { sleep: input.sleep }),
  });
}

// ── The press's marker on Mates made elsewhere ───────────────────────────────────────────────

interface MarkedCandidate {
  readonly service?: { readonly id: string } | undefined;
  readonly project: { readonly tagList?: ReadonlyArray<string> | undefined };
}

/**
 * The zcp services of the Mates whose press was interrupted before its close-off: the container
 * carries the press's marker (`MATE_SETUP_RUNTIMES`) while the project has no `mate:closed-off`.
 * A marker the store has not read, or could not, says nothing.
 */
export function interruptedPresses(
  candidates: ReadonlyArray<MarkedCandidate>,
  markers: ReadonlyMap<string, boolean | "unknown" | "unread">,
): ReadonlySet<string> {
  return new Set(
    candidates.flatMap((candidate) =>
      candidate.service !== undefined &&
      !isZeropsMateClosedOff(candidate.project.tagList) &&
      markers.get(candidate.service.id) === true
        ? [candidate.service.id]
        : [],
    ),
  );
}

/**
 * Which of these Mates' presses were interrupted before their close-off, as the account's store
 * states their containers' variables — the organization's own stream, no read of its own — for
 * every Mate whose project lacks the mark.
 */
export function useInterruptedPresses(
  candidates: ReadonlyArray<
    MarkedCandidate & { readonly project: { readonly id: string; readonly clientId?: string } }
  >,
  data: Pick<ZeropsDataContextValue, "runtime" | "projectRef">,
): ReadonlySet<string> {
  const selections = useMemo(
    () =>
      candidates.flatMap((candidate) =>
        candidate.service === undefined ||
        candidate.project.clientId === undefined ||
        isZeropsMateClosedOff(candidate.project.tagList)
          ? []
          : [
              [
                candidate.service.id,
                data.runtime.reads.setupMarker({
                  kind: "service",
                  project: data.projectRef(candidate.project.clientId, candidate.project.id),
                  serviceId: ZeropsServiceId.make(candidate.service.id),
                }),
              ] as const,
            ],
      ),
    [candidates, data],
  );
  const markers = useZeropsAtomSelections(selections);
  return useMemo(() => interruptedPresses(candidates, markers), [candidates, markers]);
}
