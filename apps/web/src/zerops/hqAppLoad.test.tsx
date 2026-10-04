import { RegistryContext } from "@effect/atom-react";
import { Atom, AtomRegistry } from "effect/unstable/reactivity";
import {
  makeHqApi,
  applyAppReadsEvent,
  type HqApi,
  type OpenHqSocket,
} from "@t3tools/client-runtime/zerops/hq";
import { createElement } from "react";
import { act, create } from "react-test-renderer";
import { describe, expect, it, vi } from "vite-plus/test";

import { hqStructureAtom } from "../state/zerops";
import { useZeropsGroupRecipe } from "./useZeropsGroupRecipe";
import { useZeropsAppRecipes } from "./useZeropsAppRecipes";
import { useZeropsAppReleases } from "./useZeropsAppReleases";

vi.mock("../state/zerops", () => ({ hqStructureAtom: Atom.make(null) }));
vi.mock("./hqStructure", () => ({ requestHqSnapshot: () => {} }));
vi.mock("./ZeropsSessionProvider", () => ({ useZeropsSession: () => ({}) }));
const official = vi.hoisted(() => ({ address: "https://hq.example", api: null as HqApi | null }));
vi.mock("./accountHq", () => ({
  useOfficialHq: () => official,
}));
const stage = {
  state: "present",
  mainHead: "a".repeat(40),
  importYaml: "services:\n  - hostname: app\n    type: nodejs@22\n",
};
const mate = {
  state: "present",
  mainHead: "a".repeat(40),
  importYaml: "services:\n  - hostname: appdev\n    type: nodejs@22\n",
};
const value = {
  releases: [],
  repos: [],
  recipes: { mate, stage, production: { state: "absent" } },
};
const json = (body: unknown) =>
  new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });

// The real HTTP adapter and stream driver, with requests counted at the transport boundary.
async function load(count: number, details = false) {
  const requests: string[] = [];
  let message: ((data: string) => void) | undefined;
  let opened!: () => void;
  const socketReady = new Promise<void>((resolve) => {
    opened = resolve;
  });
  const openSocket: OpenHqSocket = (_url, on) => {
    message = on.message;
    opened();
    return { send: () => {}, close: () => on.close(1001) };
  };
  const api = makeHqApi({
    address: "https://hq.example",
    fetch: async (input, init) => {
      const path = new URL(input).pathname;
      requests.push(`${init?.method ?? "GET"} ${path}`);
      if (path === "/api/stream-ticket") return json({ ticket: "test-ticket", expiresIn: 60 });
      if (path.endsWith("/releases")) return json({ releases: [] });
      if (path.endsWith("/repos")) return json({ repos: [] });
      if (path.includes("/recipe/"))
        return json(path.endsWith("stage") ? stage : { state: "absent" });
      throw new Error(`Unexpected request: ${path}`);
    },
    kept: { read: () => "test-session", keep: () => {}, forget: () => {} },
    throughDoor: async () => {
      throw new Error("The session is already open.");
    },
    openSocket,
  });
  official.api = api;
  const registry = AtomRegistry.make();
  const stop = new AbortController();
  let appReads: ReturnType<typeof applyAppReadsEvent> = null;
  const driving = api.streamStructure(
    {
      onAlive: () => {},
      onEvent: (event) => {
        appReads = applyAppReadsEvent(appReads, event);
        registry.set(hqStructureAtom, {
          organizationId: "org",
          structure: null,
          changes: null,
          appReads,
          readAt: 1000,
          current: true,
          unavailableSince: null,
        });
      },
    },
    stop.signal,
  );
  await socketReady;
  const apps = Array.from({ length: count }, (_, index) => ({
    id: `app-${index}`,
    name: `App ${index}`,
    projects: [],
  }));
  message!(
    JSON.stringify({
      type: "snapshot",
      ungrouped: [],
      apps,
      changes: {},
      mates: {},
      people: {},
      appReads: Object.fromEntries(
        apps.map(({ id }) => [id, { revision: "1", value, failure: null }]),
      ),
    }),
  );
  const renders: Array<{
    releases: ReturnType<typeof useZeropsAppReleases>;
    recipes: ReturnType<typeof useZeropsAppRecipes>;
    mate: ReturnType<typeof useZeropsGroupRecipe>;
    stage: ReturnType<typeof useZeropsGroupRecipe>;
    production: ReturnType<typeof useZeropsGroupRecipe>;
  }> = [];
  function Probe() {
    renders.push({
      releases: useZeropsAppReleases(),
      recipes: useZeropsAppRecipes(),
      mate: useZeropsGroupRecipe({ appId: "app-0", tier: "mate", enabled: details }),
      stage: useZeropsGroupRecipe({ appId: "app-0", tier: "stage", enabled: details }),
      production: useZeropsGroupRecipe({ appId: "app-0", tier: "production", enabled: details }),
    });
    return null;
  }
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  let tree!: ReturnType<typeof create>;
  await act(async () => {
    tree = create(
      createElement(RegistryContext.Provider, { value: registry }, createElement(Probe)),
    );
  });
  return {
    requests,
    seen: () => renders.at(-1)!,
    send: (event: unknown) =>
      act(async () => {
        message!(JSON.stringify(event));
      }),
    close: async () => {
      await act(async () => {
        tree.unmount();
      });
      stop.abort();
      // An aborted stream ends with the abort's reason, as a fetch does.
      await expect(driving).rejects.toMatchObject({ name: "AbortError" });
      registry.dispose();
    },
  };
}

describe("HQ application load", () => {
  it.each([1, 10])("loads %i apps with one ticket read and no per-app reads", async (count) => {
    const h = await load(count);
    try {
      expect(h.requests).toEqual(["POST /api/stream-ticket"]);
      expect(h.seen().releases.releases.size).toBe(count);
      expect(h.seen().recipes.get("app-0")?.tiers).toEqual(["stage"]);
    } finally {
      await h.close();
    }
  });

  it("opens stage and production details from the recipes already in the snapshot", async () => {
    const h = await load(1, true);
    try {
      expect(h.requests).toEqual(["POST /api/stream-ticket"]);
      expect(h.seen().stage.state).toBe("present");
      expect(h.seen().stage.tier?.yaml).toBe(stage.importYaml);
      expect(h.seen().production.state).toBe("absent");
    } finally {
      await h.close();
    }
  });

  it("opens a new Mate from the Mate tier already in the snapshot, with no read of its own", async () => {
    const h = await load(1, true);
    try {
      expect(h.seen().mate).toMatchObject({
        state: "present",
        loading: false,
        services: ["appdev"],
      });
      expect(h.seen().mate.tier).toEqual({ kind: "tier", tier: "mate", yaml: mate.importYaml });
      expect(h.requests).toEqual(["POST /api/stream-ticket"]);
    } finally {
      await h.close();
    }
  });

  it("a recipe landing moves the Mate tier with no read of its own", async () => {
    const h = await load(1, true);
    try {
      await h.send({
        type: "release-revision",
        appId: "app-0",
        read: {
          revision: "2",
          value: { ...value, recipes: { ...value.recipes, mate: { state: "absent" } } },
          failure: null,
        },
      });
      expect(h.seen().mate).toMatchObject({ state: "absent", loading: false });
      expect(h.requests).toEqual(["POST /api/stream-ticket"]);
    } finally {
      await h.close();
    }
  });

  it("a failed app read keeps its value and explains the failure without changing its neighbour", async () => {
    const h = await load(2);
    try {
      const other = h.seen().recipes.get("app-1");
      const before = h.seen().recipes.get("app-0");
      await h.send({
        type: "release-revision",
        appId: "app-0",
        read: {
          revision: "2",
          value: null,
          failure: { code: "too_large", reason: "recipe_too_large" },
        },
      });
      expect(h.seen().releases.failures.get("app-0")).toBe(
        "This project's recipe is too large to read here.",
      );
      expect(h.seen().recipes.get("app-0")).toBe(before);
      expect(h.seen().recipes.get("app-1")).toBe(other);
      expect(h.requests).toEqual(["POST /api/stream-ticket"]);
    } finally {
      await h.close();
    }
  });

  it("a moved revision updates that app only without any HTTP reads", async () => {
    const h = await load(2);
    try {
      const other = h.seen().recipes.get("app-1");
      await h.send({
        type: "release-revision",
        appId: "app-0",
        read: {
          revision: "2",
          value: { ...value, recipes: { stage, production: stage } },
          failure: null,
        },
      });
      expect(h.seen().recipes.get("app-0")?.tiers).toEqual(["stage", "production"]);
      expect(h.seen().recipes.get("app-1")).toBe(other);
      expect(h.requests).toEqual(["POST /api/stream-ticket"]);
    } finally {
      await h.close();
    }
  });
});
