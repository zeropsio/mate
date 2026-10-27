// @effect-diagnostics nodeBuiltinImport:off -- reads production source to pin readiness ownership.
import * as NodeFS from "node:fs";
import * as NodeURL from "node:url";
import { expect, it } from "vite-plus/test";

it("Decision: one derivation per state; consumers never recompute it.", () => {
  const root = NodeURL.fileURLToPath(new URL("../apps/web/src/", import.meta.url));
  const owners =
    /\b(?:function|const)\s+(?:mateComing|mateComingPage|arrivalHoldsThrough|arrivalAwaitsAnswer|arrivalLinkHolds|mateArrivalShown|firstBuildState|firstBuildTargets|firstBuildsOf|listingLacksCreation|recoveryNotice)\b/u;
  const callers =
    /import\s+[^;]*\b(?:mateComing|mateComingPage|arrivalHoldsThrough|arrivalAwaitsAnswer|arrivalLinkHolds|mateArrivalShown)\b[^;]*from/u;
  const violations: string[] = [];
  for (const file of NodeFS.readdirSync(root, { recursive: true, encoding: "utf8" })) {
    if (!/\.tsx?$/u.test(file) || /\.(?:test|scenario)\.tsx?$/u.test(file)) continue;
    const source = NodeFS.readFileSync(`${root}${file}`, "utf8");
    if (owners.test(source) || callers.test(source)) violations.push(file);
  }
  expect(violations).toEqual([]);
});
