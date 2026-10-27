// @effect-diagnostics nodeBuiltinImport:off -- a test's directory is the host's own temp directory.
/**
 * A fresh directory under the host's temp directory, named from `prefix`, removed with the test's
 * scope.
 *
 * @module test/harness/tempDir
 */
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as Effect from "effect/Effect";

export const tempDir = (prefix: string) =>
  Effect.acquireRelease(
    Effect.sync(() => NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), prefix))),
    (dir) => Effect.sync(() => NodeFS.rmSync(dir, { recursive: true, force: true })),
  );
