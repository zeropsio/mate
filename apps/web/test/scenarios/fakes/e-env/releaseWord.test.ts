// @effect-diagnostics nodeBuiltinImport:off -- release observer fidelity against a tiny loopback document.
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { expect, it } from "vite-plus/test";
import { openBrowser } from "../../harness/browser.ts";
import { recordReleaseWords } from "../../areas/e-env/dsl.ts";

it.each(["unchanged", "text flash", "replacement flash", "disappears"] as const)(
  "release observer retains %s between condition waits",
  async (change) => {
    const dist = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "scenario-release-word-"));
    await NodeFSP.writeFile(
      NodePath.join(dist, "index.html"),
      '<!doctype html><div data-zerops-environment-row><span data-zerops-surface="environment-name">v0.1.0</span><span>Deploy failed</span></div>',
    );
    const web = await openBrowser(dist, {});
    try {
      await web.page.goto(web.origin);
      const guard = await recordReleaseWords(web.page, "v0.1.0");
      try {
        await web.page.evaluate((change) => {
          const row = document.querySelector("[data-zerops-environment-row]")!;
          const word = row.lastElementChild!;
          if (change === "text flash") {
            word.firstChild!.textContent = "Approved";
            word.firstChild!.textContent = "Deploy failed";
          } else if (change === "replacement flash") {
            word.textContent = "Approved";
            word.textContent = "Deploy failed";
          } else if (change === "disappears") row.remove();
        }, change);
        expect(await guard.evaluate((state) => state.words)).toEqual(
          change === "unchanged"
            ? ["Deploy failed"]
            : change === "disappears"
              ? ["Deploy failed", "missing"]
              : ["Deploy failed", "Approved", "Deploy failed"],
        );
        expect(web.pageErrors).toEqual([]);
      } finally {
        await guard.evaluate((state) => state.observer?.disconnect());
        await guard.dispose();
      }
    } finally {
      await web.close();
      await NodeFSP.rm(dist, { recursive: true, force: true });
    }
  },
);
