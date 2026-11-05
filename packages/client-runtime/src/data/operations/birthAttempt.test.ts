import { describe, expect, it } from "vite-plus/test";

import { ZeropsApiError } from "../../zerops/api.ts";
import type { OperationIntent } from "../model.ts";
import { birthAttempt } from "./birthAttempt.ts";
import { OperationStopped, type RunToEnd } from "./runToEnd.ts";

describe("a birth's attempt", () => {
  it.each(["create", "import"] as const)(
    "releases an unsent %s attempt with its original claim",
    async (step) => {
      const sent: OperationIntent[] = [];
      const run = (async (intent: OperationIntent) => {
        sent.push(intent);
        if (intent.kind === "claim-birth-attempt")
          return { claim: { by: "person", at: "claim-at" } };
        return undefined;
      }) as RunToEnd;
      const stopped = new OperationStopped("Key unavailable.", undefined, false, true);
      await expect(
        birthAttempt(
          run,
          "org",
          "birth",
          () => true,
        )(step, async () => {
          throw stopped;
        }),
      ).rejects.toBe(stopped);
      expect(sent).toEqual([
        { kind: "claim-birth-attempt", orgId: "org", birthId: "birth", step },
        {
          kind: "end-birth-attempt",
          orgId: "org",
          birthId: "birth",
          step,
          outcome: "unsent",
          at: "claim-at",
          reason: "Key unavailable.",
        },
      ]);
    },
  );

  it.each(["create", "import"] as const)(
    "records only a proven synchronous %s refusal against the winning claim",
    async (step) => {
      const sent: OperationIntent[] = [];
      const run = (async (intent: OperationIntent) => {
        sent.push(intent);
        if (intent.kind === "claim-birth-attempt")
          return { claim: { by: "person", at: "claim-at" } };
        return undefined;
      }) as RunToEnd;
      const attempt = birthAttempt(run, "org", "birth", () => true);
      const refused = new OperationStopped("Quota reached.", undefined, true);
      await expect(
        attempt(step, async () => {
          throw refused;
        }),
      ).rejects.toBe(refused);
      expect(sent).toEqual([
        { kind: "claim-birth-attempt", orgId: "org", birthId: "birth", step },
        {
          kind: "end-birth-attempt",
          orgId: "org",
          birthId: "birth",
          step,
          outcome: "refused",
          at: "claim-at",
          reason: "Quota reached.",
        },
      ]);

      sent.length = 0;
      const failedAfterAcceptance = new OperationStopped("Process failed.", undefined);
      await expect(
        attempt(step, async () => {
          throw failedAfterAcceptance;
        }),
      ).rejects.toBe(failedAfterAcceptance);
      expect(sent).toEqual([{ kind: "claim-birth-attempt", orgId: "org", birthId: "birth", step }]);

      sent.length = 0;
      const lost = new ZeropsApiError("Answer lost.", "uncertain");
      await expect(
        attempt(step, async () => {
          throw lost;
        }),
      ).rejects.toBe(lost);
      expect(sent).toEqual([{ kind: "claim-birth-attempt", orgId: "org", birthId: "birth", step }]);
    },
  );

  it("never sends a write after another device holds the claim", async () => {
    const refused = new Error("attempt_taken");
    const run = (async () => {
      throw refused;
    }) as RunToEnd;
    let sends = 0;
    await expect(
      birthAttempt(
        run,
        "org",
        "birth",
        () => true,
      )("import", async () => {
        sends += 1;
      }),
    ).rejects.toBe(refused);
    expect(sends).toBe(0);
  });
});
