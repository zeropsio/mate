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
  /** The Zerops app the sign-in hand-over goes to; `https://app.zerops.io` when unset. */
  readonly VITE_ZEROPS_APP_URL?: string;
  /** The way in: `handover` (the default) or `device-login` (`zerops/deviceLogin.ts`). */
  readonly VITE_ZEROPS_SIGN_IN?: string;
  /** Swaps the device login's consent page origin, e.g. a local HQ; the API's link when unset. */
  readonly VITE_ZEROPS_CONSENT_ORIGIN?: string;
  /** The one HQ every organization signs in to (`zerops/accountHq.ts` `configuredHq`). */
  readonly VITE_HQ_ORIGIN: string;
  /** The login app the consent page asks for; `mate` when unset. */
  readonly VITE_ZEROPS_LOGIN_APP_CODE?: string;
  readonly APP_VERSION: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare global {
  interface Window {
    desktopBridge?: DesktopBridge;
  }
}
