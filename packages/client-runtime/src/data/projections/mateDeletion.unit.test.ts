import { expect, it } from "vite-plus/test";
import type { HqOperation } from "../../zerops/hq/client.ts";
import { mateDeletionOf } from "./mateDeletion.ts";

// witness: packages/client-runtime/src/data/projections/mateDeletion.ts | const kind = evidence.operation?.kind === APP_DELETION ? APP_DELETION : MATE_DELETION; → const kind = MATE_DELETION;
it("PJ+1: A Mate whose project shows its application's deletion running is being deleted, and waiting it waits with that deletion's id; breaks: a Mate held by its project's deletion opens and takes work the deletion then removes.", () => {
  const operation: HqOperation = {
    id: "op",
    kind: "app_deletion",
    phase: "deleting",
    at: "2026-11-23T10:00:00Z",
    acceptedAt: "2026-11-23T10:00:00Z",
  };
  const failure = { step: "delete", code: "token_expired", at: operation.at, origin: "hq" };
  const cases: ReadonlyArray<readonly [HqOperation | undefined, object]> = [
    [operation, { kind: "deleting" }],
    [
      { ...operation, failure, continueBy: "maker", offers: ["continue", "end"] },
      { kind: "waiting", id: "op", continueBy: "maker", yours: true, endable: true },
    ],
    [{ ...operation, failure }, { kind: "none" }],
    [undefined, { kind: "none" }],
  ];
  for (const [shown, expected] of cases) {
    expect(mateDeletionOf({ operation: shown, status: undefined })).toMatchObject(expected);
  }
});
