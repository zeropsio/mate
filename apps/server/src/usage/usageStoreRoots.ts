/** Where OpenCode and Antigravity keep their history on this host: the usage page and capture agree. */
import { ProviderInstanceId, type ProviderInstanceConfig } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import { expandHomePath } from "../pathExpansion.ts";
import { antigravityProfileDirectory } from "../spi/driverHomes.ts";

export interface UsageStoreRoots {
  /** OpenCode data directories, each holding `opencode*.db` and legacy `storage/message`. */
  readonly opencode: ReadonlyArray<string>;
  /** Antigravity conversation directories, canonical and distinct. */
  readonly antigravity: ReadonlyArray<string>;
}

export const resolveUsageStoreRoots = Effect.fnUntraced(function* (input: {
  readonly hostEnvironment: NodeJS.ProcessEnv;
  readonly home: string;
  readonly stateDir: string;
  readonly providerInstances: Readonly<Record<string, Pick<ProviderInstanceConfig, "driver">>>;
}) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const { hostEnvironment, home } = input;
  const envRoots = Effect.fnUntraced(function* (key: string, defaults: readonly string[]) {
    const roots = hostEnvironment[key]
      ?.split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    const canonical = new Set<string>();
    for (const root of roots?.length ? roots : defaults) {
      const resolved = path.resolve(expandHomePath(root));
      canonical.add(
        yield* fileSystem.realPath(resolved).pipe(Effect.orElseSucceed(() => resolved)),
      );
    }
    return [...canonical];
  });
  const dataHome = hostEnvironment["XDG_DATA_HOME"]?.trim();
  const opencode = yield* envRoots("OPENCODE_DATA_DIR", [
    path.join(
      dataHome && path.isAbsolute(dataHome) ? dataHome : path.join(home, ".local", "share"),
      "opencode",
    ),
  ]);
  const antigravityRoots = yield* envRoots("ANTIGRAVITY_DATA_DIR", [
    ...["antigravity", "antigravity-cli", "antigravity-ide", "antigravity-backup"].map((name) =>
      path.join(home, ".gemini", name),
    ),
    path.join(home, ".config", "antigravity"),
  ]);
  for (const [instanceId, instance] of Object.entries(input.providerInstances)) {
    if (instance.driver === "antigravity") {
      const profile = antigravityProfileDirectory(
        input.stateDir,
        ProviderInstanceId.make(instanceId),
      );
      antigravityRoots.push(path.join(profile, "antigravity-acp"));
    }
  }
  const antigravity = new Set<string>();
  for (const root of antigravityRoots) {
    const resolvedRoot = yield* fileSystem.realPath(root).pipe(Effect.orElseSucceed(() => root));
    const nested = path.join(resolvedRoot, "conversations");
    const dir = (yield* fileSystem
      .exists(nested)
      .pipe(Effect.catchCause(() => Effect.succeed(false))))
      ? nested
      : resolvedRoot;
    antigravity.add(yield* fileSystem.realPath(dir).pipe(Effect.orElseSucceed(() => dir)));
  }
  return { opencode, antigravity: [...antigravity] } satisfies UsageStoreRoots;
});
