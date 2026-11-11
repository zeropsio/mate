// @effect-diagnostics nodeBuiltinImport:off -- the commit is written into a scratch clone.
import { scenarioSuite } from "../../harness/suite.ts";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { gitClient } from "../../harness/gitClient.ts";
import { createScenario } from "../../harness/scenario.ts";

const lines = (count: number, tag: string) =>
  Array.from({ length: count }, (_, i) => `${tag} line ${String(i)}\n`).join("");

describe("Git browser diff", () => {
  scenarioSuite((it) => {
    it.effect("A jump to a file lands that file at the top, after any long file", () =>
      Effect.gen(function* () {
        const s = yield* createScenario();
        const credential = yield* s.given.project("Ada", { mate: true, app: "Shop" });
        const appId = s.appIds.get("Shop")!;
        expect(
          (yield* s.drivers.core.call("POST", "/api/mate/repos", {
            headers: { authorization: s.drivers.mateAuthorization(credential!) },
            body: { name: "appdev" },
          })).status,
        ).toBe(200);
        const git = yield* gitClient;
        yield* git.checked(s.drivers.mateClone(credential!, appId, "appdev", "work"));
        const work = NodePath.join(git.dir, "work");
        // A long file the viewer has not measured, then short files that end the diff.
        const files = {
          "data/long.txt": lines(2000, "long"),
          "notes/a.txt": lines(3, "a"),
          "notes/b.txt": lines(3, "b"),
          "notes/c.txt": lines(3, "c"),
        };
        for (const [path, content] of Object.entries(files)) {
          NodeFS.mkdirSync(NodePath.dirname(NodePath.join(work, path)), { recursive: true });
          NodeFS.writeFileSync(NodePath.join(work, path), content);
        }
        yield* git.checked(["add", "-A"], work);
        yield* git.checked(["commit", "-m", "Add the notes"], work);
        yield* git.checked(["push", "origin", "HEAD:refs/heads/notes"], work);
        const sha = (yield* git.checked(["rev-parse", "HEAD"], work)).trim();
        yield* s.given.signedIn;
        yield* Effect.promise(async () => {
          await s.page.setViewport({ width: 1786, height: 1000 });
          await s.page.goto(
            `${s.web.origin}/git?${new URLSearchParams({ appId, repo: "appdev", rev: sha, view: "commit" })}`,
          );
          await s.page.locator("::-p-text(4 files changed)").wait();
          for (const path of ["notes/a.txt", "notes/c.txt"]) {
            await s.page.$eval(".diff-render-surface", (surface) => {
              surface.scrollTo(0, 0);
              delete (window as unknown as { __jumpOffset?: number }).__jumpOffset;
            });
            await s.page.locator(`::-p-aria(Changed files) ::-p-text(${path})`).click();
            // The jump settles once the target's header stays put for two frames.
            const offset = await s.page.waitForFunction(
              (path) => {
                const all: Element[] = [];
                const walk = (root: Document | ShadowRoot) => {
                  for (const element of root.querySelectorAll("*")) {
                    all.push(element);
                    if (element.shadowRoot) walk(element.shadowRoot);
                  }
                };
                walk(document);
                const header = all.find(
                  (element) =>
                    element.hasAttribute("data-diffs-header") &&
                    element.textContent?.includes(path),
                );
                const surface = document.querySelector(".diff-render-surface");
                if (header === undefined || surface === null) return false;
                const offset =
                  header.getBoundingClientRect().top - surface.getBoundingClientRect().top;
                const state = window as unknown as { __jumpOffset?: number };
                const settled = state.__jumpOffset === offset;
                state.__jumpOffset = offset;
                return settled ? { offset } : false;
              },
              { polling: "raf" },
              path,
            );
            expect({ path, ...(await offset.jsonValue()) }).toEqual({ path, offset: 0 });
          }
        });
      }),
    );
  });
});
