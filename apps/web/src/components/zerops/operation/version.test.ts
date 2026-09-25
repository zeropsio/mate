import { describe, expect, it } from "vite-plus/test";

import type { ZeropsOperation } from "@t3tools/client-runtime/zerops/model";

import { versionLabel } from "./version";

describe("versionLabel — what a settled card names as the version it shipped", () => {
  it.each<{
    readonly name: string;
    readonly version: ZeropsOperation["version"];
    readonly label: string | undefined;
  }>([
    { name: "no version", version: undefined, label: undefined },
    { name: "an empty version", version: {}, label: undefined },
    {
      name: "a full commit sha is shortened to 7",
      version: { id: "av-1", name: "3f2a9c1d8e7b6a5f4e3d2c1b0a9f8e7d6c5b4a39" },
      label: "3f2a9c1",
    },
    {
      name: "a name that is not a full sha is kept whole",
      version: { id: "av-1", name: "release-42" },
      label: "release-42",
    },
    {
      name: "a short sha is kept whole",
      version: { name: "abc123" },
      label: "abc123",
    },
    {
      name: "without a name, the platform's appVersion id",
      version: { id: "Xk3vQp9aRr2" },
      label: "Xk3vQp9aRr2",
    },
  ])("$name", ({ version, label }) => {
    expect(versionLabel(version)).toBe(label);
  });
});
