import { inProcessCore } from "../../harness/hqCore.ts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { ChangeReceipt, type ChangeReceiptPart } from "@t3tools/shared/hqChanges";
import { tempPostgresLayer } from "../../../../../hq/test/harness/tempPostgres.ts";
import { createScenario } from "../../harness/scenario.ts";
import { installArea } from "../d-change/fake.ts";
import { changeFixture, review } from "../d-change/dsl.ts";

const OLDER = "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678";
const encodeReceipt = Schema.encodeSync(Schema.fromJsonString(ChangeReceipt));

describe("E: an application of several parts", () => {
  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
    it.effect(
      "A change review lists each part's preview from its receipt, one stale and one failed, and still offers Merge",
      () =>
        Effect.gen(function* () {
          const s = yield* createScenario([installArea]);
          const change = yield* changeFixture(s);
          const r = review(s);
          const [row] = yield* inProcessCore(s.drivers.core).sql<{ readonly head: string }>`
            SELECT head FROM hq_change WHERE repo = 'appdev' AND number = 1`;
          const head = row!.head;
          const part = (setup: string, more: Partial<ChangeReceiptPart>): ChangeReceiptPart => ({
            setup,
            previewHostname: `${setup}stage`,
            deploy: "ok",
            deployedAt: "2026-10-14T21:06:00Z",
            workspaceClean: true,
            deployedCommit: head,
            verified: true,
            ...more,
          });
          // zcp's receipt of the change's last push: web at its head, api from an older commit,
          // worker's preview failed.
          const receipt = {
            at: "2026-10-14T21:10:00Z",
            parts: [
              part("web", {}),
              part("api", { deployedCommit: OLDER }),
              (({ deployedCommit: _none, ...failed }) => failed)(
                part("worker", { deploy: "failed", verified: false }),
              ),
            ],
          };
          yield* inProcessCore(s.drivers.core).sql`
            UPDATE hq_change SET receipt = ${encodeReceipt(receipt)}::jsonb
            WHERE repo = 'appdev' AND number = 1`;

          yield* Effect.promise(() => s.page.setViewport({ width: 1786, height: 1000 }));
          yield* s.given.signedIn;
          yield* r.open;
          yield* r.text(change.title);
          yield* r.text("workerstage");
          const short = head.slice(0, 7);
          expect(
            yield* Effect.promise(() =>
              s.page.evaluate(() => {
                const section = [
                  ...document.querySelectorAll<HTMLElement>(
                    '[data-zerops-surface="review"] section',
                  ),
                ].find(
                  (node) =>
                    node.getBoundingClientRect().height > 0 &&
                    node.querySelector(".rv-sec-h")?.textContent?.startsWith("Parts") === true,
                );
                return [...(section?.querySelectorAll("li") ?? [])].map((li) =>
                  li.innerText.trim(),
                );
              }),
            ),
            "ASSERTION: the review lists the receipt's three parts, each as its preview stands",
          ).toEqual([
            `web · webstage · from ${short} · verified`,
            `api · apistage · from a1b2c3d, the change is at ${short} · verified`,
            "worker · workerstage · deploy failed",
          ]);
          yield* r.text("Not tried at this change: api (older commit), worker (failed).");
          yield* r.mergeEnabled;
          yield* s.then.noExternalNetwork;
        }),
    );
  });
});
