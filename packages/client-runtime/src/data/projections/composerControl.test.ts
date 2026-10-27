import { ProviderDriverKind } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import { composerControl, type ComposerControlLook } from "./composerControl.ts";
const current: ComposerControlLook = {
  driverKind: ProviderDriverKind.make("claudeAgent"),
  displayName: "Claude",
  label: { model: "Opus", traits: ["High"], fast: false },
};
describe("composer catalog evidence", () => {
  it("a cold catalog reserves unknown space instead of recalling a label", () => {
    expect(composerControl({ resolved: null, pending: true })).toEqual({ kind: "unknown" });
  });
  it("known current evidence stays visible through an outage", () => {
    expect(composerControl({ resolved: current, pending: true })).toEqual({
      kind: "known",
      look: current,
    });
  });
  it("a read catalog with no selection supplies no previous display name", () => {
    expect(composerControl({ resolved: null, pending: false })).toEqual({ kind: "unselected" });
  });
});
