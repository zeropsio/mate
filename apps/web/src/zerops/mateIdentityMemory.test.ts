import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { readIdentityMemory, withMateIdentities, writeIdentityMemory } from "./mateIdentityMemory";
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
});
