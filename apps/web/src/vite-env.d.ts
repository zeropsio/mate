/// <reference types="vite-plus/client" />

import type { DesktopBridge } from "@t3tools/contracts";

interface ImportMetaEnv {
  readonly VITE_HTTP_URL: string;
  readonly VITE_WS_URL: string;
  readonly VITE_HOSTED_APP_URL: string;
  readonly VITE_HOSTED_APP_CHANNEL: string;
  readonly VITE_RELAY_OTLP_TRACES_URL: string;
  readonly VITE_RELAY_OTLP_TRACES_DATASET: string;
  readonly VITE_RELAY_OTLP_TRACES_TOKEN: string;
  /** The Zerops app every Zerops link and the sign-in hand-over go to; `https://app.zerops.io` when unset. */
  readonly VITE_ZEROPS_APP_URL?: string;
  /** The Zerops API this build talks to; prg1's when unset. */
  readonly VITE_ZEROPS_API_URL?: string;
  /** The way in: `handover` (the default) or `zerops-hq` (`zerops/zeropsHq.ts`). */
  readonly VITE_ZEROPS_SIGN_IN?: string;
  /** Zerops HQ, whose session a `zerops-hq` build shares; `https://hq.zerops.io` when unset. */
  readonly VITE_ZEROPS_HQ_ORIGIN?: string;
  /** The one HQ every organization signs in to (`zerops/accountHq.ts` `configuredHq`). */
  readonly VITE_HQ_ORIGIN: string;
  /** The login app Zerops HQ's device login asks for, where its bridge refuses this origin; `mate` when unset. */
  readonly VITE_ZEROPS_LOGIN_APP_CODE?: string;
  /** The Adobe Express Embed SDK's API key (`components/express/expressSdk.ts`); no Express panel when unset. */
  readonly VITE_ADOBE_EXPRESS_CLIENT_ID?: string;
  /** `app-shell` ships and registers the hosted client's worker, `retire` its kill switch (`appShell/`). */
  readonly VITE_APP_SHELL_WORKER: string;
  readonly APP_VERSION: string;
  /** The commit the bundle was built from; empty outside a git checkout. */
  readonly APP_COMMIT: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare global {
  interface Window {
    desktopBridge?: DesktopBridge;
  }
}
