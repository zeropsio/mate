import { EnvironmentId } from "@t3tools/contracts";
import { AtomRegistry } from "effect/unstable/reactivity";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { seedHqNavigation } from "../__fixtures__/hqNavigation.ts";
import { placementsScope } from "../families/hqNavigation.ts";
import { makeAccountStore } from "../store.ts";
import { hqMateIdentities } from "./hqMateIdentity.ts";

const ORG = "orchard";
const ENV = EnvironmentId.make("env-quill");
function makeFixture() {
  const registry = AtomRegistry.make();
  const store = makeAccountStore(registry);
  return { registry, store, identities: store.data.project(hqMateIdentities, ORG) };
}
let fixture: ReturnType<typeof makeFixture>;
beforeEach(() => {
  fixture = makeFixture();
});
const seed = (name = "Orchard - Quill", face = "sky:seal") =>
  ({
    structure: {
      apps: [
        {
          id: "app",
          name: "Orchard",
          projects: [
            {
              projectId: "quill",
              name,
              kind: "mate",
              mate: { face, madeBy: "maker", standupRequestedBy: "asker" },
            },
          ],
        },
      ],
      ungrouped: [],
    },
    mates: {
      quill: {
        presence: { online: true, since: "2026-10-07T00:00:00Z", overview: "live" },
        identity: {
          environmentId: ENV,
          serverVersion: "0.14.43",
          update: null,
          runsWithoutSignIn: true,
        },
      },
    },
  }) as const;

afterEach(() => {
  fixture.store.close();
  fixture.registry.dispose();
});

describe("HQ's Mate identity", () => {
  it("names the Mate, its picked face, project and makers from HQ alone", () => {
    seedHqNavigation(fixture.store, ORG, seed());
    expect(fixture.registry.get(fixture.identities).quill).toMatchObject({
      name: "Quill",
      environmentId: ENV,
      projectId: "quill",
      project: "Orchard",
      tint: "sky",
      shape: "seal",
      madeBy: "maker",
      standUp: { by: "asker" },
      runsWithoutSignIn: true,
      projectUrl: "https://app.zerops.io/project/quill",
    });
  });

  it("renames and changes the face everywhere HQ names the Mate", () => {
    seedHqNavigation(fixture.store, ORG, seed());
    expect(fixture.registry.get(fixture.identities).quill?.name).toBe("Quill");
    seedHqNavigation(fixture.store, ORG, seed("Orchard - Nova", "rose:gem"));
    expect(fixture.registry.get(fixture.identities).quill).toMatchObject({
      name: "Nova",
      tint: "rose",
      shape: "gem",
    });
  });

  it("retains the name through HQ recovery without claiming the tab is connected", () => {
    seedHqNavigation(fixture.store, ORG, seed());
    const held = fixture.registry.get(fixture.identities);
    seedHqNavigation(fixture.store, ORG, { ...seed(), live: false });
    expect(fixture.registry.get(fixture.identities)).toBe(held);
    expect(held.quill).not.toHaveProperty("connected");
  });

  it("forgets a Mate when HQ removes its placement", () => {
    seedHqNavigation(fixture.store, ORG, seed());
    expect(fixture.registry.get(fixture.identities).quill?.environmentId).toBe(ENV);
    const scope = placementsScope(ORG);
    fixture.store.dispatch({
      kind: "hq-delivery",
      scopes: [{ scope, generation: fixture.store.state().streams.get(scope)?.generation ?? 0 }],
      reset: false,
      rows: [],
      removals: [{ family: "placement", id: "quill", reason: "deleted" }],
    });
    expect(fixture.registry.get(fixture.identities)).toEqual({});
  });

  it("leaves an environment unknown when HQ has not sent its identity", () => {
    const { mates: _mates, ...navigation } = seed();
    seedHqNavigation(fixture.store, ORG, navigation);
    expect(fixture.registry.get(fixture.identities).quill?.environmentId).toBeUndefined();
    expect(fixture.registry.get(fixture.identities).quill?.name).toBe("Quill");
  });
});
