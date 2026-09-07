import { EnvironmentId } from "@t3tools/contracts";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { reactHookHarness as hooks } from "../test/reactHookHarness";

const feedState = vi.hoisted(() => ({ session: undefined as unknown }));
const catalogState = vi.hoisted(() => ({
  load: vi.fn(() => Promise.resolve()),
  byEnvironment: {} as Record<string, unknown>,
}));
const commandSpy = vi.hoisted(() => vi.fn());

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  const { reactHookHarness } = await import("../test/reactHookHarness");
  return {
    ...actual,
    useMemo: reactHookHarness.useMemo,
    // The harness has no effect queue; running the effect inline is enough to
    // observe whether this hook decided to load at all, which is what the
    // session gate is about.
    useEffect: (effect: () => void) => {
      effect();
    },
  };
});

vi.mock("./useZeropsFeeds", () => ({
  useZeropsDataConsole: () => feedState.session,
}));

vi.mock("./dataCatalog", () => ({
  useZeropsDataCatalogStore: (selector: (state: unknown) => unknown) => selector(catalogState),
}));

vi.mock("../state/use-atom-command", () => ({
  useAtomCommand: () => commandSpy,
}));

vi.mock("../state/zeropsCommands", () => ({
  zeropsCommands: { dataConsoleCall: Symbol("dataConsoleCall") },
}));

import { useZeropsDataMentions } from "./useZeropsDataMentions";

const environmentId = EnvironmentId.make("environment-1");

function call(query: string | null) {
  hooks.beginRender();
  return useZeropsDataMentions(environmentId, query);
}

describe("useZeropsDataMentions", () => {
  beforeEach(() => {
    catalogState.load.mockClear();
    catalogState.byEnvironment = {};
    commandSpy.mockReset();
    feedState.session = undefined;
  });

  it("loads on an idle session, because the console only starts on its first call", () => {
    feedState.session = { status: "idle" };

    expect(call("db")).toEqual([]);
    expect(catalogState.load).toHaveBeenCalledTimes(1);
  });

  it("loads on a ready session", () => {
    feedState.session = { status: "ready" };

    call("db");

    expect(catalogState.load).toHaveBeenCalledTimes(1);
  });

  it("offers nothing and loads nothing when Data is unsupported or unavailable", () => {
    for (const status of ["unsupported", "unavailable"]) {
      feedState.session = { status };
      expect(call("db")).toEqual([]);
    }

    expect(catalogState.load).not.toHaveBeenCalled();
  });

  it("loads nothing while no mention is being typed", () => {
    feedState.session = { status: "idle" };

    expect(call(null)).toEqual([]);
    expect(catalogState.load).not.toHaveBeenCalled();
  });

  it("matches the loaded catalog once it is ready", () => {
    feedState.session = { status: "ready" };
    catalogState.byEnvironment = {
      [environmentId]: {
        status: "ready",
        entries: [
          {
            kind: "table",
            service: "db",
            serviceType: "postgresql@16",
            segments: ["public", "orders"],
            token: "db.public.orders",
            aliases: ["db.orders"],
            label: "db · public.orders",
          },
        ],
      },
    };

    expect(call("db.orders").map((entry) => entry.token)).toEqual(["db.public.orders"]);
  });
});
