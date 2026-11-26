import { expect, it } from "vite-plus/test";
import type { HqOperation } from "../../zerops/hq/client.ts";
import { mateDeletionOf } from "./mateDeletion.ts";

// witness: packages/client-runtime/src/data/projections/mateDeletion.ts | const kind = evidence.operation?.kind === APP_DELETION ? APP_DELETION : MATE_DELETION; → const kind = MATE_DELETION;
it("PJ156: A Mate whose project shows its application's deletion running is being deleted, and waiting it waits with that deletion's id; breaks: a Mate held by its project's deletion opens and takes work the deletion then removes.", () => {
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

// witness: packages/client-runtime/src/data/projections/mateDeletion.ts | if (deletion.kind === "waiting") return { ...deletion, operationKind: kind }; → if (deletion.kind === "waiting") return { ...deletion, operationKind: MATE_DELETION };
it("PJ158: an app deletion waiting on the Mate's project keeps its kind, as does a Mate deletion; breaks: End describes the Mate's deletion while ending its whole application's.", () => {
  const at = "2026-11-23T10:00:00Z";
  const failure = { step: "delete", code: "token_expired", at, origin: "hq" };
  const cases = [
    { kind: "app_deletion", status: "DELETING", offers: ["continue", "end"], yours: true },
    { kind: "mate_deletion", status: "ACTIVE", offers: ["end"], yours: false },
  ] as const;
  for (const entry of cases) {
    const operation: HqOperation = {
      id: "op-1",
      kind: entry.kind,
      phase: "deleting",
      at,
      acceptedAt: at,
      failure,
      continueBy: "maker",
      offers: entry.offers,
    };
    expect(mateDeletionOf({ operation, status: entry.status })).toMatchObject({
      kind: "waiting",
      operationKind: entry.kind,
      id: "op-1",
      continueBy: "maker",
      yours: entry.yours,
      endable: true,
    });
  }
});
