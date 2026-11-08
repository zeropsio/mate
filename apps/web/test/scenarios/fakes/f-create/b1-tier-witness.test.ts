import { AtomRegistry } from "effect/reactivity";
import { expect, it } from "vite-plus/test";
import {
  makeAccountStore,
  makeOperations,
  makeZeropsExecutor,
  projectVariablesScope,
  runToEnd,
} from "@t3tools/client-runtime/data";
import { liveProjects } from "@t3tools/client-runtime/data/fixtures";
import {
  ZeropsApiClient,
  planEnvironmentCreation,
  runEnvironmentCreation,
} from "@t3tools/client-runtime/zerops";
import { seedCoreWorld } from "../../harness/coreSeed.ts";
import { serve } from "../../harness/http.ts";
import { ZeropsFake } from "../zerops.ts";
import { definePerson } from "../zeropsWorld.ts";
import { CreationFake } from "./creation.ts";

const recipe = (shape: "envVariables" | "vault") => `#zeropsPreprocessor=on
project:
  name: published-name
  corePackage: LIGHT
  ${shape}:
    APP_KEY: ${shape === "vault" ? "{value: <@generateRandomString(<32>)>, sensitive: true}" : "<@generateRandomString(<32>)>"}
    APP_NAME: My application
services:
  - hostname: api
    type: nodejs@22
`;

/** A fixed instant: the witness asserts write order, never elapsed time. */
const WORLD_START = Date.parse("2026-11-05T12:00:00Z");

async function world(shape: "envVariables" | "vault", role: "dev" | "stage" = "dev") {
  const fake = new ZeropsFake(seedCoreWorld(WORLD_START, true, "ORG"));
  definePerson(fake.world, "owner", { role: "OWNER" });
  const events: string[] = [];
  let failKey: string | undefined;
  let holdReceipt: (() => Promise<void>) | undefined;
  let rowsComplete = true;
  fake.handlers.push((request) => {
    const path = request.url.pathname.replace(/^\/api\/rest\/public/u, "");
    if (request.method === "POST" && path === "/project/created-1/env") {
      const { key, content, sensitive } = request.body;
      const existing = fake.world.env.get("created-1") ?? [];
      if (existing.some((row) => row.key.toLowerCase() === String(key).toLowerCase()))
        return fake.error(400, "projectEnvDuplicateKey", "Duplicate key.");
      fake.world.env.set("created-1", [
        ...existing,
        { key: String(key), value: String(content), sensitive: sensitive === true },
      ]);
      events.push(`env:${String(key)}`);
      return { body: { id: `process-${String(key)}` } };
    }
    if (request.method === "POST" && path === "/project/created-1/service-stack/import")
      events.push("import");
    return undefined;
  });
  fake.handlers.push(new CreationFake(fake).handle);
  const server = await serve(fake.handle, fake.socket);
  fake.origin = server.origin;
  const client = new ZeropsApiClient({ baseUrl: server.origin });
  client.restoreSession({ accessToken: "personal" });
  await client.createProject({ clientId: "ORG", name: "Nova", tagList: ["mate"] });
  fake.world.env.set("created-1", [{ key: "KEEP_ME", value: "existing", sensitive: false }]);
  let registry: AtomRegistry.AtomRegistry;
  let store: ReturnType<typeof makeAccountStore>;
  const scope = projectVariablesScope("ORG", "created-1");
  const readBack = () => {
    const rows = (fake.world.env.get("created-1") ?? []).map((entry, index) => ({
      id: `env-${index}`,
      key: entry.key,
      type: "USER",
      editable: true,
      sensitive: entry.sensitive,
      value: entry.sensitive ? null : entry.value,
      created: null,
      lastUpdate: null,
    }));
    store.dispatch({ kind: "baseline-begin", scope, generation: 1 });
    store.dispatch({
      kind: "baseline-commit",
      scope,
      generation: 1,
      via: "zerops-realtime",
      members: ["created-1"],
      rows: [
        {
          family: "projectVariables",
          id: "created-1",
          value: { rows, complete: rowsComplete },
          revision: { kind: "zerops", version: null },
        },
      ],
    });
  };
  const startDevice = () => {
    registry = AtomRegistry.make();
    store = makeAccountStore(registry);
    liveProjects("ORG", [{ id: "created-1", name: "Nova" }]).forEach(store.dispatch);
    for (const event of [
      { kind: "demand", demanded: true },
      { kind: "attempt" },
      { kind: "handshake" },
    ] as const)
      store.dispatch({ kind: "stream", key: scope, now: 0, event });
    readBack();
    store.dispatch({ kind: "stream", key: scope, now: 0, event: { kind: "baseline-committed" } });
    const executor = makeZeropsExecutor({
      client,
      store,
      registry,
      active: () => true,
      viewerOf: () => ({ id: "ORG", name: "Org", membershipId: "member", roleCode: "ADMIN" }),
      hqApiOf: () => ({
        establishZcpAuthorization: async () => ({
          authorized: false,
          userId: null,
          expiresAt: null,
        }),
      }),
      readDetail: async () => true,
      demandDetail: () => () => undefined,
      revalidate: () => undefined,
      nowMs: () => 0,
      makeId: () => "nested",
      run: async (intent) => {
        if (intent.kind !== "vault-write" || intent.write.kind !== "add")
          throw new Error("Unexpected operation.");
        if (intent.write.key === failKey) throw new Error("A write was refused.");
        await client.addProjectVariable(intent.projectId, {
          key: intent.write.key,
          content: intent.write.value,
          sensitive: intent.write.sensitive,
        });
        await holdReceipt?.();
        readBack();
        return undefined as never;
      },
    });
    let operationId = 0;
    const operations = makeOperations({
      store,
      executors: { zerops: executor },
      makeId: () => `operation-${++operationId}`,
    });
    return runToEnd({ operations, store, registry });
  };
  const plan = planEnvironmentCreation({
    clientId: "ORG",
    role,
    name: "Nova",
    withAgent: true,
    recipe: {
      kind: "tier",
      tier: role === "dev" ? "mate" : "stage",
      revision: "r1",
      yaml: recipe(shape),
    },
  });
  if (!plan.ok) throw new Error(plan.reason);
  const step = plan.steps.find((item) => item.kind === "import-container");
  if (step?.kind !== "import-container" || step.tier === undefined)
    throw new Error("Missing tier.");
  let run = startDevice();
  return {
    fake,
    events,
    failAt: (key?: string) => {
      failKey = key;
    },
    hold: (wait?: () => Promise<void>) => {
      holdReceipt = wait;
    },
    incomplete: () => {
      rowsComplete = false;
      readBack();
    },
    newDevice: () => {
      registry.dispose();
      run = startDevice();
    },
    run: () =>
      runEnvironmentCreation({
        clientId: "ORG",
        steps: [step],
        platform: { run, register: async () => undefined, untilServicesSettled: async () => [] },
        resume: { from: 0, projectId: "created-1", projectName: "Nova" },
        birth: {
          id: "birth-1",
          attempt: async (_kind, send) => {
            events.push("claim");
            return send();
          },
        },
      }),
    close: async () => {
      registry.dispose();
      await server.close();
    },
  };
}

it.each([
  { role: "dev", shape: "envVariables" },
  { role: "stage", shape: "envVariables" },
  { role: "dev", shape: "vault" },
  { role: "stage", shape: "vault" },
] as const)(
  "the tier's project variables exist on the project before its one import ($role, $shape)",
  async ({ role, shape }) => {
    const w = await world(shape, role);
    try {
      let release = () => {};
      let written = () => {};
      const atWrite = new Promise<void>((resolve) => {
        written = resolve;
      });
      const wait = new Promise<void>((resolve) => {
        release = resolve;
      });
      w.hold(async () => {
        written();
        await wait;
        w.hold();
      });
      const importing = w.run();
      expect(
        await Promise.race([atWrite.then(() => "written"), importing.then(() => "ended")]),
      ).toBe("written");
      expect(w.events).toEqual(["env:APP_KEY"]);
      release();
      expect((await importing).ok).toBe(true);
      expect(w.events).toEqual(["env:APP_KEY", "env:APP_NAME", "claim", "import"]);
      expect(w.fake.world.imports).toHaveLength(1);
      expect(w.fake.world.imports[0]?.yaml).not.toMatch(/^project:/mu);
      expect(w.fake.world.env.get("created-1")).toEqual([
        { key: "KEEP_ME", value: "existing", sensitive: false },
        {
          key: "APP_KEY",
          value: expect.stringMatching(/^[A-Za-z0-9_.-]{32}$/u),
          sensitive: shape === "vault",
        },
        { key: "APP_NAME", value: "My application", sensitive: false },
      ]);
    } finally {
      await w.close();
    }
  },
);

it("a continued birth reuses the project variables its first attempt wrote", async () => {
  const w = await world("vault");
  try {
    w.failAt("APP_NAME");
    expect((await w.run()).ok).toBe(false);
    const first = w.fake.world.env.get("created-1")?.find((row) => row.key === "APP_KEY");
    expect(first?.value).toMatch(/^[A-Za-z0-9_.-]{32}$/u);
    expect(first?.sensitive).toBe(true);
    expect(w.events).toEqual(["env:APP_KEY"]);
    w.failAt();
    w.newDevice();
    expect((await w.run()).ok).toBe(true);
    expect(w.events).toEqual(["env:APP_KEY", "env:APP_NAME", "claim", "import"]);
    expect(w.fake.world.env.get("created-1")?.find((row) => row.key === "APP_KEY")).toEqual(first);
    expect(w.fake.world.imports).toHaveLength(1);
  } finally {
    await w.close();
  }
});

it("an incomplete project-variable read never starts the import", async () => {
  const w = await world("vault");
  try {
    w.incomplete();
    expect((await w.run()).ok).toBe(false);
    expect(w.events).toEqual([]);
    expect(w.fake.world.imports).toHaveLength(0);
  } finally {
    await w.close();
  }
});
