// @effect-diagnostics nodeBuiltinImport:off -- This test verifies generated native resources.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeURL from "node:url";
import { describe, expect, it } from "vite-plus/test";

import { useFontFamily } from "./useFontFamily";

const mobileRoot = new URL("../../", import.meta.url);

function generatedAndroidNames(values: ReadonlyArray<string>) {
  const generatorPath = NodeURL.fileURLToPath(
    new URL("node_modules/expo-font/plugin/build/utils.js", mobileRoot),
  );
  const generatorScript = [
    "const { toValidAndroidResourceName } = require(process.argv[1]);",
    'process.stdout.write(process.argv.slice(2).map(toValidAndroidResourceName).join("\\n"));',
  ].join("");

  return NodeChildProcess.execFileSync(
    process.execPath,
    ["-e", generatorScript, generatorPath, ...values],
    { encoding: "utf8" },
  ).split("\n");
}

describe("useFontFamily", () => {
  it("uses the three native Roboto family names", () => {
    expect(useFontFamily("regular")).toBe("Roboto-Regular");
    expect(useFontFamily("medium")).toBe("Roboto-Medium");
    expect(useFontFamily("bold")).toBe("Roboto-Bold");
  });

  it("keeps plugin font references aligned with expo-font generated resources", () => {
    const appConfig = NodeFS.readFileSync(new URL("app.config.ts", mobileRoot), "utf8");
    const fontFamilies = [...appConfig.matchAll(/fontFamily: "([^"]+)"/gu)].map(
      (match) => match[1],
    );
    const fontPaths = [...appConfig.matchAll(/(?:regular|medium|bold): "([^"]+\.ttf)"/gu)].map(
      (match) => match[1],
    );
    const generatedFamilyResources = generatedAndroidNames(fontFamilies).map(
      (name) => `xml_${name}`,
    );
    const generatedFileResources = generatedAndroidNames(fontPaths);

    expect(generatedFamilyResources).toEqual([
      "xml_roboto_regular",
      "xml_roboto_medium",
      "xml_roboto_bold",
    ]);
    expect(generatedFileResources).toEqual([
      "roboto_400regular",
      "roboto_500medium",
      "roboto_700bold",
    ]);

    const pluginReferences = [
      "plugins/withAndroidModernPopupMenu.cjs",
      "plugins/withAndroidModernAlertDialog.cjs",
    ].flatMap((relativePath) => {
      const source = NodeFS.readFileSync(new URL(relativePath, mobileRoot), "utf8");
      return [...source.matchAll(/@font\/([a-z0-9_]+)/gu)].map((match) => match[1]);
    });
    const generatedResources = new Set([...generatedFamilyResources, ...generatedFileResources]);

    expect(pluginReferences).toEqual([
      "xml_roboto_regular",
      "xml_roboto_regular",
      "xml_roboto_regular",
      "roboto_500medium",
      "roboto_500medium",
    ]);
    expect(pluginReferences.every((resource) => generatedResources.has(resource))).toBe(true);
  });
});
