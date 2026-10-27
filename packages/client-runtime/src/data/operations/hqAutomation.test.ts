import { describe, expect, it } from "vite-plus/test";
import { AtomRegistry } from "effect/reactivity";
import { seedHqNavigation } from "../__fixtures__/hqNavigation.ts";
import { makeAccountStore, readsOfState } from "../store.ts";
import { setIntake } from "./hqAutomation.ts";

const receipt = {} as never;

describe("an intake set, as HQ's navigation shows it", () => {
  // HQ keeps a repository's name as GitHub matches it, in lower case: a lost answer is found
  // whatever case the person's choice was written in.
  it.each([
    { case: "the same name", held: "acme/tea-shop", shows: true },
    { case: "the name in another case", held: "Acme/Tea-Shop", shows: true },
    { case: "another repository", held: "acme/notes", shows: false },
  ])("finds an intake set on $case", ({ held, shows }) => {
    const store = makeAccountStore(AtomRegistry.make());
    seedHqNavigation(store, "org", {
      structure: {
        apps: [
          {
            id: "shop",
            name: "Tea Shop",
            projects: [],
            intake: { repo: held.toLowerCase(), label: "mate", waiting: 0 },
          },
        ],
        ungrouped: [],
      },
    });
    const intent = {
      kind: "set-intake",
      orgId: "org",
      appId: "shop",
      repo: held === "acme/notes" ? "acme/tea-shop" : held,
      label: "mate",
    } as const;
    expect(setIntake.reflected?.(readsOfState(store.state()), intent, receipt)).toBe(shows);
  });
});
