import { describe, expect, it } from "vite-plus/test";

import { ZeropsApiError } from "../../zerops/api.ts";
import { zeropsFault } from "../../zerops/data/zeropsWire.ts";
import { classifyHttp } from "./zerops.ts";

describe("what a failed Zerops answer says to the person", () => {
  it.each([
    { status: 403, message: "This Zerops account is not allowed to do that." },
    { status: 404, message: "Zerops API request failed (404)." },
    { status: 503, message: "Zerops API request failed (503)." },
  ])("an answer of $status with no words of its own: $message", ({ status, message }) => {
    expect(classifyHttp(status).message).toBe(message);
  });

  it("keeps the platform's own words, classified by the status", () => {
    const fault = zeropsFault(
      new ZeropsApiError("Project is being deleted.", "invalid-input", 400, "projectDeleting"),
    );
    expect(fault).toEqual({ outcome: "definitive-refusal", message: "Project is being deleted." });
  });

  it("keeps the retry the platform asked for", () => {
    const fault = zeropsFault(
      new ZeropsApiError("Zerops API request failed (429).", "server", 429, null, null, 2_000),
    );
    expect(fault).toEqual({
      outcome: "transient",
      message: "Zerops API request failed (429).",
      retryAfterMs: 2_000,
    });
  });
});
