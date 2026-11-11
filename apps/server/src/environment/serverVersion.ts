import { HostProcessEnvironment } from "@t3tools/shared/hostProcess";
import * as Effect from "effect/Effect";

import packageJson from "../../package.json" with { type: "json" };

/**
 * The version this process runs, as zcp names its releases: its readiness proof compares it with
 * the version it started, and its update record names the version it settled on.
 */
export const readServerVersion = Effect.gen(function* () {
  return (yield* HostProcessEnvironment).T3CODE_SERVER_VERSION?.trim() || packageJson.version;
});
