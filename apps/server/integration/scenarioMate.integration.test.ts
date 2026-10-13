// @effect-diagnostics nodeBuiltinImport:off globalFetch:off globalFetchInEffect:off -- a witness reads the Mate's temp files and asks its loopback port.
import * as NodeFSP from "node:fs/promises";
import * as NodeModule from "node:module";
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

/**
 * Every path the process touches under the developer's dotfiles or `/etc`, and the home of every
 * child it starts: patched on the builtins' own objects and synced into
 * their ESM bindings, so code loaded outside vitest's module graph is seen too.
 */
const watchHost = () => {
  const realHome = process.env.HOME ?? "";
  const touched: string[] = [];
  const children: Array<{ readonly command: string; readonly home: string | undefined }> = [];
  const host = (target: unknown): string | undefined => {
    const value = target instanceof URL ? target.pathname : target;
    if (typeof value !== "string") return undefined;
    const resolved = NodePath.resolve(value);
    // The machine's own name, which every Mate labels itself with, is the one host file it reads.
    if (resolved === "/etc/machine-info") return undefined;
    return resolved.startsWith(`${realHome}/.`) || /^(\/private)?\/etc\//.test(resolved)
      ? resolved
      : undefined;
  };
  // The builtins' own mutable objects, which every importer's bindings are synced from.
  const fs = process.getBuiltinModule("node:fs");
  const childProcess = process.getBuiltinModule("node:child_process");
  const restores: Array<() => void> = [];
  const wrap = (target: object, names: ReadonlyArray<string>, see: (args: unknown[]) => void) => {
    const record = target as Record<string, unknown>;
    for (const name of names) {
      const original = record[name];
      if (typeof original !== "function") continue;
      record[name] = function (this: unknown, ...args: unknown[]) {
        see(args);
        return original.apply(this, args);
      };
      restores.push(() => {
        record[name] = original;
      });
    }
  };
  const seePath = (args: unknown[]) => {
    const path = host(args[0]);
    if (path !== undefined) touched.push(path);
  };
  const reads = ["access", "stat", "lstat", "open", "readFile", "readdir", "realpath", "opendir"];
  wrap(
    fs,
    [
      ...reads,
      ...reads.map((name) => `${name}Sync`),
      "existsSync",
      "watch",
      "watchFile",
      "createReadStream",
    ],
    seePath,
  );
  wrap(fs.promises, [...reads, "watch"], seePath);
  wrap(childProcess, ["spawn", "spawnSync", "execFile", "execFileSync", "fork"], (args) => {
    const options = [args[1], args[2]].find(
      (arg): arg is { env?: NodeJS.ProcessEnv } =>
        typeof arg === "object" && arg !== null && !Array.isArray(arg),
    );
    children.push({ command: String(args[0]), home: (options?.env ?? process.env).HOME });
  });
  wrap(childProcess, ["exec", "execSync"], (args) =>
    children.push({ command: String(args[0]), home: process.env.HOME }),
  );
  NodeModule.syncBuiltinESMExports();
  return {
    touched,
    children,
    restore: () => {
      for (const restore of restores) restore();
      NodeModule.syncBuiltinESMExports();
    },
  };
};

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

  it.live("a scenario Mate reads nothing from the developer's home or /etc", () =>
    Effect.gen(function* () {
      const scripted = yield* makeScriptedProvider();
      const host = yield* Effect.acquireRelease(Effect.sync(watchHost), (host) =>
        Effect.sync(host.restore),
      );
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
      expect(host.touched).toEqual([]);
      expect(host.children.length).toBeGreaterThan(0);
      expect(host.children.filter((child) => child.home !== mate.homeDir)).toEqual([]);
    }),
  );
});
