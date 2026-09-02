import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as NodeTimersPromises from "node:timers/promises";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";

import * as Electron from "electron";

export const DESKTOP_HOST = "app";
export const DESKTOP_PRODUCTION_SCHEME = "zerops-mate";
export const DESKTOP_DEVELOPMENT_SCHEME = "zerops-mate-dev";

export function getDesktopScheme(isDevelopment: boolean): string {
  return isDevelopment ? DESKTOP_DEVELOPMENT_SCHEME : DESKTOP_PRODUCTION_SCHEME;
}

export function getDesktopOrigin(isDevelopment: boolean): string {
  return `${getDesktopScheme(isDevelopment)}://${DESKTOP_HOST}`;
}

export function getDesktopUrl(isDevelopment: boolean): string {
  return `${getDesktopOrigin(isDevelopment)}/`;
}

export class ElectronProtocolRegistrationError extends Schema.TaggedErrorClass<ElectronProtocolRegistrationError>()(
  "ElectronProtocolRegistrationError",
  {
    scheme: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to register Electron protocol scheme "${this.scheme}".`;
  }
}

export class ElectronProtocolUnregistrationError extends Schema.TaggedErrorClass<ElectronProtocolUnregistrationError>()(
  "ElectronProtocolUnregistrationError",
  {
    scheme: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to unregister Electron protocol scheme "${this.scheme}".`;
  }
}

/**
 * Where the renderer origin's requests are served from. Development proxies
 * to the Vite dev server (HMR); every other run (packaged or an unpackaged
 * production-mode launch) serves the staged hosted-static web bundle
 * straight off disk — the desktop no longer runs a local backend to proxy
 * to.
 */
export type DesktopProtocolTarget =
  | { readonly _tag: "development"; readonly devServerUrl: URL }
  | { readonly _tag: "static"; readonly bundleDir: string };

export interface DesktopProtocolRegistrationInput {
  readonly scheme: string;
  readonly target: DesktopProtocolTarget;
}

export class ElectronProtocol extends Context.Service<
  ElectronProtocol,
  {
    readonly registerDesktopProtocol: (
      input: DesktopProtocolRegistrationInput,
    ) => Effect.Effect<void, ElectronProtocolRegistrationError, Scope.Scope>;
  }
>()("@t3tools/desktop/electron/ElectronProtocol") {}

export function makeDesktopContentSecurityPolicy(input: { readonly scheme: string }): string {
  // The renderer connects directly to user-selected Zerops environments (and
  // the Zerops API) in addition to whatever served this bundle. Those origins
  // are not known when this response policy is created, so restrict
  // connections by the network schemes the client supports instead of by
  // host.
  const connectSources = ["'self'", "http:", "https:", "ws:", "wss:"];

  return [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://challenges.cloudflare.com",
    `connect-src ${connectSources.join(" ")}`,
    `img-src 'self' ${input.scheme}: blob: data: http: https:`,
    "style-src 'self' 'unsafe-inline'",
    `font-src 'self' ${input.scheme}: data:`,
    "worker-src 'self' blob:",
    "frame-src 'self' https://challenges.cloudflare.com",
    "form-action 'self'",
  ].join("; ");
}

function withContentSecurityPolicy(response: Response, policy: string): Response {
  const headers = new Headers(response.headers);
  headers.set("Content-Security-Policy", policy);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * Must run synchronously during process bootstrap, before Electron emits `ready`.
 */
export function registerDesktopSchemePrivilegesSync(): void {
  Electron.protocol.registerSchemesAsPrivileged([
    {
      scheme: DESKTOP_PRODUCTION_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
      },
    },
    {
      scheme: DESKTOP_DEVELOPMENT_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
      },
    },
  ]);
}

const registerDesktopSchemePrivileges = Effect.sync(registerDesktopSchemePrivilegesSync).pipe(
  Effect.withSpan("desktop.electron.protocol.registerSchemePrivileges"),
);

export const layerSchemePrivileges = Layer.effectDiscard(registerDesktopSchemePrivileges);

const TRANSIENT_FETCH_RETRY_DELAYS_MS = [0, 50, 150] as const;

async function fetchWithTransientRetry(url: string, init: RequestInit): Promise<Response> {
  let lastError: unknown;

  for (const delayMs of TRANSIENT_FETCH_RETRY_DELAYS_MS) {
    if (delayMs > 0) {
      await NodeTimersPromises.setTimeout(delayMs);
    }

    try {
      return await Electron.net.fetch(url, init);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError;
}

async function proxyToDevServer(
  request: Request,
  devServerUrl: URL,
  contentSecurityPolicy: string,
): Promise<Response> {
  const requestUrl = new URL(request.url);
  if (requestUrl.host !== DESKTOP_HOST) {
    return new Response(null, { status: 404 });
  }

  const targetUrl = new URL(`${requestUrl.pathname}${requestUrl.search}`, devServerUrl);
  const headers = new Headers(request.headers);
  const headersToRemove: string[] = [];
  for (const name of headers.keys()) {
    if (
      name === "host" ||
      name === "origin" ||
      name === "referer" ||
      name === "connection" ||
      name === "content-length" ||
      name === "accept-encoding" ||
      name === "upgrade-insecure-requests" ||
      name.startsWith("sec-fetch-")
    ) {
      headersToRemove.push(name);
    }
  }
  for (const name of headersToRemove) {
    headers.delete(name);
  }
  const init: RequestInit = {
    method: request.method,
    headers,
  };
  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = request.body;
    (init as RequestInit & { duplex: "half" }).duplex = "half";
  }
  const response =
    request.method === "GET" || request.method === "HEAD"
      ? await fetchWithTransientRetry(targetUrl.toString(), init)
      : await Electron.net.fetch(targetUrl.toString(), init);
  return withContentSecurityPolicy(response, contentSecurityPolicy);
}

const STATIC_FILE_MIME_TYPES: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".wasm": "application/wasm",
  ".txt": "text/plain; charset=utf-8",
};

function staticFileMimeType(path: Path.Path, filePath: string): string {
  return STATIC_FILE_MIME_TYPES[path.extname(filePath).toLowerCase()] ?? "application/octet-stream";
}

/**
 * Resolves a request path to a file inside `bundleDir`, guarding against
 * traversal outside it. Falls back to `index.html` — for the bundle root and
 * for any path that isn't a real file on disk (e.g. a stale renderer
 * navigation to a path-based route; the client itself only ever uses hash
 * routing under Electron).
 */
const resolveStaticFilePath = (
  fileSystem: FileSystem.FileSystem,
  path: Path.Path,
  bundleDir: string,
  pathname: string,
): Effect.Effect<string> =>
  Effect.gen(function* () {
    const indexPath = path.join(bundleDir, "index.html");
    const decodedPath = decodeURIComponent(pathname);
    const relativePath = decodedPath.replace(/^\/+/, "");
    if (relativePath.length === 0) {
      return indexPath;
    }

    const candidatePath = path.join(bundleDir, relativePath);
    const relativeToBundle = path.relative(bundleDir, candidatePath);
    if (relativeToBundle.startsWith("..") || path.isAbsolute(relativeToBundle)) {
      return indexPath;
    }

    const info = yield* fileSystem.stat(candidatePath).pipe(Effect.option);
    return Option.isSome(info) && info.value.type === "File" ? candidatePath : indexPath;
  });

const serveStaticFile = (
  fileSystem: FileSystem.FileSystem,
  path: Path.Path,
  request: Request,
  bundleDir: string,
  contentSecurityPolicy: string,
): Promise<Response> =>
  Effect.gen(function* () {
    const requestUrl = new URL(request.url);
    if (requestUrl.host !== DESKTOP_HOST) {
      return new Response(null, { status: 404 });
    }

    const filePath = yield* resolveStaticFilePath(fileSystem, path, bundleDir, requestUrl.pathname);
    const data = yield* fileSystem.readFile(filePath).pipe(Effect.option);
    return Option.match(data, {
      onNone: () =>
        withContentSecurityPolicy(new Response(null, { status: 404 }), contentSecurityPolicy),
      onSome: (bytes) =>
        withContentSecurityPolicy(
          new Response(Uint8Array.from(bytes), {
            status: 200,
            headers: { "Content-Type": staticFileMimeType(path, filePath) },
          }),
          contentSecurityPolicy,
        ),
    });
  }).pipe(Effect.runPromise);

function makeProtocolHandler(
  fileSystem: FileSystem.FileSystem,
  path: Path.Path,
  target: DesktopProtocolTarget,
  contentSecurityPolicy: string,
): (request: Request) => Promise<Response> {
  return target._tag === "development"
    ? (request) => proxyToDevServer(request, target.devServerUrl, contentSecurityPolicy)
    : (request) =>
        serveStaticFile(fileSystem, path, request, target.bundleDir, contentSecurityPolicy);
}

export const make = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const registered = yield* Ref.make(false);

  const registerDesktopProtocol = Effect.fn("desktop.electron.protocol.registerDesktopProtocol")(
    function* (input: DesktopProtocolRegistrationInput) {
      if (yield* Ref.get(registered)) return;

      const contentSecurityPolicy = makeDesktopContentSecurityPolicy({ scheme: input.scheme });
      const handler = makeProtocolHandler(fileSystem, path, input.target, contentSecurityPolicy);

      yield* Effect.acquireRelease(
        Effect.try({
          try: () => {
            Electron.protocol.handle(input.scheme, handler);
          },
          catch: (cause) => new ElectronProtocolRegistrationError({ scheme: input.scheme, cause }),
        }).pipe(Effect.andThen(Ref.set(registered, true))),
        () =>
          Effect.try({
            try: () => Electron.protocol.unhandle(input.scheme),
            catch: (cause) =>
              new ElectronProtocolUnregistrationError({
                scheme: input.scheme,
                cause,
              }),
          }).pipe(Effect.andThen(Ref.set(registered, false)), Effect.orDie),
      );
    },
  );

  return ElectronProtocol.of({ registerDesktopProtocol });
});

export const layer = Layer.effect(ElectronProtocol, make);
