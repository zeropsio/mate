import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { WS_METHODS, ZeropsAgentId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import type { PlatformError } from "effect/PlatformError";
import * as Schema from "effect/Schema";

import surfaceManifestJson from "../docs/internals/zerops/surfaces.json" with { type: "json" };
import { SHOWCASE_SCENES } from "./mobile-showcase-environment.ts";

const repoRootUrl = new URL("..", import.meta.url);
const repoRoot = Effect.service(Path.Path).pipe(
  Effect.flatMap((path) => path.fromFileUrl(repoRootUrl)),
);

const KebabCaseId = Schema.NonEmptyString.check(Schema.isPattern(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u));

const RepoRelativePath = Schema.NonEmptyString.check(
  Schema.makeFilter((value) =>
    value.startsWith("/") || value.split("/").includes("..")
      ? "Expected a repo-relative path without parent traversal"
      : undefined,
  ),
);

const EntryPoint = Schema.Struct({
  kind: Schema.Literals([
    "route",
    "right-panel-tab",
    "sidebar-item",
    "settings-section",
    "settings-search",
    "inline",
    "overlay",
    "provider",
    "escape",
  ]),
  value: Schema.NonEmptyString,
});

const ClientAvailability = Schema.Union([
  Schema.Literal("yes"),
  Schema.Struct({
    status: Schema.Literals(["n/a", "planned"]),
    reason: Schema.NonEmptyString,
  }),
]);

const ProviderApplicability = Schema.Union([
  Schema.Literal("n/a"),
  Schema.NonEmptyArray(ZeropsAgentId).check(
    Schema.makeFilter((providers) =>
      new Set(providers).size === providers.length ? undefined : "Expected unique provider ids",
    ),
  ),
]);

const ConnectionModes = Schema.NonEmptyArray(Schema.Literals(["zerops-door", "manual-link"])).check(
  Schema.makeFilter((modes) =>
    new Set(modes).size === modes.length ? undefined : "Expected unique connection modes",
  ),
);

function isKnownWsMethod(value: string): boolean {
  return Object.values(WS_METHODS).some((method) => method === value);
}

function isZeropsRpcName(value: string): boolean {
  return value.startsWith("zerops.") || value.startsWith("subscribeZerops");
}

const ContractId = Schema.NonEmptyString.check(
  Schema.makeFilter((value) =>
    !isZeropsRpcName(value) || isKnownWsMethod(value)
      ? undefined
      : `Unknown Zerops RPC name: ${value}`,
  ),
);

const ReverseState = Schema.Struct({
  action: Schema.NonEmptyString,
  reverse: Schema.NonEmptyString,
});

const WebCaptureId = Schema.NonEmptyString.check(
  Schema.isPattern(/^web:[a-z0-9]+(?:-[a-z0-9]+)*$/u),
);

/**
 * Manifest connection vocabulary maps `zerops-door` to the wire's
 * `zerops-identity` and `manual-link` to the wire's `one-time-token` plus the
 * web connection-origin `pairing`. `providers` names coding-agent ids only
 * when a surface renders per-agent state, actions, or phrases; neutral output
 * uses `n/a`, while a parent inherits ids from a per-agent surface it renders.
 * Capture ids are the mobile showcase scene ids plus reserved `web:<id>` ids
 * for the later web showcase. Component discovery covers web TSX files only;
 * declared mobile components, including the manual-link surface, are
 * existence-checked but are not scan roots.
 */
const Surface = Schema.Struct({
  id: KebabCaseId,
  title: Schema.NonEmptyString,
  components: Schema.NonEmptyArray(RepoRelativePath),
  entryPoints: Schema.NonEmptyArray(EntryPoint),
  clients: Schema.Struct({
    web: ClientAvailability,
    desktop: ClientAvailability,
    mobile: ClientAvailability,
  }),
  providers: ProviderApplicability,
  connectionModes: ConnectionModes,
  connectionModeNote: Schema.optional(Schema.NonEmptyString),
  contracts: Schema.NonEmptyArray(ContractId),
  reverseStates: Schema.NonEmptyArray(ReverseState),
  docs: Schema.Union([
    RepoRelativePath,
    Schema.Struct({
      none: Schema.NonEmptyString,
    }),
  ]),
  tests: Schema.Array(RepoRelativePath),
  untested: Schema.optional(Schema.NonEmptyString),
  captures: Schema.Array(Schema.Union([Schema.Literals(SHOWCASE_SCENES), WebCaptureId])),
}).check(
  Schema.makeFilter((surface) => {
    const issues: Array<Schema.FilterIssue> = [];
    const actionNames = new Set(surface.reverseStates.map(({ action }) => action));

    for (const [index, state] of surface.reverseStates.entries()) {
      if (state.reverse.startsWith("none: ")) {
        if (state.reverse.slice("none: ".length).trim().length === 0) {
          issues.push({
            path: ["reverseStates", index, "reverse"],
            issue: "Expected a reason after 'none:'",
          });
        }
      } else if (!actionNames.has(state.reverse)) {
        issues.push({
          path: ["reverseStates", index, "reverse"],
          issue: "Expected another action name or 'none: <reason>'",
        });
      }
    }

    if (surface.tests.length === 0 && surface.untested === undefined) {
      issues.push({
        path: ["tests"],
        issue: "Expected at least one test path or an untested reason",
      });
    }

    return issues;
  }),
);

const SurfaceManifest = Schema.Struct({
  version: Schema.Literal(1),
  surfaces: Schema.Array(Surface),
});

const strictParseOptions = {
  errors: "all",
  onExcessProperty: "error",
} as const;
const decodeSurface = Schema.decodeUnknownSync(Surface, strictParseOptions);
const decodeSurfaceManifest = Schema.decodeUnknownSync(SurfaceManifest, strictParseOptions);

const EXPECTED_SURFACE_IDS = [
  "zerops-session",
  "zerops-panel",
  "zerops-service-map",
  "zerops-quick-actions",
  "zerops-agent-auth-card",
  "zerops-lifecycle-strip",
  "zerops-tool-card",
  "zerops-landing",
  "zerops-projects",
  "zerops-settings",
  "zerops-first-prompt",
  "manual-link",
] as const;

const VALID_SURFACE_FIXTURE = {
  id: "fixture-surface",
  title: "Fixture surface",
  components: ["apps/web/src/zerops/firstPrompt.ts"],
  entryPoints: [{ kind: "inline", value: "fixture" }],
  clients: {
    web: "yes",
    desktop: "yes",
    mobile: { status: "planned", reason: "The fixture is not on mobile yet." },
  },
  providers: "n/a",
  connectionModes: ["zerops-door"],
  contracts: ["projection:zeropsResult"],
  reverseStates: [
    { action: "Open", reverse: "Close" },
    { action: "Close", reverse: "Open" },
  ],
  docs: { none: "The fixture has no user documentation." },
  tests: ["apps/web/src/zerops/firstPrompt.test.ts"],
  captures: [],
} as const;

function collectNonTestTsxFiles(
  root: string,
): Effect.Effect<ReadonlyArray<string>, PlatformError, FileSystem.FileSystem | Path.Path> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const entries = yield* fs.readDirectory(root);
    const files: Array<string> = [];

    for (const entry of entries) {
      const entryPath = path.join(root, entry);
      const stat = yield* fs.stat(entryPath);
      if (stat.type === "Directory") {
        files.push(...(yield* collectNonTestTsxFiles(entryPath)));
      } else if (stat.type === "File" && entry.endsWith(".tsx") && !entry.endsWith(".test.tsx")) {
        files.push(entryPath);
      }
    }

    return files;
  });
}

describe("surface manifest schema", () => {
  it("decodes the valid surface fixture", () => {
    assert.doesNotThrow(() => decodeSurface(VALID_SURFACE_FIXTURE));
  });

  it("decodes the checked-in manifest with the complete ordered id set", () => {
    const manifest = decodeSurfaceManifest(surfaceManifestJson);
    const ids = manifest.surfaces.map(({ id }) => id);

    assert.deepStrictEqual(ids, [...EXPECTED_SURFACE_IDS]);
    assert.strictEqual(new Set(ids).size, ids.length, "surface ids must be unique");
    assert.deepStrictEqual(
      manifest.surfaces
        .filter(({ connectionModeNote }) => connectionModeNote !== undefined)
        .map(({ id }) => id),
      ["zerops-first-prompt"],
    );
  });

  it("rejects a row missing reverseStates", () => {
    assert.throws(() =>
      decodeSurface({
        id: VALID_SURFACE_FIXTURE.id,
        title: VALID_SURFACE_FIXTURE.title,
        components: VALID_SURFACE_FIXTURE.components,
        entryPoints: VALID_SURFACE_FIXTURE.entryPoints,
        clients: VALID_SURFACE_FIXTURE.clients,
        providers: VALID_SURFACE_FIXTURE.providers,
        connectionModes: VALID_SURFACE_FIXTURE.connectionModes,
        contracts: VALID_SURFACE_FIXTURE.contracts,
        docs: VALID_SURFACE_FIXTURE.docs,
        tests: VALID_SURFACE_FIXTURE.tests,
        captures: VALID_SURFACE_FIXTURE.captures,
      }),
    );
  });

  it("rejects an unknown mobile client value", () => {
    assert.throws(() =>
      decodeSurface({
        ...VALID_SURFACE_FIXTURE,
        clients: { ...VALID_SURFACE_FIXTURE.clients, mobile: "maybe" },
      }),
    );
  });

  it("rejects an empty connection-mode list", () => {
    assert.throws(() => decodeSurface({ ...VALID_SURFACE_FIXTURE, connectionModes: [] }));
  });

  it("rejects an unknown Zerops RPC name", () => {
    assert.throws(() =>
      decodeSurface({
        ...VALID_SURFACE_FIXTURE,
        contracts: ["zerops.topology.mutate"],
      }),
    );
  });

  it("rejects an empty test list without an untested reason", () => {
    assert.throws(() => decodeSurface({ ...VALID_SURFACE_FIXTURE, tests: [] }));
  });

  it("rejects an unknown top-level key", () => {
    assert.throws(() => decodeSurface({ ...VALID_SURFACE_FIXTURE, surprise: true }));
  });

  it("rejects an unknown key nested in clients", () => {
    assert.throws(() =>
      decodeSurface({
        ...VALID_SURFACE_FIXTURE,
        clients: {
          ...VALID_SURFACE_FIXTURE.clients,
          surprise: true,
        },
      }),
    );
  });

  it("rejects an empty contract list", () => {
    assert.throws(() => decodeSurface({ ...VALID_SURFACE_FIXTURE, contracts: [] }));
  });

  it("rejects an empty reverse-state list", () => {
    assert.throws(() => decodeSurface({ ...VALID_SURFACE_FIXTURE, reverseStates: [] }));
  });

  it("accepts mobile and reserved web capture ids", () => {
    assert.doesNotThrow(() =>
      decodeSurface({
        ...VALID_SURFACE_FIXTURE,
        captures: ["threads", "web:fixture-surface"],
      }),
    );
  });

  it("rejects a capture id outside the mobile and reserved web vocabularies", () => {
    assert.throws(() =>
      decodeSurface({
        ...VALID_SURFACE_FIXTURE,
        captures: ["fixture-surface"],
      }),
    );
  });
});

it.layer(NodeServices.layer)("surface manifest filesystem", (it) => {
  it.effect("points only at existing components, tests, and user docs", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* repoRoot;
      const manifest = decodeSurfaceManifest(surfaceManifestJson);

      for (const surface of manifest.surfaces) {
        const declaredPaths = [
          ...surface.components,
          ...surface.tests,
          ...(typeof surface.docs === "string" ? [surface.docs] : []),
        ];
        for (const declaredPath of declaredPaths) {
          assert.isTrue(
            yield* fs.exists(path.join(root, declaredPath)),
            `${surface.id} points at a missing path: ${declaredPath}`,
          );
        }
      }
    }),
  );

  it.effect("claims every existing Zerops component", () =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      const root = yield* repoRoot;
      const manifest = decodeSurfaceManifest(surfaceManifestJson);
      const discoveredZeropsComponents = yield* collectNonTestTsxFiles(
        path.join(root, "apps/web/src/components/zerops"),
      );

      assert.isAbove(
        discoveredZeropsComponents.length,
        0,
        "the Zerops component scan found no files; did a path move?",
      );

      const scanned = [
        ...discoveredZeropsComponents,
        ...(yield* collectNonTestTsxFiles(path.join(root, "apps/web/src/zerops"))),
        path.join(root, "apps/web/src/components/settings/ZeropsSettings.tsx"),
        path.join(root, "apps/web/src/components/auth/PairingRouteSurface.tsx"),
      ].map((file) => path.relative(root, file));

      const claimed = new Set(manifest.surfaces.flatMap(({ components }) => components));
      const unclaimed = scanned.filter((file) => !claimed.has(file)).sort();
      assert.deepStrictEqual(
        unclaimed,
        [],
        "every scanned Zerops component must be claimed by a surface row",
      );
    }),
  );
});
