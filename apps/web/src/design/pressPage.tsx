/**
 * The page a press lands on, for the add dialogs' harnesses (`design-newproject.html`,
 * `design-newmate.html`): the Mate coming up, drawn by the real stage (`MateEmptyStateView`), the
 * real steps (`ComingBelow`, `arrivalSteps`) and the real sentence (`comingSentenceOf`) over the
 * real creations store (`newProjectBirth.ts`), whose steps a fake press moves at the pace run 6
 * measured (2026-10-03): a New project registered in 0.4 s, its Mate's project in 2.0 s, closed
 * off in 4.0 s, registered in 3.6 s; an added Mate's project in 2.0 s, its container in 0.8 s,
 * closed off in 5.2 s, registered in 2.0 s.
 *
 * `?fail=<step>` stops the press there (`created`, `closed-off`, `registered`) to watch a stop said
 * in its place. Fixtures only: nothing here ships, and no route imports this module.
 */
import { birthCopyServices } from "@t3tools/client-runtime/zerops/birthProgress";
import type {
  EnvironmentCreationStep,
  EnvironmentCreationStepProgress,
  ZeropsMateFace,
} from "@t3tools/client-runtime/zerops";
import { useMemo } from "react";

import {
  ComingBelow,
  comingSentenceOf,
  type ArrivalProgress,
} from "~/components/zerops/ZeropsMateComingPage";
import { MateEmptyStateView } from "~/components/zerops/ZeropsMateEmptyState";
import { openAccountLifetime } from "~/zerops/accountLifetime";
import {
  beginNewProjectBirth,
  creationManaged,
  creationSubsteps,
  newProjectComing,
  newProjectProgress,
  progressNewProjectBirth,
  retryNewProjectBirth,
  useNewProjectBirths,
} from "~/zerops/newProjectBirth";
import { useSecondsNowMs } from "~/zerops/useNowMs";

openAccountLifetime("harness-person");

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
  "import-container": { kind: "import-container", agents: [] } as EnvironmentCreationStep,
  "close-off": { kind: "close-off" },
  register: { kind: "register" },
  "share-reach": { kind: "share-reach" },
};

/** Moves a press through its steps at their measured pace, telling the creation of each. */
async function press(
  id: string,
  kinds: ReadonlyArray<readonly [Kind, number]>,
  failAt: Kind | null,
): Promise<void> {
  const states = new Map<Kind, EnvironmentCreationStepProgress["state"]>(
    kinds.map(([kind]) => [kind, "queued"]),
  );
  const tell = () => {
    const progress: Array<EnvironmentCreationStepProgress> = kinds.map(([kind]) => ({
      step: STEP[kind]!,
      state: states.get(kind)!,
      ...(states.get(kind) === "failed" ? { error: "Zerops did not answer in time." } : {}),
    }));
    progressNewProjectBirth(id, progress);
  };
  for (const [kind, ms] of kinds) {
    states.set(kind, "running");
    tell();
    await wait(ms);
    if (kind === failAt) {
      states.set(kind, "failed");
      tell();
      if (kind !== "register") return;
      continue;
    }
    states.set(kind, "done");
    tell();
  }
}

const FACE: ZeropsMateFace = { tint: "rose", shape: "seal" };

/** A press of *Create* (New project) or *Add* (Add a Mate): held from now, and run. */
export function beginHarnessPress(input: {
  readonly flow: "new-project" | "add";
  readonly project: string;
  readonly botName: string;
}): string {
  const adds = input.flow === "add";
  const failAt: Kind | null =
    FAIL === "closed-off" ? "close-off" : FAIL === "registered" ? "register" : null;
  // Try again after a stop goes through.
  const once = (kind: Kind | null) => (tries > 1 ? null : kind);
  let tries = 0;
  return beginNewProjectBirth({
    id: `harness-${input.flow}`,
    ask: {
      organizationId: "org-harness",
      groupId: "g-harness",
      name: input.project,
      botName: input.botName,
      face: FACE,
      locationId: null,
      agents: [],
      ...(adds
        ? {
            adds: {
              displayName: `${input.project} - ${input.botName}`,
              registers: true,
              // As its recipe names them, at the press.
              managed: ["db", "cache"],
            },
          }
        : {}),
    },
    gitea: { projectId: "gitea-harness" },
    now: Date.now(),
    ports: {
      ensureGitea: async () => ({ projectId: "gitea-harness" }),
      registerGroup: async () => {
        await wait(400);
        return { kind: "written" } as never;
      },
      createProject: async () => {
        tries += 1;
        if (adds && FAIL === "created" && tries === 1) {
          void press(`harness-${input.flow}`, [["create-project", 2_000]], "create-project");
          await wait(2_000);
          throw new Error("No room in this organization.");
        }
        if (adds) {
          // The press is heard from its plan on: its project, then the rest.
          void press(
            `harness-${input.flow}`,
            [
              ["create-project", 2_000],
              ["import-managed", 0],
              ["import-container", 800],
              ["close-off", 5_200],
              ["register", 2_000],
              ["share-reach", 400],
            ],
            once(failAt),
          );
        }
        await wait(2_000);
        if (FAIL === "created" && tries === 1) throw new Error("No room in this organization.");
        return { project: { id: `p-harness-${input.flow}` } };
      },
      accepted: () => {
        if (adds) return;
        void press(
          `harness-${input.flow}`,
          [
            ["close-off", 4_000],
            ["register", 3_600],
            ["share-reach", 400],
          ],
          once(failAt),
        );
      },
    },
  });
}

/** The Mate's page, as a press lands on it, over the creation the harness holds. */
export function HarnessPressPage({ birthId }: { readonly birthId: string }) {
  const birth = useNewProjectBirths((state) => state.births[birthId]);
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
      press: creationSubsteps(birth),
    };
  }, [birth, nowMs]);
  if (birth === undefined) return null;
  const mate = {
    name: birth.botName,
    tint: birth.face.tint,
    shape: birth.face.shape,
    project: birth.name,
    connected: false,
  };
  const coming = newProjectComing(birth);
  return (
    <div data-harness-page={birthId}>
      <MateEmptyStateView
        coming={{
          kind: coming.kind,
          sentence: comingSentenceOf({ coming, progress, nowMs }),
          below: (
            <ComingBelow
              coming={coming}
              mate={mate}
              nowMs={nowMs}
              onTryAgain={() => {
                retryNewProjectBirth(birthId);
              }}
              progress={progress}
              you={{ initials: "AR", avatarUrl: null }}
            />
          ),
        }}
        mate={mate}
        onRetry={() => undefined}
        phase={null}
        signIn={null}
        signInRequired={false}
        unknown={null}
      />
    </div>
  );
}
