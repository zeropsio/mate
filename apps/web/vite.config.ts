// @effect-diagnostics nodeBuiltinImport:off -- Vite config runs in Node before any Effect runtime exists.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeZlib from "node:zlib";

import tailwindcss from "@tailwindcss/vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import babel from "@rolldown/plugin-babel";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import compression from "compression";
import { defineProject, type TestProjectInlineConfiguration } from "vite-plus/test/config";
import "vite-plus/test/config";
import { build as viteBuild, defineConfig, type Connect, type Plugin } from "vite-plus";
import pkg from "./package.json" with { type: "json" };

import { normalizeBasePath } from "@t3tools/shared/basePath";
import { DEV_PROXIED_PATH_PREFIXES } from "@t3tools/shared/devProxy";

import { loadRepoEnv } from "../../scripts/lib/public-config";
import { buildDocumentTitle } from "./src/branding.logic";
import { embedShellFiles } from "./src/appShell/appShell.logic";
import { precacheList } from "./src/appShell/appShellBuild.logic";

const repoEnv = loadRepoEnv();
Object.assign(process.env, repoEnv);

// Single-origin dev is signalled positively, because it cannot be inferred
// from the absence of VITE_HTTP_URL/VITE_WS_URL: the runner deletes those keys
// but `loadRepoEnv` merges `.env`/`.env.local` *underneath* the process env, so
// a developer with either URL in their `.env` gets it back here. Baking it then
// pins the client to localhost and breaks every non-localhost origin — the
// exact failure single-origin mode exists to prevent, and an invisible one
// since the page still loads.
const isSingleOriginDev = process.env.T3CODE_SINGLE_ORIGIN_DEV === "1";

// The bundle may be hosted under a path prefix rather than at an origin root:
// Zerops serves the container's server at <origin>/mate/, beside code-server on
// the same 8080 origin. Every asset reference is root-absolute, so without this
// the shell loads under the prefix and every asset 404s (or worse, is answered
// by whatever owns the origin root). Vite exposes the value as
// `import.meta.env.BASE_URL`, which `src/basePath.ts` reads back at runtime.
const base = `${normalizeBasePath(process.env.VITE_BASE_PATH)}/`;

const port = Number(process.env.PORT ?? 5733);
const explicitHost = process.env.HOST?.trim();
const host = explicitHost || "localhost";
const configuredWsUrl = isSingleOriginDev ? undefined : process.env.VITE_WS_URL?.trim();
const configuredHttpUrl = isSingleOriginDev ? undefined : process.env.VITE_HTTP_URL?.trim();
const configuredRelayUrl = repoEnv.VITE_T3CODE_RELAY_URL?.trim() || "";
const configuredRelayTracingUrl = repoEnv.VITE_RELAY_OTLP_TRACES_URL?.trim() || "";
const configuredRelayTracingDataset = repoEnv.VITE_RELAY_OTLP_TRACES_DATASET?.trim() || "";
const configuredRelayTracingToken = repoEnv.VITE_RELAY_OTLP_TRACES_TOKEN?.trim() || "";
const configuredHostedAppChannel = process.env.VITE_HOSTED_APP_CHANNEL?.trim() || "";
const configuredAppVersion = process.env.APP_VERSION?.trim() || pkg.version;
// The commit the bundle is built from, shown beside the version (Settings → General); empty
// when the build runs outside a git checkout.
const builtCommit = (() => {
  try {
    return NodeChildProcess.execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: import.meta.dirname,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
})();
const configuredHostedAppUrl = (() => {
  const explicitHostedAppUrl = process.env.VITE_HOSTED_APP_URL?.trim();
  if (explicitHostedAppUrl) {
    return explicitHostedAppUrl;
  }
  if (process.env.VERCEL_ENV === "production" && process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  }
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }
  return undefined;
})();
const sourcemapEnv = process.env.T3CODE_WEB_SOURCEMAP?.trim().toLowerCase();

// Vite 8.1's experimental bundled dev mode: serves rolldown-bundled chunks in
// dev for much faster startup/reload on large module graphs, with HMR served
// as hot patches. Opt-in while experimental: T3CODE_BUNDLED_DEV=1 pnpm dev:web
const bundledDevEnv = process.env.T3CODE_BUNDLED_DEV?.trim().toLowerCase();
const bundledDev = bundledDevEnv === "1" || bundledDevEnv === "true";

const buildSourcemap: boolean | "hidden" =
  sourcemapEnv === "0" || sourcemapEnv === "false"
    ? false
    : sourcemapEnv === "hidden"
      ? "hidden"
      : true;

const unitTestOptions = {
  fsModuleCache: true,
  // Tables declare tests through `it.each(rows)("$title", …)`: the title is the row's whole sentence.
  taskTitleValueFormatTruncate: Number.MAX_SAFE_INTEGER,
  // Dynamic imports and isolated module reloads run inside cases and hooks. Their wall
  // time under contention is not an assertion; CI's 10-minute job guard owns hangs.
  hookTimeout: 660_000,
  testTimeout: 660_000,
  globalSetup: ["../../packages/shared/src/testing/longTempDir.ts"],
} satisfies TestProjectInlineConfiguration["test"];

// A shared worker (`isolate: false`) loads the module graph once for all its files, but Vitest
// resets neither its mock registry nor its evaluated modules between them: a file that replaces
// modules (`vi.mock`) would hand its fakes, and every consumer evaluated against them, to the
// next file. Those files run in workers of their own; Vitest shares a worker only within one
// project and environment, so no other file ever sees their replacements.
const moduleMockingTestFiles = NodeFS.globSync(["src/**/*.test.ts", "src/**/*.test.tsx"], {
  cwd: import.meta.dirname,
}).filter((file) =>
  /\bvi\.(?:mock|doMock)\(/u.test(
    NodeFS.readFileSync(NodePath.join(import.meta.dirname, file), "utf8"),
  ),
);

const unitTestProject = {
  extends: true,
  test: {
    ...unitTestOptions,
    name: "unit",
    isolate: false,
    setupFiles: ["./test/sharedWorkerSetup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    exclude: moduleMockingTestFiles,
  },
} satisfies TestProjectInlineConfiguration;

const isolatedUnitTestProject = {
  extends: true,
  test: { ...unitTestOptions, name: "unit-isolated", include: moduleMockingTestFiles },
} satisfies TestProjectInlineConfiguration;

/**
 * The run-card oracle: the running engine over its scripted provider, the client's wire and store,
 * and the card's own logic, in one process (`test/engine-oracle`). Its own tsconfig holds the
 * server's files it reads; the unit project never imports them.
 */
const engineOracleProject = {
  extends: true,
  test: {
    name: "engine-oracle",
    taskTitleValueFormatTruncate: Number.MAX_SAFE_INTEGER,
    include: ["test/engine-oracle/**/*.test.ts"],
    testTimeout: 600_000,
    hookTimeout: 60_000,
    globalSetup: ["../../packages/shared/src/testing/longTempDir.ts"],
  },
} satisfies TestProjectInlineConfiguration;

function resolveDevProxyTarget(
  backendPort: string | undefined,
  wsUrl: string | undefined,
): string | undefined {
  // Browser dev is single-origin: the backend port is proxied through this
  // server so the app works from any origin (localhost, tailnet, LAN, phone).
  // T3CODE_PORT is set by scripts/dev-runner.ts for every non-desktop mode.
  const port = Number(backendPort?.trim());
  if (Number.isInteger(port) && port > 0) {
    return `http://localhost:${port}/`;
  }

  // dev:desktop still points the renderer straight at the backend, so fall
  // back to deriving the target from the explicit websocket URL.
  if (!wsUrl) {
    return undefined;
  }

  try {
    const url = new URL(wsUrl);
    if (url.protocol === "ws:") {
      url.protocol = "http:";
    } else if (url.protocol === "wss:") {
      url.protocol = "https:";
    }
    url.pathname = "";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return undefined;
  }
}

const devProxyTarget = resolveDevProxyTarget(process.env.T3CODE_PORT, configuredWsUrl);

// Vite's dev server sends JS uncompressed. On localhost that is free; over a
// shared origin (tailnet, LAN) it is the whole cold-start: bundled dev serves
// one ~25 MB chunk, and a typical uplink moves that in about a minute while
// both machines sit idle. Compressing turns it into a few seconds of CPU.
// Brotli quality 5 keeps encode time in the hundreds of ms; the default
// (quality 11) would trade the transfer stall for an equally long encode stall.
/**
 * The boot shell's title, as the app will title the tab (`buildDocumentTitle`): the tab never
 * changes its name as the app starts (run 2: "Zerops Mate (Alpha)", then "Zerops Mate").
 */
function documentTitlePlugin(): Plugin {
  let dev = false;
  return {
    name: "mate:document-title",
    configResolved(config) {
      dev = config.command === "serve";
    },
    transformIndexHtml(html) {
      const title = buildDocumentTitle({
        baseName: "Zerops Mate",
        channel: configuredHostedAppChannel,
        dev,
      });
      return html.replace(/<title>[^<]*<\/title>/u, `<title>${title}</title>`);
    },
  };
}

/**
 * Opens the connections every load makes first — the Zerops API's (`/user/info`) and Mate HQ's (its
 * stream ticket) — while the bundle still downloads, not after it has run. Both are asked without
 * cookies, so each link is `crossorigin`: the browser keeps credentialed connections apart.
 */
function preconnectPlugin(): Plugin {
  return {
    name: "mate:preconnect",
    transformIndexHtml() {
      const origins = [
        process.env.VITE_ZEROPS_API_URL?.trim() || PRODUCTION_ZEROPS_API_ORIGIN,
        process.env.VITE_HQ_ORIGIN?.trim(),
      ].flatMap((url) => {
        try {
          return url ? [new URL(url).origin] : [];
        } catch {
          return [];
        }
      });
      return [...new Set(origins)].map((href) => ({
        tag: "link",
        attrs: { rel: "preconnect", href, crossorigin: "" },
        injectTo: "head-prepend" as const,
      }));
    },
  };
}

function devCompressionPlugin(): Plugin {
  return {
    name: "t3code:dev-compression",
    apply: "serve",
    configureServer(server) {
      // compression() is typed against Express's req/res, which extend the
      // node http objects Connect actually passes — safe to narrow.
      server.middlewares.use(
        compression({
          brotli: { params: { [NodeZlib.constants.BROTLI_PARAM_QUALITY]: 5 } },
        }) as unknown as Connect.NextHandleFunction,
      );
    },
  };
}

/** Opt-in module composition alongside the manifest, without shipping analysis in normal builds. */
function bundleCompositionPlugin(): Plugin {
  return {
    name: "mate:bundle-composition",
    apply: "build",
    generateBundle(_options, bundle) {
      const relative = (id: string) =>
        id.replace(`${import.meta.dirname.replace(/\/apps\/web$/u, "")}/`, "");
      this.emitFile({
        type: "asset",
        fileName: "bundle-composition.json",
        source: JSON.stringify(
          Object.fromEntries(
            Object.entries(bundle).flatMap(([file, chunk]) =>
              chunk.type === "chunk"
                ? [
                    [
                      file,
                      {
                        imports: chunk.imports,
                        dynamicImports: chunk.dynamicImports,
                        modules: Object.fromEntries(
                          Object.entries(chunk.modules).map(([id, module]) => [
                            relative(id),
                            {
                              renderedLength: module.renderedLength,
                              // What it imports statically: the graph a lazy boundary is chosen from.
                              imports: (this.getModuleInfo(id)?.importedIds ?? []).map(relative),
                            },
                          ]),
                        ),
                      },
                    ],
                  ]
                : [],
            ),
          ),
          null,
          2,
        ),
      });
    },
  };
}

/**
 * The hosted client's app-shell worker (`src/appShell/sw.ts`), or its kill switch
 * (`src/appShell/retire.ts`), as `/sw.js`: a stable, unhashed path the browser checks for updates,
 * which nginx serves as the real file under zerops.yml's `no-cache` rule. Its own build makes it one
 * classic script: an entry of the app's build would share chunks with the page and need a module
 * worker. Emitted only for a bundle served at an origin root that asks for it
 * (`VITE_APP_SHELL_WORKER`); a Mate's `/mate/` bundle and every other build ship none.
 */
function appShellWorkerPlugin(mode: string): Plugin {
  const entry = mode === "retire" ? "retire.ts" : "sw.ts";
  return {
    name: "mate:app-shell-worker",
    apply: "build",
    async generateBundle() {
      const built = await viteBuild({
        configFile: false,
        logLevel: "warn",
        root: import.meta.dirname,
        resolve: { tsconfigPaths: true },
        build: {
          write: false,
          emptyOutDir: false,
          minify: true,
          sourcemap: false,
          lib: {
            entry: `src/appShell/${entry}`,
            formats: ["iife"],
            name: "mateAppShellWorker",
            fileName: () => "sw.js",
          },
        },
      });
      const outputs = Array.isArray(built) ? built : [built];
      const chunk = outputs
        .flatMap((output) => ("output" in output ? output.output : []))
        .find((file) => file.type === "chunk");
      if (chunk === undefined || chunk.type !== "chunk") {
        throw new Error("The app-shell worker build produced no script");
      }
      this.emitFile({ type: "asset", fileName: "sw.js", source: chunk.code });
    },
  };
}

/**
 * Lists in the page every file it may load while it runs (`src/appShell/appShellBuild.logic.ts`):
 * the worker keeps a page only once all of it is kept, and keeps the replaced page's files beside
 * it for tabs still running it.
 */
function appShellFilesPlugin(): Plugin {
  return {
    name: "mate:app-shell-files",
    apply: "build",
    generateBundle: {
      order: "post",
      handler(_options, bundle) {
        const chunks = Object.values(bundle).flatMap((file) =>
          file.type === "chunk"
            ? [
                {
                  fileName: file.fileName,
                  isEntry: file.isEntry,
                  imports: file.imports,
                  dynamicImports: file.dynamicImports,
                  css: [...(file.viteMetadata?.importedCss ?? [])],
                  assets: [...(file.viteMetadata?.importedAssets ?? [])],
                },
              ]
            : [],
        );
        const page = bundle["index.html"];
        if (page === undefined || page.type !== "asset") {
          throw new Error("The app-shell file list found no index.html to embed itself in");
        }
        page.source = embedShellFiles(String(page.source), precacheList(chunks));
      },
    },
  };
}

/**
 * The page's boot entry (`src/boot.ts`) as a classic script inlined in the page's head, ahead of
 * the stylesheet: it runs while the bundle and the stylesheet still download. Its own build, as the
 * worker's: an entry of the app's build joins the startup chunk it is meant to run ahead of. A dev
 * server serves it as a module of its own.
 */
function bootEntryPlugin(): Plugin {
  let serving = false;
  return {
    name: "mate:boot-entry",
    configResolved(config) {
      serving = config.command === "serve";
    },
    async transformIndexHtml(html) {
      if (serving)
        return [
          {
            tag: "script",
            attrs: { type: "module", src: `${base}src/boot.ts` },
            injectTo: "head" as const,
          },
        ];
      const built = await viteBuild({
        configFile: false,
        logLevel: "warn",
        root: import.meta.dirname,
        resolve: { tsconfigPaths: true },
        build: {
          write: false,
          emptyOutDir: false,
          minify: true,
          sourcemap: false,
          lib: {
            entry: "src/boot.ts",
            formats: ["iife"],
            name: "mateBoot",
            fileName: () => "boot.js",
          },
        },
      });
      const outputs = Array.isArray(built) ? built : [built];
      const chunk = outputs
        .flatMap((output) => ("output" in output ? output.output : []))
        .find((file) => file.type === "chunk");
      if (chunk === undefined || chunk.type !== "chunk") {
        throw new Error("The boot entry build produced no script");
      }
      // An inline script waits for every stylesheet linked before it. Ahead of the first, it runs
      // as the head is read, also on a load whose stylesheet is not cached yet (the first after a
      // release); and after the head's `<meta charset>`, which must stay in the page's first
      // 1024 bytes. It depends on nothing else in the page.
      const stylesheet = html.search(/<link\b[^>]*\brel="stylesheet"/u);
      if (stylesheet < 0) throw new Error("The boot entry found no stylesheet link to run before");
      return `${html.slice(0, stylesheet)}<script>${chunk.code}</script>\n    ${html.slice(stylesheet)}`;
    },
  };
}

const configuredAppShellWorker = process.env.VITE_APP_SHELL_WORKER?.trim().toLowerCase() || "";

// Vite rejects requests whose Host header isn't localhost, which blocks sharing
// a dev server over a LAN alias (ngrok, a LAN IP alias) — goes through the env var.
const configuredAllowedHosts = (process.env.T3CODE_DEV_ALLOWED_HOSTS ?? "")
  .split(",")
  .map((entry) => entry.trim())
  .filter((entry) => entry.length > 0);
const allowedHosts = configuredAllowedHosts;

// The one HQ every organization shares: the client names it at build time, never reads it off an
// organization (`zerops/accountHq.ts` `configuredHq`). A build without `VITE_HQ_ORIGIN` (the
// desktop staging build, a local `vp build`) names production's, as `zerops.yml` does for `prod`;
// `vite dev` names alfa's, so a dev server never writes to the shared production HQ.
const PRODUCTION_HQ_ORIGIN = "https://mate-hq.zerops.io";
/** The platform a build talks to when it names none (`DEFAULT_ZEROPS_API_BASE`, client-runtime). */
const PRODUCTION_ZEROPS_API_ORIGIN = "https://api.app-prg1.zerops.io";
const ALFA_HQ_ORIGIN = "https://hq-31d9-8080.prg1.zerops.app";

export default defineConfig(({ command }) => {
  process.env.VITE_HQ_ORIGIN ||= command === "build" ? PRODUCTION_HQ_ORIGIN : ALFA_HQ_ORIGIN;
  return {
    base,
    assetsInclude: ["**/*.wasm"],
    plugins: [
      documentTitlePlugin(),
      preconnectPlugin(),
      devCompressionPlugin(),
      ...(process.env.T3CODE_WEB_ANALYZE === "1" ? [bundleCompositionPlugin()] : []),
      ...(base === "/" && ["app-shell", "retire"].includes(configuredAppShellWorker)
        ? [appShellWorkerPlugin(configuredAppShellWorker), appShellFilesPlugin()]
        : []),
      // An origin root's page alone: a Mate's `/mate/` bundle opens its stream as it always did.
      ...(base === "/" ? [bootEntryPlugin()] : []),
      tanstackRouter({ autoCodeSplitting: true }),
      react(),
      babel({
        // We need to be explicit about the parser options after moving to @vitejs/plugin-react v6.0.0
        // This is because the babel plugin only automatically parses typescript and jsx based on relative paths (e.g. "**/*.ts")
        // whereas the previous version of the plugin parsed all files with a .ts extension.
        // This is causing our packages/ directory to fail to parse, as they are not relative to the CWD.
        parserOpts: { plugins: ["typescript", "jsx"] },
        presets: [reactCompilerPreset()],
      }),
      tailwindcss(),
    ],
    optimizeDeps: {
      include: [
        "@pierre/diffs",
        "@pierre/diffs/editor",
        "@pierre/diffs/react",
        "@pierre/diffs/worker/worker.js",
        "effect/Array",
        "effect/Order",
        "react-dom/client",
      ],
    },
    define: {
      // In dev mode, tell the web app where the WebSocket server lives
      "import.meta.env.VITE_WS_URL": JSON.stringify(configuredWsUrl ?? ""),
      // Pinned explicitly rather than left to Vite's automatic VITE_ exposure:
      // under single-origin dev this must stay empty even when a `.env`
      // supplies it, so the client falls back to window.location.origin.
      "import.meta.env.VITE_HTTP_URL": JSON.stringify(configuredHttpUrl ?? ""),
      "import.meta.env.VITE_T3CODE_RELAY_URL": JSON.stringify(configuredRelayUrl),
      "import.meta.env.VITE_RELAY_OTLP_TRACES_URL": JSON.stringify(configuredRelayTracingUrl),
      "import.meta.env.VITE_RELAY_OTLP_TRACES_DATASET": JSON.stringify(
        configuredRelayTracingDataset,
      ),
      "import.meta.env.VITE_RELAY_OTLP_TRACES_TOKEN": JSON.stringify(configuredRelayTracingToken),
      "import.meta.env.VITE_HOSTED_APP_URL": JSON.stringify(configuredHostedAppUrl ?? ""),
      "import.meta.env.VITE_HOSTED_APP_CHANNEL": JSON.stringify(configuredHostedAppChannel),
      "import.meta.env.APP_VERSION": JSON.stringify(configuredAppVersion),
      "import.meta.env.APP_COMMIT": JSON.stringify(builtCommit),
      "import.meta.env.VITE_APP_SHELL_WORKER": JSON.stringify(configuredAppShellWorker),
    },
    resolve: {
      tsconfigPaths: true,
      dedupe: ["react", "react-dom"],
    },
    experimental: {
      bundledDev,
    },
    server: {
      host,
      port,
      strictPort: true,
      allowedHosts,
      // Transform the whole module graph at server start instead of on the
      // first request. Without this, a cold worktree discovers and transforms
      // modules one import-level at a time while the browser waits — which
      // over a tailnet origin turns into minutes of waterfall.
      warmup: {
        clientFiles: ["./src/main.tsx"],
      },
      ...(devProxyTarget
        ? {
            // One entry per shared prefix; the server's dev catch-all 404s the
            // same list, so the two sides cannot drift. `/ws` is the app's own
            // socket — Vite's HMR socket is matched separately and exactly
            // (path "/" plus a vite-hmr subprotocol), so the two upgrade
            // handlers don't collide.
            proxy: Object.fromEntries(
              DEV_PROXIED_PATH_PREFIXES.map((prefix) => [
                prefix,
                {
                  target: devProxyTarget,
                  changeOrigin: true,
                  ...(prefix === "/ws" ? { ws: true } : {}),
                },
              ]),
            ),
          }
        : {}),
      // Electron's BrowserWindow needs the HMR socket pinned to an explicit
      // host to connect reliably; dev:desktop is the only mode that sets HOST.
      // Everywhere else, leaving this unset lets the client derive it from the
      // page origin, which is what makes HMR work over the LAN instead of
      // failing an attempt against the wrong machine's localhost first.
      // (Vite 8 logs connection state via console.debug — enable "Verbose".)
      ...(explicitHost
        ? {
            hmr: {
              protocol: "ws",
              host: explicitHost,
              clientPort: port,
            },
          }
        : {}),
    },
    build: {
      outDir: "dist",
      emptyOutDir: true,
      manifest: true,
      sourcemap: buildSourcemap,
      rolldownOptions: {
        output: {
          // Shared startup modules belong to one fetch, rather than a request for each icon/helper.
          // The tag follows the actual static graph and leaves demanded surfaces outside it.
          codeSplitting: { groups: [{ name: "startup", tags: ["$initial" as const] }] },
        },
      },
    },
    test: {
      projects: [
        defineProject(unitTestProject),
        defineProject(isolatedUnitTestProject),
        defineProject(engineOracleProject),
      ],
    },
  };
});
