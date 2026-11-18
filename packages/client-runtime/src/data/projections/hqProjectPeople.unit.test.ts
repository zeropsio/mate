import { AtomRegistry } from "effect/reactivity";
import { expect, it } from "vite-plus/test";
import { seedHqNavigation } from "../__fixtures__/hqNavigation.ts";
import { seedMembers } from "../__fixtures__/hqProjectPeople.ts";
import { makeAccountStore } from "../store.ts";
import { hqProjectPeople } from "./hqProjectPeople.ts";

// witness: packages/client-runtime/src/data/projections/hqProjectPeople.ts | ownerOf(read, orgId, person?.ownerUserId) → ownerOf(read, orgId, undefined)
it("PJ12: A Mate a person owns names that person as its owner, with their name and picture from the organization's people", () => {
  const registry = AtomRegistry.make();
  const store = makeAccountStore(registry);
  seedHqNavigation(store, "org", {
    mates: {},
    structure: {
      apps: [],
      ungrouped: [{ projectId: "jan-mate", name: "jan-mate", mate: { face: "" } }],
    },
    person: { mine: false, ownerUserId: "u-jan", waitsOnViewer: false, unseen: null },
  });
  seedMembers(store, "org", {
    "u-jan": { name: "Jan Novák", avatarUrl: "https://avatars.example/jan.png" },
  });
  expect(registry.get(store.data.project(hqProjectPeople, "org"))["jan-mate"]?.owner).toEqual({
    userId: "u-jan",
    name: "Jan Novák",
    called: "Jan",
    avatarUrl: "https://avatars.example/jan.png",
  });
  registry.dispose();
});
