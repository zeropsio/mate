import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
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

/**
 * The scheme's one page: shown when the window can't reach `applicationUrl`
 * (see `renderOfflineFallbackPage`). Unlike the origin the shell used to
 * serve its own client from, this URL never carries the app itself anymore —
 * see `DesktopEnvironment.applicationUrl`.
 */
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

export interface DesktopProtocolRegistrationInput {
  readonly scheme: string;
  /** The URL the offline page's Retry link sends the window back to. */
  readonly applicationUrl: string;
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

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/**
 * The scheme's only page. A main-frame load of `applicationUrl` can fail —
 * no network, a hosted deployment that is briefly down — and a blank window
 * is the worst answer to that, so `DesktopWindow` sends the failed window
 * here instead. The Retry link is a plain anchor back to `applicationUrl`:
 * clicking it is an ordinary same-origin-to-itself navigation, which
 * `isInWindowRendererNavigation` already lets proceed in-window, so no IPC
 * bridge is needed to wire retry up.
 */
export function renderOfflineFallbackPage(input: { readonly applicationUrl: string }): string {
  const host = escapeHtml(hostOf(input.applicationUrl));
  const retryHref = escapeHtml(input.applicationUrl);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Zerops Mate</title>
<style>
  :root { color-scheme: light dark; }
  html, body {
    height: 100%;
    margin: 0;
  }
  body {
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    background: #ffffff;
    color: #1f2937;
  }
  @media (prefers-color-scheme: dark) {
    body { background: #0a0a0a; color: #f8fafc; }
    .retry { background: #f8fafc; color: #0a0a0a; }
  }
  .card {
    max-width: 320px;
    padding: 32px;
    text-align: center;
  }
  h1 {
    margin: 0 0 8px;
    font-size: 15px;
    font-weight: 600;
  }
  p {
    margin: 0 0 20px;
    font-size: 13px;
    line-height: 1.5;
    opacity: 0.65;
  }
  .retry {
    display: inline-block;
    padding: 8px 20px;
    border-radius: 6px;
    background: #1f2937;
    color: #ffffff;
    font-size: 13px;
    font-weight: 500;
    text-decoration: none;
  }
</style>
</head>
<body>
  <div class="card">
    <h1>Can't reach ${host}</h1>
    <p>Zerops Mate couldn't load. Check your connection, then try again.</p>
    <a class="retry" href="${retryHref}">Retry</a>
  </div>
</body>
</html>
`;
}

function serveOfflineFallbackPage(
  applicationUrl: string,
  contentSecurityPolicy: string,
): (request: Request) => Promise<Response> {
  const body = renderOfflineFallbackPage({ applicationUrl });
  return async (request) => {
    const requestUrl = new URL(request.url);
    if (requestUrl.host !== DESKTOP_HOST) {
      return new Response(null, { status: 404 });
    }
    return withContentSecurityPolicy(
      new Response(body, {
        status: 200,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      }),
      contentSecurityPolicy,
    );
  };
}

export const make = Effect.gen(function* () {
  const registered = yield* Ref.make(false);

  const registerDesktopProtocol = Effect.fn("desktop.electron.protocol.registerDesktopProtocol")(
    function* (input: DesktopProtocolRegistrationInput) {
      if (yield* Ref.get(registered)) return;

      const contentSecurityPolicy = makeDesktopContentSecurityPolicy({ scheme: input.scheme });
      const handler = serveOfflineFallbackPage(input.applicationUrl, contentSecurityPolicy);

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
