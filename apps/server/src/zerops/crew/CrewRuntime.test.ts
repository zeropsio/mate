import { describe, expect, it } from "@effect/vitest";

import { claimTransition } from "./crewMachines.ts";
import {
  claimEventFromServed,
  claimRequest,
  holdsClaim,
  servedFrom,
  showOnDevAnswer,
} from "./CrewRuntime.ts";

const HANDLES = ["backend", "frontend"];

describe("servedFrom", () => {
  it.each([
    ["the tree", "/var/www", { by: "tree" }],
    ["a directory of the tree", "/var/www/web", { by: "tree" }],
    ["a crewmate's copy", "/var/www/.crew/backend", { by: "crewmate", handle: "backend" }],
    [
      "a directory of a copy",
      "/var/www/.crew/frontend/web",
      { by: "crewmate", handle: "frontend" },
    ],
    ["a copy nobody on the crew owns", "/var/www/.crew/ghost", { by: "unknown" }],
    ["the lanes' parent", "/var/www/.crew", { by: "unknown" }],
    ["a deleted copy", "/var/www/.crew/backend (deleted)", { by: "unknown" }],
    ["a sibling that shares the prefix", "/var/www2", { by: "unknown" }],
    ["somewhere else", "/srv/app", { by: "unknown" }],
    ["no running dev server", undefined, { by: "unknown" }],
  ] as const)("%s", (_name, cwd, served) => {
    expect(servedFrom(cwd, "/var/www", HANDLES)).toEqual(served);
  });
});

describe("claimEventFromServed", () => {
  const tree = { by: "tree" } as const;
  const holder = { by: "crewmate", handle: "backend" } as const;
  const other = { by: "crewmate", handle: "frontend" } as const;
  const unknown = { by: "unknown" } as const;

  // [claim state, what dev serves, the event, the state it moves to]
  it.each([
    ["starting", holder, "serves-lane", "held"],
    ["starting", tree, "serves-other", "releasing"],
    ["starting", other, "serves-other", "releasing"],
    ["starting", unknown, "serves-other", "releasing"],
    ["held", holder, undefined, "held"],
    ["held", tree, "person-dev-server", "none"],
    ["held", unknown, "person-dev-server", "none"],
    ["releasing", tree, "serves-tree", "none"],
    ["releasing", holder, "turn-failed", "release-failed"],
    ["releasing", unknown, "turn-failed", "release-failed"],
    ["release-failed", tree, "serves-tree", "none"],
    ["release-failed", holder, undefined, "release-failed"],
    ["none", tree, undefined, "none"],
    ["requested", holder, undefined, "requested"],
  ] as const)("%s, serving %j → %s", (state, served, event, to) => {
    expect(claimEventFromServed(state, served, "backend")).toBe(event);
    if (event !== undefined) expect(claimTransition(state, event)).toEqual({ kind: "moved", to });
  });
});

describe("claimRequest", () => {
  // [the host's claim, whether backend has a copy there, outcome, answer, isError]
  it.each([
    [undefined, true, { kind: "requested" }, false],
    [{ state: "none", handle: null }, true, { kind: "requested" }, false],
    [{ state: "requested", handle: "backend" }, true, { kind: "pending" }, false],
    [{ state: "starting", handle: "backend" }, true, { kind: "pending" }, false],
    [{ state: "held", handle: "backend" }, true, { kind: "shown" }, false],
    [{ state: "requested", handle: "frontend" }, true, { kind: "busy", by: "frontend" }, true],
    [{ state: "held", handle: "frontend" }, true, { kind: "busy", by: "frontend" }, true],
    [{ state: "releasing", handle: "backend" }, true, { kind: "releasing" }, true],
    [{ state: "release-failed", handle: "frontend" }, true, { kind: "releasing" }, true],
    [undefined, false, { kind: "no-lane" }, true],
  ] as const)("%j (copy: %s) → %j", (claim, lane, outcome, isError) => {
    expect(claimRequest(claim, "backend", lane)).toEqual(outcome);
    const answer = showOnDevAnswer(outcome, "appdev");
    expect(answer.isError).toBe(isError);
    expect(answer.text).not.toBe("");
  });

  it("names the host and what happens next", () => {
    expect(showOnDevAnswer({ kind: "requested" }, "appdev").text).toBe(
      "Asked the person to show your copy on appdev. If they grant it, a short turn in this conversation restarts appdev's dev server from your copy.",
    );
    expect(showOnDevAnswer({ kind: "busy", by: "frontend" }, "appdev").text).toBe(
      "appdev is taken by @frontend's work; ask again once it is released.",
    );
  });
});

describe("holdsClaim", () => {
  it.each([
    [{ state: "held", handle: "backend" }, true],
    [{ state: "starting", handle: "backend" }, false],
    [{ state: "held", handle: "frontend" }, false],
    [undefined, false],
  ] as const)("%j → %s", (claim, holds) => {
    expect(holdsClaim(claim, "backend")).toBe(holds);
  });
});
