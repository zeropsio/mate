import type { OperationProgress } from "@t3tools/client-runtime/data";
import { describe, expect, it } from "vite-plus/test";

import type { AccountOperations } from "./accountOperations";
import { submitZeropsWrite } from "./zeropsWrite";

const answering = (progress: OperationProgress) => {
  const sent: unknown[] = [];
  const operations = {
    submit: async (intent: unknown) => {
      sent.push(intent);
      return { requestId: "r1", progress, evidence: null };
    },
  } as unknown as AccountOperations;
  return { operations, sent };
};

const PUBLISH = { kind: "enable-subdomain-access", projectId: "p1", serviceId: "s1" } as const;

describe("submitZeropsWrite", () => {
  it("resolves once Zerops took the write and rejects with what to tell the person", async () => {
    for (const [progress, trouble] of [
      [{ stage: "done", operationId: "s1", outcome: "succeeded" }, null],
      [{ stage: "accepted", operationId: "proc-1" }, null],
      [{ stage: "reflected", operationId: "proc-1" }, null],
      [{ stage: "refused", reason: "Not allowed." }, "Not allowed."],
      [{ stage: "unsent", next: "send-again" }, "Zerops did not take the change. Try again."],
      [
        { stage: "unsent", next: "send-again", reason: "Project access could not be verified." },
        "Project access could not be verified.",
      ],
      [
        { stage: "uncertain", next: "ask-owner-again" },
        "Zerops may have accepted this operation, but its response was lost. Check the project and its services before starting another operation.",
      ],
      [
        { stage: "done", operationId: "p1", outcome: "failed", reason: "It went wrong." },
        "It went wrong.",
      ],
    ] satisfies ReadonlyArray<readonly [OperationProgress, string | null]>) {
      const { operations, sent } = answering(progress);
      const written = submitZeropsWrite(operations, "org-1", PUBLISH);
      if (trouble === null) await expect(written).resolves.toEqual({ requestId: "r1", progress });
      else await expect(written).rejects.toThrow(trouble);
      expect(sent).toEqual([{ ...PUBLISH, orgId: "org-1" }]);
    }
  });

  it("says what landed of a write whose next step is the person's", async () => {
    const { operations } = answering({
      stage: "unresolved",
      operationId: null,
      nextActor: "person",
      nextAction: "Restart the Mate",
    });
    await expect(
      submitZeropsWrite(operations, "org-1", {
        kind: "enable-zerops-mate",
        projectId: "p1",
        serviceId: "s1",
      }),
    ).rejects.toThrow(
      "Zerops Mate is turned on, but its container was not restarted. Restart the Mate.",
    );
  });

  it("refuses without an open organization and sends nothing", async () => {
    const { operations, sent } = answering({ stage: "submitting" });
    await expect(submitZeropsWrite(operations, null, PUBLISH)).rejects.toThrow(
      "No organization is open.",
    );
    expect(sent).toEqual([]);
  });
});
