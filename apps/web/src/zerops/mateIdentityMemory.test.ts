import type { HqMateIdentity } from "@t3tools/client-runtime/data";
import type { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  readMateMemory,
  rememberMates,
  seededIdentities,
  writeMateMemory,
  type MateMemory,
} from "./mateIdentityMemory";

const identity = (environmentId: string, name: string): HqMateIdentity => ({
  projectId: `project-${environmentId}`,
  environmentId: environmentId as EnvironmentId,
  fullName: name,
  name,
  tint: "sky",
  shape: "hexagon",
  project: undefined,
  projectUrl: `https://app.zerops.io/project/project-${environmentId}`,
});

/** A browser's storage: one key per value, as localStorage keeps them. */
function storage() {
  const held = new Map<string, string>();
  return {
    getItem: (key: string) => held.get(key) ?? null,
    setItem: (key: string, value: string) => void held.set(key, value),
  };
}

const namesOf = (identities: ReadonlyArray<HqMateIdentity>) =>
  identities.map((one) => `${one.environmentId}:${one.name}`);

describe("the Mates' names a reload remembers", () => {
  it("a reload paints the Mate's name from the last visit before HQ answers", () => {
    const browser = storage();
    // The last visit: HQ named Milo.
    writeMateMemory(rememberMates({}, [identity("env-milo", "Milo")], true), browser);
    // The reload: HQ has not answered yet.
    const remembered = readMateMemory(browser);
    expect(namesOf(seededIdentities([], remembered, false))).toEqual(["env-milo:Milo"]);
  });

  it.each<{
    readonly name: string;
    readonly memory: MateMemory;
    readonly hq: ReadonlyArray<HqMateIdentity>;
    readonly read: boolean;
    readonly shows: ReadonlyArray<string>;
    readonly remembers: ReadonlyArray<string>;
  }>([
    {
      name: "HQ's answer replaces a remembered name that changed",
      memory: { "env-milo": identity("env-milo", "Milo") },
      hq: [identity("env-milo", "Mila")],
      read: true,
      shows: ["env-milo:Mila"],
      remembers: ["env-milo:Mila"],
    },
    {
      name: "a Mate HQ names before its list is whole stands beside the remembered others",
      memory: {
        "env-milo": identity("env-milo", "Milo"),
        "env-rhea": identity("env-rhea", "Rhea"),
      },
      hq: [identity("env-milo", "Mila")],
      read: false,
      shows: ["env-milo:Mila", "env-rhea:Rhea"],
      remembers: ["env-milo:Mila", "env-rhea:Rhea"],
    },
    {
      name: "a Mate HQ no longer lists is forgotten once its list is read",
      memory: {
        "env-milo": identity("env-milo", "Milo"),
        "env-gone": identity("env-gone", "Gone"),
      },
      hq: [identity("env-milo", "Milo")],
      read: true,
      shows: ["env-milo:Milo"],
      remembers: ["env-milo:Milo"],
    },
  ])("$name", ({ memory, hq, read, shows, remembers }) => {
    expect(namesOf(seededIdentities(hq, memory, read))).toEqual(shows);
    expect(namesOf(Object.values(rememberMates(memory, hq, read)))).toEqual(remembers);
  });

  it.each([
    { name: "missing", browser: undefined },
    {
      name: "blocked",
      browser: {
        getItem: () => {
          throw new Error("SecurityError");
        },
      },
    },
    { name: "unreadable", browser: { getItem: () => "{not json" } },
    { name: "empty", browser: { getItem: () => null } },
  ])("remembers nothing when storage is $name", ({ browser }) => {
    expect(seededIdentities([], readMateMemory(browser), false)).toEqual([]);
  });

  it("keeps the same memory when HQ says nothing new, so it is not written again", () => {
    const memory = rememberMates({}, [identity("env-milo", "Milo")], true);
    expect(rememberMates(memory, [identity("env-milo", "Milo")], true)).toBe(memory);
  });
});
