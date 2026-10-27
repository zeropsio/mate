// @effect-diagnostics nodeBuiltinImport:off - This host-side test checks platform paths only.
import * as NodePath from "node:path";

import { assert, it } from "@effect/vitest";
import { SHOWCASE_SCENE_IDS } from "@t3tools/shared/showcaseScenes";

// @ts-expect-error The preload is intentionally plain JavaScript for Electron's renderer.
import { matchesRequestedAppearance } from "./web-showcase-preload.mjs";
import {
  buildElectronCaptureArgs,
  buildShowcaseDeepLinkUrl,
  buildShowcasePairUrl,
  parseWebShowcaseCliArgs,
  planWebShowcaseCaptures,
  planWebShowcaseNavigation,
} from "./web-showcase.ts";

it("matches the requested stored and resolved appearance", () => {
  assert.equal(
    matchesRequestedAppearance(
      { appearance: "dark", followSystem: "false", resolvedAppearance: "dark" },
      "dark",
    ),
    true,
  );
  assert.equal(
    matchesRequestedAppearance(
      { appearance: "dark", followSystem: "true", resolvedAppearance: "dark" },
      "dark",
    ),
    false,
  );
  assert.equal(
    matchesRequestedAppearance(
      { appearance: "light", followSystem: "false", resolvedAppearance: "dark" },
      "dark",
    ),
    false,
  );
  assert.equal(
    matchesRequestedAppearance(
      { appearance: "dark", followSystem: "false", resolvedAppearance: "light" },
      "dark",
    ),
    false,
  );
});

it("parses scene, viewport, appearance, output, and build options", () => {
  const options = parseWebShowcaseCliArgs([
    "--scene",
    "web:cards",
    "--viewport",
    "mobile",
    "--appearance",
    "dark",
    "--out",
    "tmp/captures",
    "--skip-build",
  ]);

  assert.deepStrictEqual(options.sceneIds, ["web:cards"]);
  assert.deepStrictEqual(options.viewports, ["mobile"]);
  assert.deepStrictEqual(options.appearances, ["dark"]);
  assert.equal(options.outputDirectory, "tmp/captures");
  assert.equal(options.skipBuild, true);
});

it("defaults every capture axis to all", () => {
  const options = parseWebShowcaseCliArgs([]);
  assert.deepStrictEqual(options.sceneIds, [...SHOWCASE_SCENE_IDS]);
  assert.deepStrictEqual(options.viewports, ["desktop", "mobile"]);
  assert.deepStrictEqual(options.appearances, ["light", "dark"]);
  assert.equal(options.outputDirectory, "artifacts/web-showcase");
  assert.equal(options.skipBuild, false);
});

it("rejects unknown capture values", () => {
  let unknownSceneError: unknown;
  try {
    parseWebShowcaseCliArgs(["--scene", "web:missing"]);
  } catch (error) {
    unknownSceneError = error;
  }
  assert(unknownSceneError instanceof Error);
  assert.equal(
    unknownSceneError.message,
    `Unknown showcase scene 'web:missing'. Valid scene IDs: ${SHOWCASE_SCENE_IDS.join(", ")}.`,
  );
  assert.throws(() => parseWebShowcaseCliArgs(["--viewport", "tablet"]), /Unsupported viewport/u);
  assert.throws(
    () => parseWebShowcaseCliArgs(["--appearance", "sepia"]),
    /Unsupported appearance/u,
  );
});

it("enumerates scene, viewport, and appearance captures with stable names", () => {
  const captures = planWebShowcaseCaptures({
    sceneIds: ["web:cards", "web:no-zerops"],
    viewports: ["desktop", "mobile"],
    appearances: ["light", "dark"],
    outputDirectory: "/captures",
    skipBuild: true,
  });

  assert.equal(captures.length, 8);
  assert.deepStrictEqual(
    captures.map(({ sceneId, viewport, appearance, width, height, outputPath }) => ({
      sceneId,
      viewport,
      appearance,
      width,
      height,
      outputPath,
    })),
    [
      {
        sceneId: "web:cards",
        viewport: "desktop",
        appearance: "light",
        width: 1440,
        height: 900,
        outputPath: NodePath.join("/captures", "cards", "desktop-light.png"),
      },
      {
        sceneId: "web:cards",
        viewport: "desktop",
        appearance: "dark",
        width: 1440,
        height: 900,
        outputPath: NodePath.join("/captures", "cards", "desktop-dark.png"),
      },
      {
        sceneId: "web:cards",
        viewport: "mobile",
        appearance: "light",
        width: 390,
        height: 844,
        outputPath: NodePath.join("/captures", "cards", "mobile-light.png"),
      },
      {
        sceneId: "web:cards",
        viewport: "mobile",
        appearance: "dark",
        width: 390,
        height: 844,
        outputPath: NodePath.join("/captures", "cards", "mobile-dark.png"),
      },
      {
        sceneId: "web:no-zerops",
        viewport: "desktop",
        appearance: "light",
        width: 1440,
        height: 900,
        outputPath: NodePath.join("/captures", "no-zerops", "desktop-light.png"),
      },
      {
        sceneId: "web:no-zerops",
        viewport: "desktop",
        appearance: "dark",
        width: 1440,
        height: 900,
        outputPath: NodePath.join("/captures", "no-zerops", "desktop-dark.png"),
      },
      {
        sceneId: "web:no-zerops",
        viewport: "mobile",
        appearance: "light",
        width: 390,
        height: 844,
        outputPath: NodePath.join("/captures", "no-zerops", "mobile-light.png"),
      },
      {
        sceneId: "web:no-zerops",
        viewport: "mobile",
        appearance: "dark",
        width: 390,
        height: 844,
        outputPath: NodePath.join("/captures", "no-zerops", "mobile-dark.png"),
      },
    ],
  );
});

it("builds the pair URL with the credential in the hash", () => {
  const url = new URL(buildShowcasePairUrl("127.0.0.1", 6420, "PAIR +/=?"));
  assert.equal(url.origin, "http://127.0.0.1:6420");
  assert.equal(url.pathname, "/pair");
  assert.equal(url.search, "");
  assert.equal(new URLSearchParams(url.hash.slice(1)).get("token"), "PAIR +/=?");
});

it("builds an encoded deep link without carrying the pairing token", () => {
  const url = new URL(
    buildShowcaseDeepLinkUrl("127.0.0.1", 6420, "environment / one", "thread ? one"),
  );
  assert.equal(url.pathname, "/environment%20%2F%20one/thread%20%3F%20one");
  assert.equal(url.search, "");
  assert.equal(url.hash, "");
});

it("redeems the browser session before navigating to the showcase deep link", () => {
  assert.deepStrictEqual(
    planWebShowcaseNavigation({
      pairUrl: "http://127.0.0.1:6420/pair#token=PAIR",
      deepLinkUrl: "http://127.0.0.1:6420/environment/thread",
    }),
    [
      {
        kind: "redeem-browser-session",
        url: "http://127.0.0.1:6420/pair#token=PAIR",
        method: "POST",
        pathname: "/api/auth/browser-session",
      },
      { kind: "navigate", url: "http://127.0.0.1:6420/environment/thread" },
    ],
  );
});

it("builds the Electron capture process arguments", () => {
  const navigation = planWebShowcaseNavigation({
    pairUrl: "http://127.0.0.1:6420/pair#token=PAIR",
    deepLinkUrl: "http://127.0.0.1:6420/environment/thread",
  });
  assert.deepStrictEqual(
    buildElectronCaptureArgs("/repo/scripts/web-showcase-capture.mjs", {
      navigation,
      profileDirectory: "/tmp/profile",
      capture: {
        sceneId: "web:cards",
        viewport: "desktop",
        appearance: "dark",
        width: 1440,
        height: 900,
        outputPath: "/captures/cards/desktop-dark.png",
      },
    }),
    [
      "--force-device-scale-factor=1",
      "/repo/scripts/web-showcase-capture.mjs",
      "--navigation",
      JSON.stringify(navigation),
      "--width",
      "1440",
      "--height",
      "900",
      "--appearance",
      "dark",
      "--out",
      "/captures/cards/desktop-dark.png",
      "--profile",
      "/tmp/profile",
    ],
  );
});
