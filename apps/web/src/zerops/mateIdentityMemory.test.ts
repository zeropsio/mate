import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  mateDirectoryWhole,
  mateOfProject,
  readIdentityMemory,
  withMateIdentities,
  writeIdentityMemory,
} from "./mateIdentityMemory";
import type { ZeropsMateIdentity } from "./mateIdentities";

const GITA = EnvironmentId.make("env-gita");
const PIA = EnvironmentId.make("env-pia");
const identity = (name: string): ZeropsMateIdentity => ({
  serviceId: `svc-${name}`,
  name,
  tint: "amber",
  shape: "hexagon",
  project: "Heron",
  projectUrl: `https://app.zerops.example/project/p-${name}`,
  connected: true,
});

// A reload draws a Mate's stage from its first frame (the owner, 2026-09-30: a conversation URL
// sat blank for 3 s while the catalog was read): its name and face as this browser last knew them.
describe("the Mate identity memory", () => {
  it.each([
    {
      case: "a directory's Mates are remembered, awake or not, as asleep",
      stored: {},
      directory: new Map([[GITA, identity("Gita")]]),
      expected: {
        [GITA]: { ...identity("Gita"), connected: false },
      },
    },
    {
      case: "a Mate the directory does not name now is kept",
      stored: { [PIA]: { ...identity("Pia"), connected: false } },
      directory: new Map([[GITA, identity("Gita")]]),
      expected: {
        [PIA]: { ...identity("Pia"), connected: false },
        [GITA]: { ...identity("Gita"), connected: false },
      },
    },
    {
      case: "an environment the directory says nobody lives in is forgotten",
      stored: { [PIA]: { ...identity("Pia"), connected: false } },
      directory: new Map([[PIA, null]]),
      expected: {},
    },
  ])("$case", ({ stored, directory, expected }) => {
    expect(withMateIdentities(stored, directory)).toEqual(expected);
  });

  // A Mate that left the account is forgotten once a whole listing says so, never on a partial
  // one: a reload of its old URL would paint a face and take it back.
  it.each([
    { case: "a complete listing without it forgets it", complete: true, kept: ["Gita"] },
    { case: "a listing still being read keeps it", complete: false, kept: ["Pia", "Gita"] },
  ])("$case", ({ complete, kept }) => {
    const stored = { [PIA]: { ...identity("Pia"), connected: false } };
    const next = withMateIdentities(stored, new Map([[GITA, identity("Gita")]]), { complete });
    expect(Object.values(next).map((mate) => mate.name)).toEqual(kept);
  });

  it("keeps the same memory when nothing changed, so nothing is written", () => {
    const stored = withMateIdentities({}, new Map([[GITA, identity("Gita")]]));
    expect(withMateIdentities(stored, new Map([[GITA, identity("Gita")]]))).toBe(stored);
  });

  it.each([
    {
      case: "what it wrote",
      text: writeIdentityMemory({ [GITA]: { ...identity("Gita"), connected: false } }),
      names: ["Gita"],
    },
    { case: "nothing stored", text: null, names: [] },
    { case: "a shape from before", text: '{"env-gita":{"name":7}}', names: [] },
    { case: "not JSON", text: "{", names: [] },
  ])("reads $case", ({ text, names }) => {
    expect(Object.values(readIdentityMemory(text)).map((mate) => mate.name)).toEqual(names);
  });

  // A Mate's own page has only its project, and paints its name and its pose from the first frame.
  it("remembers its project and whether its container was running", () => {
    const awake = { ...identity("Gita"), projectId: "p-gita", running: true };
    const stored = withMateIdentities({}, new Map([[GITA, awake]]));
    expect(stored[GITA]).toMatchObject({ projectId: "p-gita", running: true, connected: false });
    expect(readIdentityMemory(writeIdentityMemory(stored))[GITA]).toMatchObject({
      projectId: "p-gita",
      running: true,
    });
    // Its container stopping since is remembered too.
    const stopped = withMateIdentities(stored, new Map([[GITA, { ...awake, running: false }]]));
    expect(stopped[GITA]?.running).toBe(false);
  });

  // A Mate still arriving opens wearing the pose its menu row wears, not idle until the listing.
  it.each([
    { case: "until when it is arriving", arrivingUntil: 1_700_000_000_000 },
    { case: "nothing once it has arrived", arrivingUntil: undefined },
  ])("remembers $case", ({ arrivingUntil }) => {
    const arriving = {
      ...identity("Gita"),
      ...(arrivingUntil === undefined ? {} : { arrivingUntil }),
    };
    const stored = withMateIdentities({}, new Map([[GITA, arriving]]));
    expect(stored[GITA]?.arrivingUntil).toBe(arrivingUntil);
    expect(readIdentityMemory(writeIdentityMemory(stored))[GITA]?.arrivingUntil).toBe(
      arrivingUntil,
    );
    // Its arrival ending is remembered too.
    if (arrivingUntil === undefined) return;
    const arrived = withMateIdentities(stored, new Map([[GITA, identity("Gita")]]));
    expect(arrived[GITA]?.arrivingUntil).toBeUndefined();
  });

  it.each([
    { case: "the Mate in its project", projectId: "p-pia", found: [PIA, "Pia"] },
    { case: "nothing for a project it never knew", projectId: "p-other", found: undefined },
  ])("finds $case", ({ projectId, found }) => {
    const memory = withMateIdentities(
      {},
      new Map([
        [GITA, { ...identity("Gita"), projectId: "p-gita" }],
        [PIA, { ...identity("Pia"), projectId: "p-pia" }],
      ]),
    );
    const mate = mateOfProject(memory, projectId);
    expect(mate === undefined ? undefined : [mate.environmentId, mate.mate.name]).toEqual(found);
  });
});

// A Mate the directory lacks is forgotten only once the listing is whole for the person looking:
// a member with NO_ACCESS on one project never reads a complete listing, and still forgets a Mate
// deleted since — the home's guess and a Mate's page by its project read this memory.
describe("mateDirectoryWhole: when a Mate the directory lacks has left", () => {
  it.each([
    {
      case: "complete, every environment registered",
      complete: true,
      whole: false,
      ready: true,
      left: true,
    },
    {
      case: "whole for the person, not complete",
      complete: false,
      whole: true,
      ready: true,
      left: true,
    },
    { case: "neither", complete: false, whole: false, ready: true, left: false },
    {
      case: "whole, environments still registering",
      complete: true,
      whole: true,
      ready: false,
      left: false,
    },
  ])("$case: $left", ({ complete, whole, ready, left }) => {
    expect(
      mateDirectoryWhole({
        listingComplete: complete,
        wholeForPerson: whole,
        environmentsReady: ready,
      }),
    ).toBe(left);
  });
});
