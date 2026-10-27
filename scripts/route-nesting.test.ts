import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

/**
 * TanStack's file routing reads `a.b.tsx` as "b nested under a", so `a`'s
 * component becomes b's layout and renders b only where it puts an
 * `<Outlet />`. A parent that renders its own screen instead swallows the
 * child whole: the URL changes and the old screen stays put. That is what
 * `/zerops/new` did — the project wizard was unreachable behind the projects
 * page — until it became `zerops_.new.tsx`. The `_` suffix opts a route out
 * of its parent's layout while keeping the same URL, which is why
 * `zerops_.authorized.tsx` has one too.
 */
const routesUrl = new URL("../apps/web/src/routes/", import.meta.url);

it.layer(NodeServices.layer)("route nesting", (it) => {
  it.effect("never nests a route under a parent that renders no Outlet", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* path.fromFileUrl(routesUrl);
      const entries = yield* fs.readDirectory(root);
      const files = entries.filter(
        (name) => name.endsWith(".tsx") && !name.includes(".test.") && !name.startsWith("-"),
      );

      const offenders: Array<string> = [];
      for (const name of files) {
        const segments = name.replace(/\.tsx$/u, "").split(".");
        if (segments.length < 2) continue;
        const parent = segments[0] ?? "";
        // `_` opts out of the parent layout: the route is its own top level.
        if (parent.endsWith("_")) continue;
        const parentFile = `${parent}.tsx`;
        if (!files.includes(parentFile)) continue;
        const parentSource = yield* fs.readFileString(path.join(root, parentFile));
        if (parentSource.includes("<Outlet")) continue;
        offenders.push(`${name} nests under ${parentFile}, which renders no <Outlet />`);
      }

      assert.deepStrictEqual(offenders, []);
    }),
  );
});
