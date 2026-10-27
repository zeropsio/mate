// @effect-diagnostics nodeBuiltinImport:off -- Source-integrity checks read authored SVG files.
import * as NodeFS from "node:fs";

import { ZEROPS_MARK } from "@t3tools/shared/brand";
import { describe, expect, it } from "vite-plus/test";

import {
  BRAND_ASSET_PATHS,
  DEVELOPMENT_ICON_OVERRIDES,
  DEVELOPMENT_PUBLIC_ICON_OVERRIDES,
  resolveWebAssetBrandForChannel,
  resolveWebAssetBrandForPackageVersion,
  resolveWebIconOverrides,
} from "./brand-assets.ts";

const readRepositoryFile = (relativePath: string) =>
  NodeFS.readFileSync(new URL(`../../${relativePath}`, import.meta.url), "utf8");

describe("brand-assets", () => {
  it("maps production web assets into the server package", () => {
    expect(resolveWebIconOverrides("production", "dist/client")).toEqual([
      {
        sourceRelativePath: BRAND_ASSET_PATHS.productionWebFaviconIco,
        targetRelativePath: "dist/client/favicon.ico",
      },
      {
        sourceRelativePath: BRAND_ASSET_PATHS.productionWebFavicon16Png,
        targetRelativePath: "dist/client/favicon-16x16.png",
      },
      {
        sourceRelativePath: BRAND_ASSET_PATHS.productionWebFavicon32Png,
        targetRelativePath: "dist/client/favicon-32x32.png",
      },
      {
        sourceRelativePath: BRAND_ASSET_PATHS.productionWebAppleTouchIconPng,
        targetRelativePath: "dist/client/apple-touch-icon.png",
      },
    ]);
  });

  it("maps server build web assets to development icons", () => {
    expect(DEVELOPMENT_ICON_OVERRIDES[0]).toEqual({
      sourceRelativePath: BRAND_ASSET_PATHS.developmentWebFaviconIco,
      targetRelativePath: "dist/client/favicon.ico",
    });
  });

  it("does not regenerate removed public raster icons", () => {
    expect(DEVELOPMENT_PUBLIC_ICON_OVERRIDES).toEqual([]);
  });

  it("can target hosted web dist directly", () => {
    expect(resolveWebIconOverrides("production", "apps/web/dist")).toContainEqual({
      sourceRelativePath: BRAND_ASSET_PATHS.productionWebAppleTouchIconPng,
      targetRelativePath: "apps/web/dist/apple-touch-icon.png",
    });
  });

  it("maps hosted nightly web assets to nightly icons", () => {
    expect(resolveWebIconOverrides("nightly", "apps/web/dist")).toContainEqual({
      sourceRelativePath: BRAND_ASSET_PATHS.nightlyWebFaviconIco,
      targetRelativePath: "apps/web/dist/favicon.ico",
    });
  });

  it("maps hosted release channels to web asset brands", () => {
    expect(resolveWebAssetBrandForChannel("latest")).toBe("production");
    expect(resolveWebAssetBrandForChannel("nightly")).toBe("nightly");
  });

  it("maps package versions to web asset brands", () => {
    expect(resolveWebAssetBrandForPackageVersion("0.0.29")).toBe("production");
    expect(resolveWebAssetBrandForPackageVersion("0.0.29-nightly.20260723.882")).toBe("nightly");
  });

  it("keeps development, nightly, and production icon families separate", () => {
    expect([
      BRAND_ASSET_PATHS.developmentIconComposerProject,
      BRAND_ASSET_PATHS.nightlyIconComposerProject,
      BRAND_ASSET_PATHS.productionIconComposerProject,
    ]).toEqual([
      "assets/dev/app-icon.icon",
      "assets/nightly/app-icon.icon",
      "assets/prod/app-icon.icon",
    ]);
    expect(BRAND_ASSET_PATHS.developmentDesktopIconPng).toMatch(/^assets\/dev\/blueprint-/);
    expect(BRAND_ASSET_PATHS.nightlyMacIconPng).toMatch(/^assets\/nightly\/nightly-/);
    expect(BRAND_ASSET_PATHS.productionMacIconPng).toMatch(/^assets\/prod\/black-/);
  });

  it("uses the canonical Zerops mark across authored application icon sources", () => {
    const markSources = [
      "assets/dev/app-icon.icon/Assets/mark.svg",
      "assets/nightly/app-icon.icon/Assets/mark.svg",
      "assets/prod/app-icon.icon/Assets/mark.svg",
      "assets/prod/logo.svg",
      "apps/mobile/assets/android-icon-foreground.svg",
      "apps/mobile/assets/widget/T3Mark.svg",
    ];

    for (const source of markSources) {
      const svg = readRepositoryFile(source);
      for (const path of ZEROPS_MARK.paths) {
        expect(svg, source).toContain(`d="${path.d}"`);
        expect(svg, source).toContain(`fill="${path.fill}"`);
      }
    }

    for (const project of ["dev", "nightly", "prod"]) {
      const manifest = readRepositoryFile(`assets/${project}/app-icon.icon/icon.json`);
      expect(manifest, project).toContain('"image-name": "mark.svg"');
      expect(manifest, project).toContain('"name": "Zerops Mark"');
    }
  });
});
