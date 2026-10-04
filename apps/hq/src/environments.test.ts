import { assert, describe, it } from "@effect/vitest";

import { environmentNameProblem, deriveEnvironmentName } from "./environments.ts";

describe("deriveEnvironmentName", () => {
  // Main's rule (D10): the name a person gave the project, made what a branch and a deploy ask it
  // by — lower-case letters, digits and dashes; the tier when nothing usable is left.
  it.each([
    { given: "Acme CRM - stage", tier: "stage", name: "acme-crm-stage" },
    { given: "Čeština a Škoda", tier: "production", name: "cestina-a-skoda" },
    { given: "123 Shop!", tier: "stage", name: "shop" },
    { given: "Shop --", tier: "stage", name: "shop" },
    { given: "!!! 42", tier: "production", name: "production" },
    { given: "", tier: "stage", name: "stage" },
  ] as const)("names $given as $name", ({ given, tier, name }) => {
    assert.strictEqual(deriveEnvironmentName(given, tier, []), name);
  });

  it("numbers a name taken already, from -2", () => {
    assert.strictEqual(deriveEnvironmentName("Shop", "stage", ["shop"]), "shop-2");
    assert.strictEqual(deriveEnvironmentName("Shop", "stage", ["shop", "shop-2"]), "shop-3");
  });

  // At most 63 characters, as an environment's own name (`environmentNameProblem`).
  it("cuts a long project's name to 63 characters, and numbers it within them", () => {
    const long = `${"a".repeat(70)} shop`;
    const name = deriveEnvironmentName(long, "stage", []);
    assert.strictEqual(name, "a".repeat(63));
    const next = deriveEnvironmentName(long, "stage", [name ?? ""]);
    assert.strictEqual(next, `${"a".repeat(61)}-2`);
    assert.strictEqual(
      deriveEnvironmentName(`${"a".repeat(62)}-shop`, "stage", []),
      "a".repeat(62),
    );
  });

  it("has no name to give past -999", () => {
    const taken = ["shop", ...Array.from({ length: 998 }, (_, i) => `shop-${String(i + 2)}`)];
    assert.strictEqual(deriveEnvironmentName("Shop", "stage", taken), undefined);
  });
});

describe("environmentNameProblem", () => {
  // Main's write refusals (D11), as HQ's reasons.
  it.each([
    { name: "", problem: "environment_name_missing" },
    { name: "   ", problem: "environment_name_missing" },
    { name: "Shop", problem: "environment_name_invalid" },
    { name: "2shop", problem: "environment_name_invalid" },
    { name: "shop stage", problem: "environment_name_invalid" },
    { name: "shop-stage-2", problem: undefined },
    // A deploy key is named `mate-hq-deploy:<env>:<projectId>`, and Zerops caps a token's name at 255.
    { name: `s${"a".repeat(62)}`, problem: undefined },
    { name: `s${"a".repeat(63)}`, problem: "environment_name_long" },
  ] as const)("says $problem of '$name'", ({ name, problem }) => {
    assert.strictEqual(environmentNameProblem(name), problem);
  });
});
