import { describe, expect, it } from "@effect/vitest";
import { MateLiveView } from "@t3tools/shared/hqMates";
import { OverviewThreads } from "@t3tools/shared/mateLink";
import * as Schema from "effect/Schema";

import { applyMatesEvent, applyPeopleEvent } from "./mates.ts";
import type { HqMates, HqStructureEvent } from "./stream.ts";

const AT = "2026-10-03T10:00:00.000Z";
const LATER = "2026-10-03T10:05:00.000Z";

const view = Schema.decodeUnknownSync(MateLiveView);
const threadsOf = Schema.decodeUnknownSync(OverviewThreads);

/** Vera, online, nothing running. */
const VERA = view({
  presence: { online: true, since: AT, overview: "live" },
  identity: { environmentId: "env-vera", serverVersion: "0.11.90", update: null },
  main: null,
  threads: { list: [], omitted: 0 },
  logins: { "claude-code": { signedInBy: "u-ada", present: true, token: false } },
  crew: { status: "off" },
});
/** Ada, asleep: her last overview as HQ stored it. */
const ADA = view({
  presence: { online: false, since: AT, overview: "stored" },
  identity: { environmentId: "env-ada", serverVersion: "0.11.90", update: null },
  main: null,
  threads: { list: [], omitted: 0 },
  logins: {},
  crew: { status: "off" },
});

describe("applyMatesEvent", () => {
  it("folds sections onto the Mate they name", () => {
    const threads = threadsOf({
      list: [
        {
          id: "t1",
          title: "Add a /status page",
          kind: "approval",
          turnId: "turn-1",
          turnState: "running",
          completedAt: null,
        },
      ],
      omitted: 2,
    });
    const presence = { online: false, since: LATER, overview: "stored" } as const;
    const held = new Map([
      ["p1", VERA],
      ["p2", ADA],
    ]);

    const folded = applyMatesEvent(held, {
      kind: "mate",
      projectId: "p1",
      value: { presence, threads },
    });

    expect(folded).toEqual(
      new Map([
        ["p1", { ...VERA, presence, threads }],
        ["p2", ADA],
      ]),
    );
    expect(folded?.get("p2")).toBe(ADA);
  });

  it("drops a Mate sent as null", () => {
    const held = new Map([
      ["p1", VERA],
      ["p2", ADA],
    ]);
    expect(applyMatesEvent(held, { kind: "mate", projectId: "p1", value: null })).toEqual(
      new Map([["p2", ADA]]),
    );
  });

  it("a snapshot replaces every Mate", () => {
    const held = new Map([
      ["p1", VERA],
      ["p2", ADA],
    ]);
    const snapshot = (mates: HqMates | null): HqStructureEvent => ({
      kind: "snapshot",
      structure: { ungrouped: [], apps: [] },
      changes: null,
      mates,
      people: null,
    });
    const sent = new Map([["p3", { ...ADA, presence: { ...ADA.presence, since: LATER } }]]);

    expect(applyMatesEvent(held, snapshot(sent))).toBe(sent);
    // An HQ from before the Mates' overviews sends none: none is known.
    expect(applyMatesEvent(held, snapshot(null))).toBeNull();
  });

  it("holds a Mate it did not from a message that carries its presence", () => {
    const held = new Map([["p1", VERA]]);
    // The reader may observe Ada now: HQ sends her whole.
    expect(applyMatesEvent(held, { kind: "mate", projectId: "p2", value: ADA })).toEqual(
      new Map([
        ["p1", VERA],
        ["p2", ADA],
      ]),
    );
    // Sections without the presence they belong to are no Mate to hold.
    expect(applyMatesEvent(held, { kind: "mate", projectId: "p2", value: { main: null } })).toBe(
      held,
    );
  });
});

describe("applyPeopleEvent", () => {
  it("takes the people map whole, from a snapshot and from its own message", () => {
    const people = { "u-ada": { name: "Ada Lovelace" } };
    const renamed = { "u-ada": { name: "Ada King" } };
    const snapshot: HqStructureEvent = {
      kind: "snapshot",
      structure: { ungrouped: [], apps: [] },
      changes: null,
      mates: null,
      people,
    };

    expect(applyPeopleEvent(null, snapshot)).toBe(people);
    expect(applyPeopleEvent(people, { kind: "people", people: renamed })).toBe(renamed);
    expect(applyPeopleEvent(people, { kind: "mate", projectId: "p1", value: null })).toBe(people);
  });
});
