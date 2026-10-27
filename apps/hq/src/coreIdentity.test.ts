// @effect-diagnostics-next-line nodeBuiltinImport:off -- Node's hash is the test's independent oracle for the digest.
import * as NodeCrypto from "node:crypto";

import { describe, expect, it } from "@effect/vitest";

import { CORE_BUILD_PLACEHOLDER, coreIdentity, stampBundle } from "./coreIdentity.ts";

const BUNDLE = 'console.log("__HQ_BUILD__");\n';
const YAML = "zerops:\n  - setup: hq\n";

describe("coreIdentity", () => {
  it("is the commit time and the first 12 hex of sha256 over the bundle, then zerops.yml", () => {
    const digest = NodeCrypto.createHash("sha256")
      .update(BUNDLE)
      .update(YAML)
      .digest("hex")
      .slice(0, 12);
    expect(
      coreIdentity({ committedAt: "20261004T101500Z", bundle: BUNDLE, zeropsYaml: YAML }),
    ).toBe(`20261004T101500Z.${digest}`);
  });
});

describe("stampBundle", () => {
  const stamp = JSON.stringify(CORE_BUILD_PLACEHOLDER);
  it.each([
    {
      name: "one stamp",
      bundle: `const b = ${stamp};`,
      stamped: 'const b = "20261004T101500Z.abc";',
    },
    { name: "no stamp", bundle: "const b = 1;", stamped: undefined },
    { name: "two stamps", bundle: `${stamp};${stamp};`, stamped: undefined },
  ])("$name", ({ bundle, stamped }) => {
    if (stamped === undefined) {
      expect(() => stampBundle(bundle, "20261004T101500Z.abc")).toThrow(/stamp/u);
    } else {
      expect(stampBundle(bundle, "20261004T101500Z.abc")).toBe(stamped);
    }
  });
});
