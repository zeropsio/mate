/**
 * Adobe Express Embed SDK v4, loaded from Adobe the first time a panel asks for it: the editor runs
 * in Adobe's own frame inside the panel, and what a person saves comes back as a picture.
 * https://developer.adobe.com/express/embed-sdk/docs/guides/quickstart/
 *
 * Adobe serves the editor only on the domains listed for the API key, over HTTPS (localhost
 * allowed), and shows a red "not approved yet" bar until Adobe approves the integration.
 */
import { expressPictureName } from "./expressHistory.logic";

const SDK_URL = "https://cc-embed.adobe.com/sdk/v4/CCEverywhere.js";

/** The build's Adobe Express API key; without one the panel is hidden. */
export const expressClientId = import.meta.env.VITE_ADOBE_EXPRESS_CLIENT_ID?.trim() || null;

export interface ExpressPublishParams {
  /** The saved design's id, which reopens it as a design rather than a flat picture. */
  readonly projectId?: string;
  readonly asset: ReadonlyArray<{ readonly data: Blob | string; readonly fileType?: string }>;
}

export interface ExpressCallbacks {
  readonly onPublish: (intent: unknown, params: ExpressPublishParams) => void;
  readonly onCancel: () => void;
  readonly onError: (error: unknown) => void;
}

type ExportOption = Record<string, unknown>;
type ContainerConfig = { readonly mode: "inline" | "fill"; readonly parentElementId: string };
type AppConfig = { readonly callbacks: ExpressCallbacks } & Record<string, unknown>;

interface ExpressSdk {
  readonly editor: {
    create(doc: object, app: AppConfig, exports: ExportOption[], container: ContainerConfig): void;
    edit(doc: object, app: AppConfig, exports: ExportOption[], container: ContainerConfig): void;
  };
  readonly module: {
    editImage(
      doc: object,
      app: AppConfig,
      exports: ExportOption[],
      container: ContainerConfig,
    ): void;
    createImageFromText(app: AppConfig, exports: ExportOption[], container: ContainerConfig): void;
  };
}

declare global {
  interface Window {
    CCEverywhere?: {
      initialize(
        host: { clientId: string; appName: string },
        config: { loginMode: "delayed" },
      ): Promise<ExpressSdk>;
      terminate(): void | Promise<void>;
    };
  }
}

let sdk: Promise<ExpressSdk> | null = null;

/** The SDK, initialized once per page; a failed load is forgotten so the next ask tries again. */
export function loadExpress(clientId: string): Promise<ExpressSdk> {
  sdk ??= (async () => {
    await import(/* @vite-ignore */ SDK_URL);
    const everywhere = window.CCEverywhere;
    if (everywhere === undefined) throw new Error("Adobe Express did not load.");
    // Sign-in waits until the person saves: they can look and edit first.
    return everywhere.initialize({ clientId, appName: "Mate" }, { loginMode: "delayed" });
  })().catch((error: unknown) => {
    sdk = null;
    throw error;
  });
  return sdk;
}

/** Ends the open Express session, which allows one editor at a time; the next ask starts afresh. */
export async function resetExpress(): Promise<void> {
  if (sdk === null) return;
  sdk = null;
  await window.CCEverywhere?.terminate();
}

/** What every flow offers when it is done: the picture into the message, or a download. */
export const EXPRESS_EXPORTS: ExportOption[] = [
  {
    id: "attach",
    label: "Add to message",
    action: {
      target: "publish",
      publishFileType: "image/png",
      outputType: "blob",
      closeTargetOnExport: true,
    },
    style: { uiType: "button" },
  },
  {
    id: "download",
    label: "Download",
    action: { target: "download" },
    style: { uiType: "button" },
  },
];

/** A base64 data address as its bytes; anything else (a remote URL) as `null`. */
function dataUrlBlob(url: string): Blob | null {
  const match = /^data:([^;,]+);base64,(.*)$/su.exec(url);
  if (match === null) return null;
  const bytes = Uint8Array.from(atob(match[2] ?? ""), (char) => char.charCodeAt(0));
  return new Blob([bytes], { type: match[1] ?? "" });
}

/**
 * A saved asset as a picture file the composer takes like a pasted one. `EXPRESS_EXPORTS` asks for a
 * blob; a flow that answers with base64 is decoded here.
 */
export function expressAssetFile(params: ExpressPublishParams): File | null {
  const asset = params.asset[0];
  if (asset === undefined) return null;
  const blob = typeof asset.data === "string" ? dataUrlBlob(asset.data) : asset.data;
  if (blob === null) return null;
  const type = blob.type || asset.fileType || "image/png";
  const extension = type === "image/jpeg" ? "jpg" : (type.split("/")[1] ?? "png");
  return new File([blob], expressPictureName(params.projectId, extension, Date.now()), { type });
}
