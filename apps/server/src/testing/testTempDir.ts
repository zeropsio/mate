// @effect-diagnostics nodeBuiltinImport:off - a test's scratch directory is a Node filesystem boundary.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { afterAll, onTestFinished, TestRunner } from "vite-plus/test";

/**
 * A fresh directory `<parent>/<prefix>XXXXXX`, removed when the test that made it ends, passed or
 * failed; one made while the file loads is removed when the file's tests end.
 */
export const testTempDir = (prefix: string, parent: string = NodeOS.tmpdir()): string => {
  const dir = NodeFS.mkdtempSync(NodePath.join(parent, prefix));
  const remove = () => NodeFS.rmSync(dir, { recursive: true, force: true });
  if (TestRunner.getCurrentTest() === undefined) afterAll(remove);
  else onTestFinished(remove);
  return dir;
};
