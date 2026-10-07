// @effect-diagnostics nodeBuiltinImport:off -- Browser provisioning uses disposable host directories.
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { afterEach, expect, it } from "vite-plus/test";
import { resolveTestBrowser, testBrowserOptions } from "../../testBrowser.ts";
import { computeExecutablePath } from "@puppeteer/browsers";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => NodeFSP.rm(root, { recursive: true, force: true })),
  );
});
async function cache() {
  const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "mate-test-browser-"));
  roots.push(root);
  return root;
}
it("requires explicit browser provisioning instead of using an installed personal browser", async () => {
  await expect(resolveTestBrowser(undefined, await cache())).rejects.toThrow("vp run test:browser");
});
it("uses the provisioned browser from the host cache", async () => {
  const root = await cache();
  const executable = computeExecutablePath(testBrowserOptions(root));
  await NodeFSP.mkdir(NodePath.dirname(executable), { recursive: true });
  await NodeFSP.writeFile(executable, "test executable", { mode: 0o755 });
  await expect(resolveTestBrowser(undefined, root)).resolves.toBe(executable);
});
it("uses an explicit browser override and refuses an invalid override without falling back", async () => {
  const root = await cache();
  const executable = NodePath.join(root, "custom-browser");
  await NodeFSP.writeFile(executable, "test executable", { mode: 0o755 });
  await expect(resolveTestBrowser(executable, root)).resolves.toBe(executable);
  await expect(resolveTestBrowser(NodePath.join(root, "missing"), root)).rejects.toThrow(
    "MATE_CHROME_BIN",
  );
});
