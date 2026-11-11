import { describe, expect, it } from "vite-plus/test";
import { CanonicalHqNavigationApp } from "@t3tools/shared/hqStream";
import * as Schema from "effect/Schema";

import { hqAppFamily, hqOrganizationFamily } from "./hqNavigation.ts";

const app = {
  id: "shop",
  name: "Shop",
  contents: { empty: false, deletingProjectIds: [] },
  environments: [],
  changes: [],
  releaseOffer: null,
  projectIds: ["ada"],
  births: [],
};
const readApp = Schema.decodeUnknownSync(CanonicalHqNavigationApp);

// HQ emits these fields from its birth view (structure/read.go).
const birth = {
  id: "birth-ada",
  face: "ada",
  madeBy: "owner",
  intent: { recipe: { revision: "abc" }, agents: ["one"] },
  attempts: {},
  projectId: "ada",
};

it("keeps an adopted birth's identity so its existing project is protected", () => {
  const adopted = { ...birth, adopted: true };
  expect(
    hqAppFamily.hq!.decode(readApp({ ...app, births: [adopted] }), "app:shop")?.births,
  ).toEqual([adopted]);
});

it("a fresh observer retains the accepted import identity from an HQ birth without a press", () => {
  const imported = { ...birth, importProcessId: "accepted-import" };
  expect(
    hqAppFamily.hq!.decode(readApp({ ...app, births: [imported] }), "app:shop")?.births,
  ).toEqual([imported]);
});

it("explicit empty environments replace the known rows", () => {
  const held = hqAppFamily.hq!.decode(
    readApp({
      ...app,
      environments: [
        {
          id: "prod",
          target: { kind: "zerops", projectId: "prod" },
          tier: "production",
          name: "production",
          sources: ["release"],
          order: 1,
          keyHeld: true,
          keyInvalid: false,
          jobs: [],
          release: null,
          birth: null,
        },
      ],
    }),
    "app:shop",
  )!;
  expect(held.environments).toHaveLength(1);
  const row = hqAppFamily.hq!.decode(readApp(app), "app:shop")!;
  expect(hqAppFamily.keepUnsaid?.(held, row, "listing") ?? row).toEqual(row);
});

describe("the organization's record, as its reader reads it", () => {
  const organization = { build: "0.15.80" };
  const record = { build: "0.15.80" };
  const decode = (raw: unknown) =>
    hqOrganizationFamily.hq!.decode(raw, "org", { orgId: "org", ownerId: null });
  it.each([
    {
      sentence: "It keeps when its reader first signed in to HQ, and whether they set HQ up",
      viewer: { firstSignedInAt: "2026-10-16T08:00:00Z", founder: false },
      read: { firstSignedInAt: "2026-10-16T08:00:00Z", founder: false },
    },
  ])("$sentence", ({ viewer, read }) => {
    expect(decode(viewer === undefined ? organization : { ...organization, viewer })).toEqual(
      read === undefined ? record : { ...record, viewer: read },
    );
  });
});
