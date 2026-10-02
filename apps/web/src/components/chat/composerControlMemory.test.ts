import { ProviderDriverKind } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  composerControlKey,
  readComposerControls,
  shownComposerControl,
  withComposerControl,
  type ComposerControlLook,
} from "./composerControlMemory";

const opus: ComposerControlLook = {
  driverKind: ProviderDriverKind.make("claudeAgent"),
  displayName: "Claude",
  label: { model: "Opus 5.5", traits: ["Medium"], fast: false },
};

describe("the composer's control, as it last looked", () => {
  const key = composerControlKey("claude", "claude-opus-5-5");

  it.each([
    {
      name: "read: what the catalog says",
      resolved: opus,
      pending: false,
      remembered: undefined,
      shown: opus,
    },
    {
      name: "read: the catalog's word over the memory's",
      resolved: opus,
      pending: false,
      remembered: { ...opus, label: { ...opus.label, traits: ["High"] } },
      shown: opus,
    },
    {
      name: "the catalog on its way: as it looked last time",
      resolved: null,
      pending: true,
      remembered: opus,
      shown: opus,
    },
    {
      name: "the catalog on its way, never seen: the raw selection",
      resolved: null,
      pending: true,
      remembered: undefined,
      shown: null,
    },
    {
      name: "read, with no model to say: nothing remembered stands in",
      resolved: null,
      pending: false,
      remembered: opus,
      shown: null,
    },
  ])("$name", ({ resolved, pending, remembered, shown }) => {
    expect(shownComposerControl({ resolved, pending, remembered })).toEqual(shown);
  });

  it("keeps what it remembers across a reload, and drops the oldest past its room", () => {
    let memory = readComposerControls(null);
    memory = withComposerControl(memory, key, opus);
    const reread = readComposerControls(JSON.stringify(memory));
    expect(reread[key]).toEqual(opus);

    for (let index = 0; index < 30; index += 1) {
      memory = withComposerControl(memory, composerControlKey("claude", `model-${index}`), opus);
    }
    for (let index = 30; index < 60; index += 1) {
      memory = withComposerControl(memory, composerControlKey("claude", `model-${index}`), opus);
    }
    expect(Object.keys(memory)).toHaveLength(48);
    expect(memory[key]).toBeUndefined();
  });

  it("remembers nothing from a stored shape it cannot read", () => {
    expect(readComposerControls("not json")).toEqual({});
    expect(readComposerControls(JSON.stringify({ [key]: { label: "Opus" } }))).toEqual({});
  });
});
