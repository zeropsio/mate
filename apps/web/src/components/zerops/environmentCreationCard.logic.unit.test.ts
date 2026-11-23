import { expect, it } from "vite-plus/test";
import { creationStartAgain, type CreationAsked } from "./environmentCreationCard.logic.ts";

// witness: apps/web/src/components/zerops/environmentCreationCard.logic.ts | if (creation === null || creation.ended !== true || creation.operationId !== operation.id) → if (creation === null || creation.operationId !== operation.id)
it("MN+1: A stage or a production this page asked for offers Start again at its own tier once HQ's environment operation of it ended failed, and never while it runs, for a deploy key, or for an operation started elsewhere; breaks: a failed stage's card offers only Dismiss, or a running one offers a second start", () => {
  const environment = { id: "op-1", kind: "environment" };
  const cases: ReadonlyArray<
    readonly [
      CreationAsked | null,
      { readonly id: string; readonly kind: string },
      string | undefined,
    ]
  > = [
    [{ tier: "stage", operationId: "op-1", ended: true }, environment, "stage"],
    [{ tier: "production", operationId: "op-1", ended: true }, environment, "prod"],
    [{ tier: "stage", operationId: "op-1" }, environment, undefined],
    [{ tier: "stage" }, environment, undefined],
    [
      { tier: "stage", operationId: "op-1", ended: true },
      { id: "op-1", kind: "deploy_key" },
      undefined,
    ],
    [{ tier: "stage", operationId: "op-2", ended: true }, environment, undefined],
    [null, environment, undefined],
  ];
  for (const [creation, operation, again] of cases)
    expect(creationStartAgain(creation, operation), JSON.stringify([creation, operation])).toBe(
      again,
    );
});
