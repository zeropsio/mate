// @effect-diagnostics nodeBuiltinImport:off globalFetch:off globalFetchInEffect:off -- a witness reads the Mate's temp files and asks its loopback port.
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

import * as Effect from "effect/Effect";
import { describe, expect, it } from "@effect/vitest";
import { vi } from "vite-plus/test";

import { makeScriptedProvider } from "./scriptedProviderDriver.ts";
import { startScenarioMate } from "./scenarioMate.ts";

// Whoever asks the operating system for the home directory gets an answer that betrays itself.
const { realHome, osWithWitness } = vi.hoisted(() => {
  const realHome = { asked: [] as string[], path: "/scenario-real-home" };
  const osWithWitness = async (original: () => Promise<typeof import("node:os")>) => {
    const os = await original();
    return {
      ...os,
      homedir: () => {
        realHome.asked.push(new Error().stack ?? "homedir");
        return realHome.path;
      },
      userInfo: (...args: Parameters<typeof os.userInfo>) => ({
        ...os.userInfo(...args),
        homedir: (realHome.asked.push(new Error().stack ?? "userInfo"), realHome.path),
      }),
    };
  };
  return { realHome, osWithWitness };
});
vi.mock("node:os", osWithWitness);
vi.mock("os", osWithWitness);

const filesUnder = async (dir: string): Promise<string[]> =>
  (await NodeFSP.readdir(dir, { recursive: true, withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => NodePath.join(entry.parentPath, entry.name));

describe("scenario Mate", () => {
  it.live("a scenario Mate resolves no path under the real home", () =>
    Effect.gen(function* () {
      const scripted = yield* makeScriptedProvider();
      realHome.asked.length = 0;
      const mate = yield* Effect.acquireRelease(
        Effect.promise(() =>
          startScenarioMate({
            projectId: "P",
            serviceId: "service-P",
            hostname: "zcp",
            zeropsApiBaseUrl: "http://127.0.0.1:9/api/rest/public",
            zeropsApiToken: "mate-key",
            publicOrigin: "https://zcp-p-8080.prg1.zerops.app",
            now: () => Date.UTC(2026, 9, 13, 12),
            drivers: [scripted.driver],
          }),
        ),
        (mate) => Effect.promise(() => mate.stop().then(mate.remove)),
      );
      const response = yield* Effect.promise(() =>
        fetch(`${mate.origin}/.well-known/t3/environment`),
      );

      expect(response.status).toBe(200);
      expect(realHome.asked).toEqual([]);
      const written = yield* Effect.promise(() => filesUnder(mate.root));
      expect(written.length).toBeGreaterThan(0);
      expect(written.filter((file) => file.includes(realHome.path))).toEqual([]);
    }),
  );
});
