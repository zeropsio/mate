import { expect, it } from "vite-plus/test";

import {
  planEnvironmentCreation,
  type EnvironmentCreationStep,
} from "../../zerops/createEnvironment.ts";
import type { RunToEnd } from "./runToEnd.ts";
import {
  runEnvironmentCreation,
  type EnvironmentCreationPlatform,
} from "./runEnvironmentCreation.ts";

/** A Mate's environment as the planner orders it. */
const mateSteps = () => {
  const plan = planEnvironmentCreation({ clientId: "v1", role: "dev", name: "v2" });
  if (!plan.ok) throw new Error(plan.reason);
  return plan.steps;
};

/** A stage's press as the planner orders it, without an agent: its services waited for last. */
const stageSteps: ReadonlyArray<EnvironmentCreationStep> = [
  { kind: "create-project", name: "v2", tagList: [], location: undefined },
  { kind: "register" },
  { kind: "await-ready", withAgent: false },
];

/**
 * The platform as a creation meets it: each write it took, in order, the project made as `v3`,
 * and each registration's project and name. `during` runs as the write of that kind is taken.
 */
function platform(
  options: {
    readonly during?: Partial<Record<string, () => void>>;
    readonly register?: () => Promise<void>;
  } = {},
) {
  const writes: Array<string> = [];
  const registered: Array<readonly [string, string]> = [];
  const run = (async (intent, step) => {
    writes.push(intent.kind);
    options.during?.[intent.kind]?.();
    switch (intent.kind) {
      case "create-project":
        (step.accepted as ((made: { readonly projectId: string }) => void) | undefined)?.({
          projectId: "v3",
        });
        return { projectId: "v3" };
      case "import-container":
        return { serviceName: "v4", imported: true };
      default:
        return undefined;
    }
  }) as RunToEnd;
  const taken: EnvironmentCreationPlatform = {
    run,
    register: async (projectId, projectName) => {
      writes.push(`register ${projectId}`);
      registered.push([projectId, projectName]);
      await options.register?.();
    },
    untilServicesSettled: async (projectId) => {
      writes.push(`settled ${projectId}`);
      return [];
    },
  };
  return { writes, registered, platform: taken };
}

// witness: packages/client-runtime/src/data/operations/runEnvironmentCreation.ts | projectId = id; → projectId = undefined;
it("OP55: An environment creation makes no further platform write once its account's lifetime ended, keeping the project it made", async () => {
  let current = true;
  const { writes, platform: taken } = platform({
    during: { "create-project": () => void (current = false) },
  });
  const outcome = await runEnvironmentCreation({
    clientId: "v1",
    steps: mateSteps(),
    platform: taken,
    isCurrent: () => current,
  });
  expect(outcome).toMatchObject({ ok: false, projectId: "v3" });
  expect(writes).toEqual(["create-project"]);
});

// witness: packages/client-runtime/src/data/operations/runEnvironmentCreation.ts | await input.platform.register(target, name); → await input.platform.register(target, name).catch(() => undefined);
it("OP56: A stage's or a production's refused registration stops its press at the registration: it waits for no service, and nothing runs after it", async () => {
  const pressed = platform();
  expect(
    await runEnvironmentCreation({
      clientId: "v1",
      steps: stageSteps,
      platform: pressed.platform,
    }),
  ).toMatchObject({ ok: true, projectId: "v3" });
  expect(pressed.writes).toEqual(["create-project", "register v3", "settled v3"]);

  const refused = platform({ register: () => Promise.reject(new Error("v5")) });
  expect(
    await runEnvironmentCreation({
      clientId: "v1",
      steps: stageSteps,
      platform: refused.platform,
    }),
  ).toMatchObject({ ok: false, projectId: "v3", failedStep: { kind: "register" }, error: "v5" });
  expect(refused.writes).toEqual(["create-project", "register v3"]);
});

// witness: packages/client-runtime/src/data/operations/runEnvironmentCreation.ts | const name = requireProjectName(projectName); → const name = requireProjectName(input.resume?.projectName);
it("OP57: An environment creation registers its project under the name it created or resumed it with, and registers none without a name", async () => {
  const created = platform();
  await runEnvironmentCreation({ clientId: "v1", steps: mateSteps(), platform: created.platform });
  expect(created.registered).toEqual([["v3", "v2"]]);

  const resumed = platform();
  await runEnvironmentCreation({
    clientId: "v1",
    steps: mateSteps(),
    platform: resumed.platform,
    resume: { from: 1, projectId: "v6", projectName: "v7" },
  });
  expect(resumed.registered).toEqual([["v6", "v7"]]);

  const unnamed = platform();
  expect(
    await runEnvironmentCreation({
      clientId: "v1",
      steps: mateSteps(),
      platform: unnamed.platform,
      resume: { from: 1, projectId: "v6", projectName: " " },
    }),
  ).toMatchObject({ ok: false, projectId: "v6", failedStep: { kind: "register" } });
  expect(unnamed.writes).toEqual([]);
});
