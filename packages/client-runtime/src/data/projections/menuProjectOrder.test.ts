import { describe, expect, it } from "vite-plus/test";
import { AtomRegistry } from "effect/reactivity";
import { makeAccountStore } from "../store.ts";
import { seedHqNavigation } from "../__fixtures__/hqNavigation.ts";
import { ThreadId, TurnId } from "@t3tools/contracts";
import { attention } from "../__fixtures__/mateAttention.ts";
import {
  activeMenuProject,
  menuWorkRead,
  menuProjectOpening,
  type MenuProjectRecord,
} from "./menuProjectOrder.ts";

const now = Date.parse("2026-10-09T12:00:00Z");
const old = "2026-09-01T12:00:00Z";
const recent = "2026-10-09T12:00:00.000Z";
const project = (id: string, at = old): MenuProjectRecord => ({
  id,
  mates: [{ projectId: id, face: "idle", activity: { kind: "idle", at, hasWork: true } }],
});
const input = (
  projects: ReadonlyArray<MenuProjectRecord>,
  order = "name",
  scope = "account/org",
) => ({ ready: true, scope, open: true, order, projects, now, openProjectId: undefined });

describe("menu project opening projection", () => {
  it("A read baseline with no conversation settles the opening; unread work scopes do not", () => {
    const registry = AtomRegistry.make();
    const store = makeAccountStore(registry);
    const structure = {
      apps: [],
      ungrouped: [{ projectId: "mate", name: "Mate", mate: { face: "" } }],
    };
    seedHqNavigation(store, "org", { structure });
    const read = store.data.project(menuWorkRead, "org");
    expect(registry.get(read)).toBe(false);
    seedHqNavigation(store, "org", {
      structure,
      mates: { mate: { presence: { online: false, since: old, overview: "none" } } },
    });
    expect(registry.get(read)).toBe(true);
    registry.dispose();
  });

  it("HQ's finished results and current background work count even when the main chat has no activity", () => {
    const value = attention("run", 1);
    const record = (live: boolean, working: number, completedAt?: string): MenuProjectRecord => ({
      id: "app",
      mates: [
        {
          projectId: "mate",
          face: "idle",
          attention: {
            live,
            unseen: 1,
            attention: {
              ...value,
              working,
              results:
                completedAt === undefined
                  ? []
                  : [
                      {
                        threadId: ThreadId.make("background"),
                        turnId: TurnId.make("turn"),
                        completedAt,
                      },
                    ],
            },
          },
        },
      ],
    });
    expect(activeMenuProject(record(false, 0, recent), now, undefined)).toBe(true);
    expect(activeMenuProject(record(true, 1), now, undefined)).toBe(true);
    expect(activeMenuProject(record(false, 1, old), now, undefined)).toBe(false);
    expect(activeMenuProject(record(false, 0, "invalid"), now, undefined)).toBe(false);
  });

  it("The open conversation and a waiting review keep their project Active without recent work", () => {
    expect(activeMenuProject(project("open"), now, "open")).toBe(true);
    expect(
      activeMenuProject(
        { id: "app", mates: [{ projectId: "review", face: "needs" }] },
        now,
        undefined,
      ),
    ).toBe(true);
    expect(activeMenuProject(project("limited"), now, undefined)).toBe(false);
  });

  it("Choosing Order changes order within each frozen section without reclassifying work", () => {
    const first = menuProjectOpening(
      null,
      input([project("a"), project("b", recent), project("c", recent), project("d")]),
    );
    const reordered = menuProjectOpening(
      first,
      input([project("d", recent), project("c"), project("b"), project("a", recent)], "custom"),
    );
    expect(reordered.active).toEqual(["c", "b"]);
    expect(reordered.other).toEqual(["d", "a"]);
    const regrouped = menuProjectOpening(
      { ...reordered, open: false },
      input([project("d", recent), project("c"), project("b"), project("a", recent)], "custom"),
    );
    expect(regrouped.active).toEqual(["d", "a"]);
    expect(regrouped.other).toEqual(["c", "b"]);
  });

  it("An organization switch refreshes sections and background renames leave their order alone", () => {
    const first = menuProjectOpening(null, input([project("a"), project("b")]));
    const updates = input([project("b", recent), project("a")]);
    expect(menuProjectOpening(first, updates).other).toEqual(["a", "b"]);
    const switched = menuProjectOpening(first, { ...updates, scope: "account/another-org" });
    expect(switched.active).toEqual(["b"]);
    expect(switched.other).toEqual(["a"]);
  });
});
