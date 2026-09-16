import { describe, expect, it } from "@effect/vitest";

import { zeropsCandidatePresentation } from "./presentation";

describe("zeropsCandidatePresentation", () => {
  it.each([
    ["connected", "Connected", "Open"],
    ["ready", "Ready", "Connect"],
    ["provisioning", "Starting", null],
    ["unavailable", "Unavailable", null],
  ] as const)("%s reads as %s", (group, label, action) => {
    const presentation = zeropsCandidatePresentation(group);
    expect(presentation.label).toBe(label);
    expect(presentation.action).toBe(action);
    expect(presentation.notice).toBeUndefined();
  });

  // Whose Mate it is outranks whatever its container is doing (D5).
  it.each(["connected", "ready", "provisioning", "unavailable"] as const)(
    "a listed Mate offers no verb, whatever its %s container is doing",
    (group) => {
      const presentation = zeropsCandidatePresentation(group, { visibility: "listed" });
      expect(presentation).toEqual({
        label: "Not yours",
        tone: "off",
        action: null,
        notice: "Only its owner opens this Mate.",
      });
    },
  );

  it("names the owner when the account can be read for one", () => {
    expect(
      zeropsCandidatePresentation("ready", { visibility: "listed", ownerName: "Jan" }).notice,
    ).toBe("Jan's Mate — only Jan opens it.");
  });
});
