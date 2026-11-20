import { expect, it } from "vite-plus/test";

import { chiefNames, chiefQuestion, chiefSetupEntry, chiefSetupLine, isChief } from "./chief.ts";

// witness: packages/client-runtime/src/zerops/chief.ts | return project.tagList?.includes(CHIEF_TAG) === true; → return project.tagList !== undefined;
it("ZV85: A project is a Chief's only where it carries the Chief tag", () => {
  expect(isChief({ tagList: ["mate", "chief"] })).toBe(true);
  expect(isChief({ tagList: ["mate"] })).toBe(false);
  expect(isChief({ tagList: [] })).toBe(false);
  expect(isChief({ tagList: undefined })).toBe(false);
});

// witness: packages/client-runtime/src/zerops/chief.ts | organization ?? "your organization" → "your organization"
it("ZV86: A Chief's empty conversation asks about the organization by its name, and never names a missing organization", () => {
  const question = chiefQuestion("Chief", "Acme Ltd");
  expect(question).toContain("Acme Ltd");
  expect(question).toContain("Chief");
  expect(chiefQuestion("Chief", undefined)).not.toContain("undefined");
});

// witness: packages/client-runtime/src/zerops/chief.ts | person?.fullName?.trim().split(/\s+/u)[0] || → person?.fullName?.trim() ||
it("ZV87: A new Chief's application is named after the person's first name, else the first word of their full name, else their address's name, and Chief alone with nobody known; its Mate is called Chief", () => {
  expect(chiefNames({ firstName: "Aleš", fullName: "Aleš R", email: "a@x.io" })).toEqual({
    name: "Chief · Aleš",
    botName: "Chief",
  });
  expect(chiefNames({ fullName: "Jan Novak", email: "j@x.io" })).toEqual({
    name: "Chief · Jan",
    botName: "Chief",
  });
  expect(chiefNames({ email: "karlos@zerops.io" })).toEqual({
    name: "Chief · karlos",
    botName: "Chief",
  });
  expect(chiefNames(null)).toEqual({ name: "Chief", botName: "Chief" });
});

// witness: packages/client-runtime/src/zerops/chief.ts | return own === null && setup === "idle"; → return own !== undefined && setup === "idle";
it("ZV88: Setting up a Chief is offered only to a viewer known to have none, and only while no setup of theirs runs, stopped or is done", () => {
  expect(chiefSetupEntry(null, "idle")).toBe(true);
  expect(chiefSetupEntry("p", "idle")).toBe(false);
  expect(chiefSetupEntry(undefined, "idle")).toBe(false);
  expect(chiefSetupEntry(null, "running")).toBe(false);
  expect(chiefSetupEntry(null, "failed")).toBe(false);
  expect(chiefSetupEntry(null, "done")).toBe(false);
});

// witness: packages/client-runtime/src/zerops/chief.ts | if (input.own !== null || !input.mayCreate) return null; → if (input.own !== null) return null;
it("ZV89: The menu's top row offers a Chief only to a person known to have none who may make its project; to a person with one, or while whose is not known, it offers nothing", () => {
  expect(chiefSetupLine({ own: null, mayCreate: true, setup: "idle" })).toBe("offer");
  expect(chiefSetupLine({ own: "p", mayCreate: true, setup: "idle" })).toBeNull();
  expect(chiefSetupLine({ own: undefined, mayCreate: true, setup: "idle" })).toBeNull();
  expect(chiefSetupLine({ own: null, mayCreate: false, setup: "idle" })).toBeNull();
});

// witness: packages/client-runtime/src/zerops/chief.ts | if (input.setup === "done") return typeof input.own === "string" ? null : "running"; → if (input.setup === "done") return null;
it("ZV90: The menu's top row shows a Chief's setup running while it runs and, once done, until HQ names the Chief, and stopped once it failed", () => {
  expect(chiefSetupLine({ own: null, mayCreate: true, setup: "running" })).toBe("running");
  expect(chiefSetupLine({ own: "p", mayCreate: true, setup: "failed" })).toBe("stopped");
  expect(chiefSetupLine({ own: "p", mayCreate: true, setup: "done" })).toBeNull();
  expect(chiefSetupLine({ own: null, mayCreate: true, setup: "done" })).toBe("running");
});
