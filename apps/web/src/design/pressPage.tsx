import { comingSentenceOf } from "~/zerops/mateNoticeVoice";
/**
 * The page a press lands on, for the add dialogs' harnesses (`design-newproject.html`,
 * `design-newmate.html`): the Mate coming up, drawn by the real stage (`MateEmptyStateView`), the
 * real steps (`ComingBelow`, `arrivalSteps`) and the real sentence (`comingSentenceOf`) over a
 * creation as the app draws it (`newProjectBirth.ts`), whose steps a fake press moves at the pace run 6
 * measured (2026-10-03): a New project registered in 0.4 s, its Mate's project in 2.0 s,
 * registered in 3.6 s, its one import in 4.0 s; an added Mate's project in 2.0 s, registered in
 * 2.0 s, its one import in 0.8 s.
 *
 * Once the platform takes its project the page hands over to the Mate's own view, as the app's
 * route does (`/mate/$projectId`). `?fail=created` refuses the first *Create* before the take, on
 * `/mate/new`, where *Try again* goes through. Fixtures only: nothing here ships, and no
 * route imports this module.
 */
import {
  birthRuntimesFacts,
  deriveBirthProgress,
} from "@t3tools/client-runtime/zerops/birthProgress";
import type { ZeropsMateFace } from "@t3tools/client-runtime/zerops";
import { useMemo } from "react";
import { create } from "zustand";

import { ComingBelow, type ArrivalProgress } from "~/components/zerops/ZeropsMateComingPage";
import { MateEmptyStateView } from "~/components/zerops/ZeropsMateEmptyState";
import { openAccountLifetime } from "~/zerops/accountLifetime";
import { mateArrival } from "@t3tools/client-runtime/data";
import {
  comingPlanned,
  creationSubsteps,
  newProjectComing,
  newProjectProgress,
  type NewProjectBirth,
} from "~/zerops/newProjectBirth";
import { useSecondsNowMs } from "~/zerops/useNowMs";

openAccountLifetime("harness-person");

const FAIL = new URLSearchParams(location.search).get("fail");

const wait = (ms: number) =>
  new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
  });

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

const FACE: ZeropsMateFace = { tint: "rose", shape: "seal" };

/** A press of *Create* (New project) or *Add* (Add a Mate): held from now, and run. */
export function beginHarnessPress(input: {
  readonly flow: "new-project" | "add";
  readonly project: string;
  readonly botName: string;
  /** The face the dialog gave the Mate, as the app's creation keeps it. */
  readonly face?: ZeropsMateFace;
}): string {
  const adds = input.flow === "add";
  const id = `harness-${input.flow}`;
  let tries = 0;
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
        creator: "cu-harness",
        birthId: id,
        name: input.project,
        botName: input.botName,
        face: input.face ?? FACE,
        locationId: null,
        agents: [],
        // As its recipe names them, at the press.
        ...(adds ? { adds: { appId: "g-harness", managed, runtimes } } : {}),
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
  // The platform took its project: the Mate's own view takes it from here.
  const accepted = (projectId: string) => {
    moved(id, { step: "created", projectId });
  };
  const createProject = async () => {
    tries += 1;
    const refused = FAIL === "created" && tries === 1;
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
    return {
      ...newProjectProgress(birth, null, nowMs),
      press: creationSubsteps(birth),
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
          sentence: comingSentenceOf({ coming, progress }),
          below: (
            <ComingBelow
              coming={coming}
              mate={mate}
              nowMs={nowMs}
              onTryAgain={() => {
                retries.get(birthId)?.();
              }}
              progress={progress}
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
 * once imported), what it brings named by its creation (`comingPlanned`), the steps this tab runs
 * under its first row.
 */
function HarnessMatePage({
  made,
  projectId,
}: {
  readonly made: NewProjectBirth;
  readonly projectId: string;
}) {
  const nowMs = useSecondsNowMs(true);
  const progress = useMemo((): ArrivalProgress => {
    const planned = comingPlanned(made);
    const runtimes = birthRuntimesFacts({ planned: planned.runtimes, services: undefined });
    const theirs = deriveBirthProgress(
      {
        project: { status: "ACTIVE", createdAt: new Date(made.startedAt).toISOString() },
        container: { serviceId: "zcp", status: "CREATING", hasOrigin: false },
        processes: [],
        health: undefined,
        connection: "none",
        ...(runtimes === undefined ? {} : { runtimes }),
      },
      nowMs,
    );
    return made.adds === undefined ? newProjectProgress(made, theirs, nowMs) : theirs;
  }, [made, nowMs]);
  const coming =
    mateArrival({
      candidate: { group: "provisioning", service: { status: "CREATING" } },
      nowMs,
      created: true,
    }).coming ?? newProjectComing(made);
  const mate = mateOf(made);
  return (
    <div data-harness-page={projectId}>
      <MateEmptyStateView
        coming={{
          kind: coming.kind,
          pressed: true,
          sentence: comingSentenceOf({ coming, progress }),
          below: <ComingBelow coming={coming} mate={mate} nowMs={nowMs} progress={progress} />,
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
