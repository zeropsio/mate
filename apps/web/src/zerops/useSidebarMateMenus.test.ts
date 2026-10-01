import { describe, expect, it } from "vite-plus/test";

import type { ZeropsMenuEntry } from "~/components/zerops/ZeropsProjectMenu";

import { sidebarMateVerbs } from "./useSidebarMateMenus";

const entry = (id: string, label: string): ZeropsMenuEntry => ({ id, label, onSelect: () => {} });

describe("sidebarMateVerbs — the shared verbs a Mate's own menu carries", () => {
  it("keeps start or restart, Finish setup, hand over and move, in the menu's own words", () => {
    const verbs = sidebarMateVerbs([
      entry("restart", "Restart"),
      { id: "quick", separator: true },
      entry("rename-agent", "Rename Mate"),
      entry("face", "Change face…"),
      entry("finish-setup", "Finish setup"),
      entry("assign", "Hand this Mate over"),
      entry("move", "Change project or role"),
      entry("leave", "Leave the project"),
      { id: "version", separator: true },
      entry("server-version", "Server 0.11.53"),
    ]);
    expect(verbs.map((verb) => ("label" in verb ? verb.label : "—"))).toEqual([
      "Restart",
      // Without it a half-made Mate had no way to be finished from the left menu (2026-10-01).
      "Finish setup",
      "Hand over…",
      "Move to project…",
    ]);
  });

  it("keeps Delete, in its own words and its red", () => {
    const verbs = sidebarMateVerbs([
      entry("restart", "Restart"),
      { id: "version", separator: true },
      { id: "delete", label: "Delete Quinn…", variant: "destructive", onSelect: () => {} },
    ]);
    expect(verbs.map((verb) => verb.id)).toEqual(["restart", "delete"]);
    expect(verbs[1]).toMatchObject({ label: "Delete Quinn…", variant: "destructive" });
  });

  it("leaves Change face… to the menu's own place for it, beside Rename", () => {
    expect(sidebarMateVerbs([entry("face", "Change face…")])).toEqual([]);
  });

  it("keeps Start in place of Restart where the Mate is stopped", () => {
    expect(sidebarMateVerbs([entry("start", "Start")]).map((verb) => verb.id)).toEqual(["start"]);
  });
});
