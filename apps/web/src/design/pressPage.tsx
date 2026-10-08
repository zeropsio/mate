import { comingSentenceOf } from "~/zerops/mateNoticeVoice";
import { makeAccountStore, creationPressStoreAtom } from "@t3tools/client-runtime/data";
import { appAtomRegistry } from "~/rpc/atomRegistry";
/**
 * The page a press lands on, for the add dialogs' harnesses (`design-newproject.html`,
 * `design-newmate.html`): the Mate coming up, drawn by the real stage (`MateEmptyStateView`), the
 * real steps (`ComingBelow`, `arrivalSteps`) and the real sentence (`comingSentenceOf`) over a
 * creation as the app draws it (`newProjectBirth.ts`), whose steps a fake press moves at the pace run 6
 * measured (2026-10-03): a New project registered in 0.4 s, its Mate's project in 2.0 s, closed
 * off in 4.0 s, registered in 3.6 s; an added Mate's project in 2.0 s, its container in 0.8 s,
 * closed off in 5.2 s, registered in 2.0 s.
 *
 * Once the platform takes its project the page hands over to the Mate's own view, as the app's
 * route does (`/mate/$projectId`), its press kept as `runPress` keeps it and forgotten once closed
 * off and registered (`endPress`). `?fail=<step>` stops the press there to watch a stop said where
 * the app says it: `created` before the take (on `/mate/new`, *Try again* goes through),
 * `closed-off` after it (on the Mate's own view, with its press's *Try again*), `registered` a
 * registration refused (never a stop: the press ends with it). Fixtures only: nothing here ships,
 * and no route imports this module.
 */
import {
  birthCopyServices,
  birthRuntimesFacts,
  deriveBirthProgress,
} from "@t3tools/client-runtime/zerops/birthProgress";
import type {
  EnvironmentCreationStep,
  EnvironmentCreationStepProgress,
  ZeropsMateFace,
} from "@t3tools/client-runtime/zerops";
import { useMemo } from "react";
import { create } from "zustand";

import { ComingBelow, type ArrivalProgress } from "~/components/zerops/ZeropsMateComingPage";
import { MateEmptyStateView } from "~/components/zerops/ZeropsMateEmptyState";
import { openAccountLifetime } from "~/zerops/accountLifetime";
import { mateArrival } from "@t3tools/client-runtime/data";
import {
  beginPress,
  forgetPress,
  pressDoneAt,
  pressFailure,
  progressPress,
  recordPressOutcome,
  useMatePress,
} from "~/zerops/matePress";
import {
  comingPlanned,
  creationManaged,
  creationSubsteps,
  newProjectComing,
  newProjectProgress,
  type NewProjectBirth,
} from "~/zerops/newProjectBirth";
import { useSecondsNowMs } from "~/zerops/useNowMs";

openAccountLifetime("harness-person");
appAtomRegistry.set(creationPressStoreAtom, makeAccountStore(appAtomRegistry));

const FAIL = new URLSearchParams(location.search).get("fail");

const wait = (ms: number) =>
  new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
  });

type Kind = EnvironmentCreationStep["kind"];

const STEP: Readonly<Record<string, EnvironmentCreationStep>> = {
  "create-project": { kind: "create-project", name: "Acme Docs - Ida" } as EnvironmentCreationStep,
  "import-managed": {
    kind: "import-managed",
    yaml: "services:\n  - hostname: db\n    type: postgresql@16\n  - hostname: cache\n    type: valkey@7.2\n",
  } as EnvironmentCreationStep,
  "import-container": {
    kind: "import-container",
    agents: [],
    runtimes: {
      yaml: "",
      services: [
        { hostname: "appdev", role: "dev" },
        { hostname: "appstage", role: "stage" },
      ],
    },
  } as EnvironmentCreationStep,
  "close-off": { kind: "close-off" },
  register: { kind: "register" },
  "await-ready": { kind: "await-ready", withAgent: true },
};

/** The creations the harness pressed, as the app draws them, by their id. */
const useHarnessCreations = create<{
  readonly creations: Readonly<Record<string, NewProjectBirth>>;
}>(() => ({ creations: {} }));

const moved = (id: string, patch: Partial<NewProjectBirth>) => {
  useHarnessCreations.setState((state) => {
    const creation = state.creations[id];
    return creation === undefined
      ? state
      : { creations: { ...state.creations, [id]: { ...creation, ...patch } } };
  });
};

/** Its *Try again*, by the creation's id. */
const retries = new Map<string, () => void>();

/**
 * Moves a press through its steps at their measured pace — once the platform took its project,
 * telling its press record, as `runPress` does: over (forgotten) once closed off and registered,
 * stopped with *Try again* where a step stops after the take.
 */
function press(
  kinds: ReadonlyArray<readonly [Kind, number]>,
  failAt: Kind | null,
  /** Its project, once the platform took it. */
  taken: () => string | null,
): void {
  const states = new Map<Kind, EnvironmentCreationStepProgress["state"]>(
    kinds.map(([kind]) => [kind, "queued"]),
  );
  const tell = () => {
    const progress: Array<EnvironmentCreationStepProgress> = kinds.map(([kind]) => ({
      step: STEP[kind]!,
      state: states.get(kind)!,
      ...(states.get(kind) === "failed" ? { error: "Zerops did not answer in time." } : {}),
    }));
    const projectId = taken();
    if (projectId === null) return;
    progressPress(projectId, progress);
    if (pressDoneAt(progress)) forgetPress(projectId);
  };
  const go = async (from: number, stopAt: Kind | null): Promise<void> => {
    for (const [kind, ms] of kinds.slice(from)) {
      states.set(kind, "running");
      tell();
      await wait(ms);
      if (kind !== stopAt) {
        states.set(kind, "done");
        tell();
        continue;
      }
      states.set(kind, "failed");
      tell();
      // A refused registration leaves the Mate running: the press goes on.
      if (kind === "register") continue;
      const projectId = taken();
      if (projectId !== null) {
        const at = kinds.findIndex(([each]) => each === kind);
        recordPressOutcome(projectId, {
          kind: "failed",
          step: kind,
          reason: "Zerops did not answer in time.",
          retry: async () => {
            recordPressOutcome(projectId, { kind: "pressing" });
            await go(at, null);
          },
        });
      }
      return;
    }
  };
  void go(0, failAt);
}

const FACE: ZeropsMateFace = { tint: "rose", shape: "seal" };

/** A press of *Create* (New project) or *Add* (Add a Mate): held from now, and run. */
export function beginHarnessPress(input: {
  readonly flow: "new-project" | "add";
  readonly project: string;
  readonly botName: string;
}): string {
  const adds = input.flow === "add";
  const id = `harness-${input.flow}`;
  const failAt: Kind | null =
    FAIL === "closed-off" ? "close-off" : FAIL === "registered" ? "register" : null;
  let tries = 0;
  let taken: string | null = null;
  const projectOf = () => taken;
  const managed = adds ? ["db", "cache"] : undefined;
  const runtimes = adds
    ? ([
        { hostname: "appdev", role: "dev" },
        { hostname: "appstage", role: "stage" },
      ] as const)
    : undefined;
  useHarnessCreations.setState((state) => ({
    creations: {
      ...state.creations,
      [id]: {
        organizationId: "org-harness",
        birthId: id,
        name: input.project,
        botName: input.botName,
        face: FACE,
        locationId: null,
        agents: [],
        // As its recipe names them, at the press.
        ...(adds ? { adds: { appId: "g-harness", registers: true, managed, runtimes } } : {}),
        startedAt: Date.now(),
        hq: { projectId: "hq-harness", address: "https://hq.example" },
        appId: adds ? "g-harness" : null,
        intent: null,
        step: adds ? "create" : "registry",
        failed: null,
        projectId: null,
      },
    },
  }));
  // The platform took its project: its press is the Mate's from here, as `runPress` keeps it.
  const accepted = (projectId: string) => {
    taken = projectId;
    beginPress({
      projectId,
      organizationId: "org-harness",
      startedAt: Date.now(),
      placement: null,
      container: true,
      ...(managed === undefined ? {} : { managed }),
      ...(runtimes === undefined ? {} : { runtimes }),
    });
    moved(id, { step: "created", projectId });
    if (adds) return;
    press(
      [
        ["close-off", 4_000],
        ["register", 3_600],
        ["await-ready", 400],
      ],
      failAt,
      projectOf,
    );
  };
  const createProject = async () => {
    tries += 1;
    const refused = FAIL === "created" && tries === 1;
    if (adds)
      // The press is heard from its plan on: its project, then the rest.
      press(
        refused
          ? [["create-project", 2_000]]
          : [
              ["create-project", 2_000],
              ["import-managed", 0],
              ["import-container", 800],
              ["close-off", 5_200],
              ["register", 2_000],
              ["await-ready", 400],
            ],
        refused ? "create-project" : failAt,
        projectOf,
      );
    await wait(2_000);
    if (refused) {
      moved(id, { failed: { reason: "No room in this organization.", uncertain: false } });
      return;
    }
    accepted(`p-harness-${input.flow}`);
  };
  retries.set(id, () => {
    moved(id, { failed: null });
    void createProject();
  });
  void (async () => {
    if (!adds) {
      await wait(400);
      moved(id, { appId: "g-harness", intent: "intent-harness", step: "create" });
    }
    await createProject();
  })();
  return id;
}

/** The Mate's page, as a press lands on it, over the creation the harness holds. */
export function HarnessPressPage({ birthId }: { readonly birthId: string }) {
  const birth = useHarnessCreations((state) => state.creations[birthId]);
  const nowMs = useSecondsNowMs(birth !== undefined && birth.failed === null);
  const progress = useMemo((): ArrivalProgress | undefined => {
    if (birth === undefined) return undefined;
    const managed = birthCopyServices({
      planned: creationManaged(birth),
      services: undefined,
    });
    return {
      ...newProjectProgress(birth, null, nowMs),
      ...(birth.adds === undefined || managed === undefined ? {} : { managed }),
      press: creationSubsteps(birth, null),
    };
  }, [birth, nowMs]);
  if (birth === undefined) return null;
  // The platform took its project: the Mate's own view takes the route, as the app hands over.
  if (birth.projectId !== null) return <HarnessMatePage made={birth} projectId={birth.projectId} />;
  const mate = mateOf(birth);
  const coming = newProjectComing(birth);
  return (
    <div data-harness-page={birthId}>
      <MateEmptyStateView
        focusOnArrival
        coming={{
          kind: coming.kind,
          pressed: true,
          sentence: comingSentenceOf({ coming, progress, nowMs }),
          below: (
            <ComingBelow
              coming={coming}
              mate={mate}
              nowMs={nowMs}
              onTryAgain={() => {
                retries.get(birthId)?.();
              }}
              progress={progress}
              you={{ initials: "AR", avatarUrl: null }}
            />
          ),
        }}
        mate={mate}
        phase={null}
        signIn={null}
        signInRequired={false}
        unknown={null}
      />
    </div>
  );
}

const mateOf = (birth: NewProjectBirth) => ({
  name: birth.botName,
  tint: birth.face.tint,
  shape: birth.face.shape,
  project: birth.name,
  connected: false,
});

/**
 * The Mate's own view after the hand-over (`/mate/$projectId`), composed as `ZeropsMateComingPage`
 * composes it: its birth's line from the facts the platform gives (its project made, its container
 * once imported), what it brings named by its press and then its creation (`comingPlanned`), the
 * steps this tab runs under its first row, and a stop after the take said by its press, with *Try
 * again*.
 */
function HarnessMatePage({
  made,
  projectId,
}: {
  readonly made: NewProjectBirth;
  readonly projectId: string;
}) {
  const press = useMatePress(projectId);
  const nowMs = useSecondsNowMs(true);
  const progress = useMemo((): ArrivalProgress => {
    const planned = comingPlanned(press, made);
    const container =
      made.adds === undefined ||
      press === undefined ||
      press.progress?.some(
        (entry) => entry.step.kind === "import-container" && entry.state === "done",
      ) === true;
    const runtimes = birthRuntimesFacts({ planned: planned.runtimes, services: undefined });
    const theirs = deriveBirthProgress(
      {
        project: { status: "ACTIVE", createdAt: new Date(made.startedAt).toISOString() },
        container: container
          ? { serviceId: "zcp", status: "CREATING", hasOrigin: false }
          : undefined,
        processes: [],
        health: undefined,
        connection: "none",
        ...(runtimes === undefined ? {} : { runtimes }),
      },
      nowMs,
    );
    const managed = birthCopyServices({ planned: planned.managed, services: undefined });
    return {
      ...(made.adds === undefined ? newProjectProgress(made, theirs, nowMs) : theirs),
      ...(managed === undefined ? {} : { managed }),
      ...(press === undefined
        ? {}
        : {
            press: creationSubsteps(
              made,
              press.progress ?? null,
              FAIL === "registered"
                ? { attempt: 1, state: "unfinished", reason: "Register said no." }
                : { attempt: 1, state: "done" },
            ),
          }),
    };
  }, [made, nowMs, press]);
  const coming =
    mateArrival({
      press:
        press === undefined
          ? undefined
          : {
              startedAt: press.startedAt,
              container: press.container,
              retryable: press.state.kind === "failed" && press.state.retry !== null,
            },
      candidate: { group: "provisioning", service: { status: "CREATING" } },
      setUpFailed: pressFailure(press),
      nowMs,
      created: true,
    }).coming ?? newProjectComing(made);
  const retry = press?.state.kind === "failed" ? press.state.retry : null;
  const mate = mateOf(made);
  return (
    <div data-harness-page={projectId}>
      <MateEmptyStateView
        coming={{
          kind: coming.kind,
          pressed: true,
          sentence: comingSentenceOf({ coming, progress, nowMs }),
          below: (
            <ComingBelow
              coming={coming}
              mate={mate}
              nowMs={nowMs}
              {...(retry === null ? {} : { onTryAgain: () => void retry() })}
              progress={progress}
              you={{ initials: "AR", avatarUrl: null }}
            />
          ),
        }}
        focusOnArrival
        mate={mate}
        phase={null}
        signIn={null}
        signInRequired={false}
        unknown={null}
      />
    </div>
  );
}
