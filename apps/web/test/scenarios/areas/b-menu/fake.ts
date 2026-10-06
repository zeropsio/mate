import { applicationDetailsGate } from "../../fakes/b-menu/hqDetails.ts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import {
  MateLinkUp,
  MateOverview,
  type OverviewMain,
  type MateThreadKind,
} from "@t3tools/shared/mateLink";
import { enrollMate } from "../../../../../hq/test/harness/runningCore.ts";
import type { MateFake } from "../../fakes/mate.ts";
import type { ScenarioExtension, ScenarioDrivers } from "../../harness/scenario.ts";
import { DEFAULT_ZEROPS_GRANT_POLICY } from "@t3tools/client-runtime/zerops/data";

// This area drives the real Mate → HQ link, never the browser's stores.
export const installMenu: ScenarioExtension = () => {};
const AT = "2026-10-06T12:00:00.000Z";
const encode = Schema.encodeEffect(MateLinkUp);
const decode = Schema.decodeUnknownEffect(MateOverview);
export const reportConversation = Effect.fn("menu.reportConversation")(function* (
  drivers: Pick<ScenarioDrivers, "mates"> & {
    links: ReadonlyMap<string, { send: (value: unknown) => Effect.Effect<void> }>;
  },
  name: string,
  patch: Partial<OverviewMain> = {},
  kind: MateThreadKind = "idle",
) {
  const mate = drivers.mates.get(name)!;
  const main = {
    ...mate.shellThread(),
    backgroundLiveness: null,
    latestUserMessageAt: AT,
    latestUserMessagePreview: { text: "Inspect the checkout" },
    latestMessagePreview: null,
    planProgress: null,
    pendingQuestion: null,
    usagePause: null,
    liveStep: null,
    updatedAt: AT,
    ...patch,
  };
  const overview = yield* decode({
    identity: {
      environmentId: mate.descriptor.environmentId,
      serverVersion: "0.14.11",
      update: null,
      runsWithoutSignIn: true,
    },
    main,
    threads: {
      list: [
        {
          id: main.id,
          title: main.title,
          kind,
          turnId: main.latestTurn?.turnId ?? null,
          turnState: main.latestTurn?.state ?? null,
          completedAt: main.latestTurn?.completedAt ?? null,
        },
      ],
      omitted: 0,
    },
    logins: {},
    crew: { status: "off" },
  });
  yield* drivers.links.get(name)!.send(yield* encode({ type: "overview", full: true, overview }));
  // Its attention says the same, straight to a page that has it open and up its link to HQ.
  const waits =
    kind === "approval" || kind === "input" || kind === "failed" || kind === "planReady";
  const attention = mate.publishAttention({
    mainThreadId: main.id,
    lastThreadId: main.id,
    working: kind === "working" || kind === "connecting" || kind === "monitoring" ? 1 : 0,
    waiting: waits ? 1 : 0,
    questions: waits ? [{ threadId: main.id, kind, turnId: main.latestTurn?.turnId ?? null }] : [],
  });
  yield* drivers.links.get(name)!.send(yield* encode({ type: "attention", attention }));
});

/** A new revision of a Mate's attention alone, its overview as it was: what a real Mate sends first. */
export const reportAttention = Effect.fn("menu.reportAttention")(function* (
  drivers: Pick<ScenarioDrivers, "mates"> & {
    links: ReadonlyMap<string, { send: (value: unknown) => Effect.Effect<void> }>;
  },
  name: string,
  says: Parameters<MateFake["publishAttention"]>[0],
) {
  const attention = drivers.mates.get(name)!.publishAttention(says);
  yield* drivers.links.get(name)!.send(yield* encode({ type: "attention", attention }));
});

/** A new revision of a Mate's attention up its link to HQ alone: no page hears it straight. */
export const relayAttention = Effect.fn("menu.relayAttention")(function* (
  drivers: Pick<ScenarioDrivers, "mates"> & {
    links: ReadonlyMap<string, { send: (value: unknown) => Effect.Effect<void> }>;
  },
  name: string,
  says: Parameters<MateFake["reviseAttention"]>[0],
) {
  const attention = drivers.mates.get(name)!.reviseAttention(says);
  yield* drivers.links.get(name)!.send(yield* encode({ type: "attention", attention }));
});

/**
 * A Mate's server restarts: its old link to HQ drops and its new run reaches HQ on a new one,
 * enrolled the way zcp does it; its attention goes on as a new incarnation.
 */
export const restartMate = Effect.fn("menu.restartMate")(function* (
  drivers: Pick<ScenarioDrivers, "mates" | "core" | "links">,
  name: string,
) {
  drivers.mates.get(name)!.restart();
  yield* drivers.links.get(name)!.close;
  const credential = yield* enrollMate(drivers.core.call, drivers.core.fake, name);
  const { ticket } = (yield* drivers.core.call("POST", "/api/mate/link-ticket", {
    headers: { authorization: `Mate ${credential}` },
  })).body as { ticket: string };
  const link = yield* drivers.core.socket(`/api/mate/link?ticket=${ticket}`);
  drivers.links.set(name, link);
  yield* link.next("state");
});

export const moveMate = Effect.fn("menu.moveMate")(function* (
  drivers: ScenarioDrivers,
  name: string,
  app: string | null,
) {
  const response = yield* drivers.core.call("PUT", `/api/projects/${name}/app`, {
    session: drivers.owner,
    body: { appId: app === null ? null : drivers.appIds.get(app), kind: "mate" },
  });
  if (response.status !== 200)
    return yield* Effect.die(new Error(`Move refused: ${response.status}`));
});

export const removeProject = (drivers: ScenarioDrivers, name: string) =>
  Effect.sync(() => drivers.zerops.remove("project", name));
export const denyProjectRead = (drivers: ScenarioDrivers, name: string) =>
  Effect.sync(() => {
    const key = `GET /project/${name}`;
    drivers.zerops.faults.set(key, {
      status: 403,
      code: "insufficientPermissions",
    });
  });
export const settleProjectRefusal = (
  advance: (ms: number) => Promise<void>,
  settle: () => Promise<void>,
) =>
  Effect.promise(async () => {
    // Cross the real denial-confirmation delay and every retry rung, draining replies and their
    // rendered effects at each boundary. A terminal refusal schedules no request to wait for.
    const policy = DEFAULT_ZEROPS_GRANT_POLICY;
    for (const delay of [policy.denialConfirmationDelayMs, ...policy.projectRetryMs]) {
      await advance(delay);
      await settle();
    }
  });
export const startStageBuild = (drivers: ScenarioDrivers, name: string) =>
  Effect.sync(() => {
    drivers.zerops.writes.autoComplete = false;
    const version = `building-${name}`;
    drivers.zerops.world.appVersions.set(version, {
      id: version,
      serviceId: `app-${name}`,
      name: "stage-next",
      status: "BUILDING",
      archive: undefined,
      zeropsYaml: undefined,
      setup: undefined,
    });
    drivers.zerops.put(
      "app-version",
      {
        id: version,
        clientId: "ORG",
        projectId: name,
        serviceStackId: `app-${name}`,
        name: "stage-next",
        status: "BUILDING",
        source: "CLI",
        created: "2026-10-05T12:00:00.000Z",
      },
      "membership-first",
    );
    drivers.zerops.writes.start(name, "stack.build", [`app-${name}`], version);
  });

export const stageService = (drivers: ScenarioDrivers, name: string) =>
  Effect.sync(() => {
    drivers.zerops.world.appVersions.set(`version-${name}`, {
      id: `version-${name}`,
      serviceId: `app-${name}`,
      name: "stage-existing",
      status: "ACTIVE",
      archive: undefined,
      zeropsYaml: undefined,
      setup: undefined,
    });
    drivers.zerops.put(
      "app-version",
      {
        id: `version-${name}`,
        clientId: "ORG",
        projectId: name,
        serviceStackId: `app-${name}`,
        name: "stage-existing",
        status: "ACTIVE",
        source: "CLI",
        created: "2026-10-05T12:00:00.000Z",
      },
      "membership-first",
    );
    drivers.zerops.put(
      "service-stack",
      {
        id: `app-${name}`,
        projectId: name,
        clientId: "ORG",
        name: "app",
        activeAppVersion: { id: `version-${name}`, name: "stage-existing" },
        userData: [
          { key: "appVersionId", content: `version-${name}` },
          { key: "appVersionName", content: "stage-existing" },
        ],
        status: "ACTIVE",
        isSystem: false,
        ports: [{ port: 3000, scheme: "http" }],
        serviceStackTypeInfo: {
          serviceStackTypeName: "nodejs",
          serviceStackTypeVersionName: "nodejs@22",
          serviceStackTypeCategory: "USER",
        },
      },
      "membership-first",
    );
  });

const gates = new WeakMap<ScenarioDrivers, Awaited<ReturnType<typeof applicationDetailsGate>>>();
export const installDelayedDetails: ScenarioExtension = async (drivers) => {
  const origin = drivers.routes["https://hqzone.prg1-zerops.zone"]!;
  const gate = await applicationDetailsGate(origin);
  gates.set(drivers, gate);
  drivers.routes["https://hqzone.prg1-zerops.zone"] = gate.origin;
  drivers.cleanup.push(gate.close);
};
export const holdDetails = (drivers: ScenarioDrivers, app: string) =>
  Effect.sync(() => {
    const gate = gates.get(drivers)!;
    gate.hold(drivers.appIds.get(app)!);
    return Effect.promise(() => gate.waitForHeld());
  });
export const releaseDetails = (drivers: ScenarioDrivers) =>
  Effect.sync(() => gates.get(drivers)!.release());
