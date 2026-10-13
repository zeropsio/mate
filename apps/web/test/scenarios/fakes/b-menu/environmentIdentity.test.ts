import { expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";
import {
  CanonicalHqNavigationEnvironments,
  HqNavigationEnvironments,
} from "@t3tools/shared/hqStream";
import { environmentIdentityWire } from "./environmentIdentity.ts";

const decodeLegacy = Schema.decodeUnknownSync(HqNavigationEnvironments);
const decodeCanonical = Schema.decodeUnknownSync(CanonicalHqNavigationEnvironments);

const row = {
  id: "stage",
  target: { kind: "zerops", projectId: "stage" },
  projectId: "stage",
  tier: "stage",
  name: "preview",
  sources: ["main"],
  order: 2,
  keyHeld: true,
  keyInvalid: false,
  can: {},
  jobs: [],
  release: null,
  birth: null,
};
const frame = (environments: unknown, kind = "navigation") =>
  JSON.stringify({
    type: "scope-reset",
    scope: { kind, appId: "shop" },
    values: [{ key: "app:shop", value: { environments } }],
  });
const rows = (encoded: string): unknown =>
  (JSON.parse(encoded) as { values: { value: { environments: unknown } }[] }).values[0]!.value
    .environments;

it.each(["navigation", "app-detail"])("old HQ %s removes only additive identity fields", (kind) => {
  expect(rows(environmentIdentityWire("legacy").map(frame([row], kind)))).toEqual([
    Object.fromEntries(Object.entries(row).filter(([key]) => key !== "id" && key !== "target")),
  ]);
});

it("legacy and canonical readers agree on all existing Zerops values", () => {
  const input = rows(environmentIdentityWire("legacy").map(frame([row])));
  expect(decodeLegacy(input)).toEqual([
    Object.fromEntries(Object.entries(row).filter(([key]) => key !== "id" && key !== "target")),
  ]);
  expect(decodeCanonical(input)).toEqual([row]);
  expect(decodeLegacy([row])).toEqual(decodeLegacy(input));
});

it("a half-modern row refuses the whole list instead of becoming a legacy row", () => {
  const input = rows(environmentIdentityWire("partial").map(frame([row])));
  expect(() => decodeCanonical(input)).toThrow();
});

it("mixed targets and unequal ids preserve order, jobs and legacy project addresses", () => {
  const wire = environmentIdentityWire("modern", {
    stage: { id: "independent", target: { kind: "zerops", projectId: "stage" } },
    prod: { id: "git-production", target: { kind: "git", branch: "release", delivery: "direct" } },
  });
  const input = rows(wire.map(frame([row, { ...row, id: "prod", projectId: "prod", order: 7 }])));
  expect(decodeCanonical(input)).toEqual([
    { ...row, id: "independent" },
    {
      ...row,
      id: "git-production",
      projectId: "prod",
      order: 7,
      target: { kind: "git", branch: "release", delivery: "direct" },
    },
  ]);
});
