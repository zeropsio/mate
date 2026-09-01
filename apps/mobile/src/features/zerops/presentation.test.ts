import { expect, it } from "@effect/vitest";

import { zeropsCandidatePresentation } from "./presentation";

it("presents every candidate state with a truthful action", () => {
  expect(zeropsCandidatePresentation("connected")).toEqual({
    label: "Connected",
    tone: "ok",
    action: "Open",
  });
  expect(zeropsCandidatePresentation("ready")).toEqual({
    label: "Ready",
    tone: "busy",
    action: "Connect",
  });
  expect(zeropsCandidatePresentation("provisioning")).toEqual({
    label: "Starting",
    tone: "attention",
    action: null,
  });
  expect(zeropsCandidatePresentation("unavailable")).toEqual({
    label: "Unavailable",
    tone: "off",
    action: null,
  });
});
