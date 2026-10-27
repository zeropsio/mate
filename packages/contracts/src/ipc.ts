import * as Schema from "effect/Schema";
import { EnvironmentId } from "./baseSchemas.ts";
import type { ClientSettings } from "./settings.ts";
import type { EditorId } from "./editor.ts";

export interface ContextMenuItem<T extends string = string> {
  id: T;
  label: string;
  destructive?: boolean;
  disabled?: boolean;
  /** Renders as a non-interactive section header label. Web fallback only — stripped on desktop native menus. */
  header?: boolean;
  /** Icon keyword resolved by the web fallback. Stripped on desktop native menus. */
  icon?: string;
  /** Inserts a visual section divider immediately before this item. */
  separatorBefore?: boolean;
  /** Shows a check mark. Used to mark the current option inside a submenu. */
  checked?: boolean;
  children?: readonly ContextMenuItem<T>[];
}

export interface ContextMenuItemSchemaType {
  readonly id: string;
  readonly label: string;
  readonly destructive?: boolean;
  readonly disabled?: boolean;
  readonly header?: boolean;
  readonly icon?: string;
  readonly separatorBefore?: boolean;
  readonly checked?: boolean;
  readonly children?: readonly ContextMenuItemSchemaType[];
}

export const ContextMenuItemSchema: Schema.Codec<ContextMenuItemSchemaType> = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  destructive: Schema.optionalKey(Schema.Boolean),
  disabled: Schema.optionalKey(Schema.Boolean),
  header: Schema.optionalKey(Schema.Boolean),
  icon: Schema.optionalKey(Schema.String),
  separatorBefore: Schema.optionalKey(Schema.Boolean),
  checked: Schema.optionalKey(Schema.Boolean),
  children: Schema.optionalKey(
    Schema.Array(
      Schema.suspend((): Schema.Codec<ContextMenuItemSchemaType> => ContextMenuItemSchema),
    ),
  ),
});

export type DesktopUpdateStatus =
  | "disabled"
  | "idle"
  | "checking"
  | "up-to-date"
  | "available"
  | "downloading"
  | "downloaded"
  | "error";

export type DesktopRuntimeArch = "arm64" | "x64" | "other";
export type DesktopTheme = "light" | "dark" | "system";
export type DesktopUpdateChannel = "latest" | "nightly";
export type DesktopAppStageLabel = "Alpha" | "Dev" | "Nightly";

export const DesktopUpdateStatusSchema = Schema.Literals([
  "disabled",
  "idle",
  "checking",
  "up-to-date",
  "available",
  "downloading",
  "downloaded",
  "error",
]);
export const DesktopRuntimeArchSchema = Schema.Literals(["arm64", "x64", "other"]);
export const DesktopThemeSchema = Schema.Literals(["light", "dark", "system"]);
export const DesktopUpdateChannelSchema = Schema.Literals(["latest", "nightly"]);
export const DesktopAppStageLabelSchema = Schema.Literals(["Alpha", "Dev", "Nightly"]);

export interface DesktopAppBranding {
  baseName: string;
  stageLabel: DesktopAppStageLabel;
  displayName: string;
}

export const DesktopAppBrandingSchema = Schema.Struct({
  baseName: Schema.String,
  stageLabel: DesktopAppStageLabelSchema,
  displayName: Schema.String,
});

export interface DesktopRuntimeInfo {
  hostArch: DesktopRuntimeArch;
  appArch: DesktopRuntimeArch;
  runningUnderArm64Translation: boolean;
}

export const DesktopRuntimeInfoSchema = Schema.Struct({
  hostArch: DesktopRuntimeArchSchema,
  appArch: DesktopRuntimeArchSchema,
  runningUnderArm64Translation: Schema.Boolean,
});

export interface DesktopUpdateState {
  enabled: boolean;
  status: DesktopUpdateStatus;
  channel: DesktopUpdateChannel;
  currentVersion: string;
  hostArch: DesktopRuntimeArch;
  appArch: DesktopRuntimeArch;
  runningUnderArm64Translation: boolean;
  availableVersion: string | null;
  downloadedVersion: string | null;
  releaseNotes: ReadonlyArray<DesktopUpdateReleaseNote>;
  downloadPercent: number | null;
  checkedAt: string | null;
  message: string | null;
  errorContext: "check" | "download" | "install" | null;
  canRetry: boolean;
}

export interface DesktopUpdateReleaseNote {
  version: string;
  items: ReadonlyArray<string>;
}

export const DesktopUpdateReleaseNoteSchema = Schema.Struct({
  version: Schema.String,
  items: Schema.Array(Schema.String),
});

export const DesktopUpdateStateSchema = Schema.Struct({
  enabled: Schema.Boolean,
  status: DesktopUpdateStatusSchema,
  channel: DesktopUpdateChannelSchema,
  currentVersion: Schema.String,
  hostArch: DesktopRuntimeArchSchema,
  appArch: DesktopRuntimeArchSchema,
  runningUnderArm64Translation: Schema.Boolean,
  availableVersion: Schema.NullOr(Schema.String),
  downloadedVersion: Schema.NullOr(Schema.String),
  releaseNotes: Schema.Array(DesktopUpdateReleaseNoteSchema),
  downloadPercent: Schema.NullOr(Schema.Number),
  checkedAt: Schema.NullOr(Schema.String),
  message: Schema.NullOr(Schema.String),
  errorContext: Schema.NullOr(Schema.Literals(["check", "download", "install"])),
  canRetry: Schema.Boolean,
});

export interface DesktopUpdateActionResult {
  accepted: boolean;
  completed: boolean;
  state: DesktopUpdateState;
}

export const DesktopUpdateActionResultSchema = Schema.Struct({
  accepted: Schema.Boolean,
  completed: Schema.Boolean,
  state: DesktopUpdateStateSchema,
});

export interface DesktopUpdateCheckResult {
  checked: boolean;
  state: DesktopUpdateState;
}

export const DesktopUpdateCheckResultSchema = Schema.Struct({
  checked: Schema.Boolean,
  state: DesktopUpdateStateSchema,
});

/**
 * The Zerops sign-in, run out-of-window in the system browser. The main process runs one of two
 * modes, by its own setting:
 *
 * - the hand-over: the renderer mints a nonce (`state`), the main process opens the platform's
 *   authorize URL and listens on a loopback port for the redirect back, and answers the callback
 *   fragment for the renderer to verify (`packages/client-runtime/src/zerops/handover.ts`);
 * - device login: the main process starts a request on the API, opens its consent page, pushes
 *   the request's user code (`DesktopZeropsSignInProgress`, tagged with `state`) and polls until
 *   the person decides, answering the approved session itself
 *   (`packages/client-runtime/src/zerops/deviceLogin.ts`).
 */
export interface DesktopZeropsSignInInput {
  /** The nonce the renderer minted and is holding, to check the callback against. */
  state: string;
  intent?: "register" | undefined;
}

export const DesktopZeropsSignInInputSchema = Schema.Struct({
  state: Schema.String.check(Schema.isTrimmed()).check(Schema.isNonEmpty()),
  intent: Schema.optional(Schema.Literal("register")),
});

/** The session an approved device login answers: the platform's login shape. */
export interface DesktopZeropsSession {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: string;
  expiresIn?: number;
  userId?: string;
  tokenType?: string;
  twoFAMethods?: ReadonlyArray<string>;
  twoFAVerified?: boolean;
}

export const DesktopZeropsSessionSchema = Schema.Struct({
  accessToken: Schema.String.check(Schema.isNonEmpty()),
  refreshToken: Schema.optionalKey(Schema.String),
  expiresAt: Schema.optionalKey(Schema.String),
  expiresIn: Schema.optionalKey(Schema.Number),
  userId: Schema.optionalKey(Schema.String),
  tokenType: Schema.optionalKey(Schema.String),
  twoFAMethods: Schema.optionalKey(Schema.Array(Schema.String)),
  twoFAVerified: Schema.optionalKey(Schema.Boolean),
});

export type DesktopZeropsSignInResult =
  /** The platform redirected back with a callback fragment for the renderer to verify. */
  | { kind: "callback"; fragment: string }
  /** A device login the person approved: the session to adopt. */
  | { kind: "session"; session: DesktopZeropsSession }
  /** A device login the person denied on the consent page. */
  | { kind: "denied" }
  /** A device login nobody decided before the platform forgot it. */
  | { kind: "expired" }
  /** The platform refused to start or check a device login, in its words. */
  | { kind: "failed"; message: string }
  /** Timed out, or the window closed (or a newer attempt began) before the browser came back. */
  | { kind: "cancelled" };

export const DesktopZeropsSignInResultSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("callback"), fragment: Schema.String }),
  Schema.Struct({ kind: Schema.Literal("session"), session: DesktopZeropsSessionSchema }),
  Schema.Struct({ kind: Schema.Literal("denied") }),
  Schema.Struct({ kind: Schema.Literal("expired") }),
  Schema.Struct({ kind: Schema.Literal("failed"), message: Schema.String }),
  Schema.Struct({ kind: Schema.Literal("cancelled") }),
]);

/** A device login's request is open: the code its consent page shows, for the person to compare. */
export interface DesktopZeropsSignInProgress {
  /** The attempt's nonce, as `DesktopZeropsSignInInput.state` carried it. */
  state: string;
  userCode: string;
}

export const DesktopZeropsSignInProgressSchema = Schema.Struct({
  state: Schema.String.check(Schema.isNonEmpty()),
  userCode: Schema.String.check(Schema.isNonEmpty()),
});

// Stable id for the historical same-origin "primary" local environment
// (Windows-native backend in the T3-upstream desktop, or a self-hosted web
// deployment's own origin). Not desktop-bridge specific — it is a cache/map
// key shared by the primary-environment resolvers regardless of which
// concrete transport backs "primary" for a given build.
export const PRIMARY_LOCAL_ENVIRONMENT_ID = "primary";

export interface DesktopEnvironmentBootstrap {
  id: string;
  label: string;
  runningDistro?: string | null;
  httpBaseUrl: string | null;
  wsBaseUrl: string | null;
  bootstrapToken?: string;
}

export const DesktopEnvironmentBootstrapSchema = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  runningDistro: Schema.optionalKey(Schema.NullOr(Schema.String)),
  httpBaseUrl: Schema.NullOr(Schema.String),
  wsBaseUrl: Schema.NullOr(Schema.String),
  bootstrapToken: Schema.optionalKey(Schema.String),
});

export const DesktopSshEnvironmentTargetSchema = Schema.Struct({
  alias: Schema.String,
  hostname: Schema.String,
  username: Schema.NullOr(Schema.String),
  port: Schema.NullOr(Schema.Number),
});
export type DesktopSshEnvironmentTarget = typeof DesktopSshEnvironmentTargetSchema.Type;

/**
 * The provisioning result of an SSH-reachable environment. Not desktop-bridge
 * specific: it is the shared shape `SshEnvironmentGateway` implementations
 * (mobile's native SSH client included) return through `packages/client-runtime`.
 */
export interface DesktopSshEnvironmentBootstrap {
  target: DesktopSshEnvironmentTarget;
  httpBaseUrl: string;
  wsBaseUrl: string;
  pairingToken: string | null;
  remotePort?: number;
  remoteServerKind?: "external" | "managed";
}

export const DesktopSshEnvironmentBootstrapSchema = Schema.Struct({
  target: DesktopSshEnvironmentTargetSchema,
  httpBaseUrl: Schema.String,
  wsBaseUrl: Schema.String,
  pairingToken: Schema.NullOr(Schema.String),
  remotePort: Schema.optionalKey(Schema.Number),
  remoteServerKind: Schema.optionalKey(Schema.Literals(["external", "managed"])),
});

export const PersistedSavedEnvironmentRecordSchema = Schema.Struct({
  environmentId: EnvironmentId,
  label: Schema.String,
  wsBaseUrl: Schema.String,
  httpBaseUrl: Schema.String,
  createdAt: Schema.String,
  lastConnectedAt: Schema.NullOr(Schema.String),
  desktopSsh: Schema.optionalKey(DesktopSshEnvironmentTargetSchema),
  relayManaged: Schema.optionalKey(
    Schema.Struct({
      relayUrl: Schema.String,
    }),
  ),
});
export type PersistedSavedEnvironmentRecord = typeof PersistedSavedEnvironmentRecordSchema.Type;

/**
 * A file returned by the desktop theme-file picker. Oversized files carry an
 * empty text so the renderer can reject them by size without the main
 * process ever holding their contents.
 */
export interface PickedThemeFile {
  name: string;
  size: number;
  text: string;
}

export const PickedThemeFileSchema = Schema.Struct({
  name: Schema.String,
  size: Schema.Number,
  text: Schema.String,
});

export interface DesktopBridge {
  getAppBranding: () => DesktopAppBranding | null;
  /** The desktop client's OS platform, read from Electron's preload process. */
  getClientPlatform?: () => string;
  setNotificationBadge?: (badge: { count: number; image: string | null }) => Promise<void>;
  onNotificationBadgeClear?: (listener: () => void) => () => void;
  /**
   * The OS locale as a BCP-47 tag, which the renderer cannot read for itself:
   * the packaged app ships only the `en-US` Chromium locale pak, so
   * `navigator.language` and the default `Intl` locale are pinned to `en-US`
   * regardless of OS settings.
   */
  getSystemLocale?: () => string | null;
  getClientSettings: () => Promise<ClientSettings | null>;
  setClientSettings: (settings: ClientSettings) => Promise<void>;
  getConnectionCatalog?: () => Promise<string | null>;
  setConnectionCatalog?: (catalog: string) => Promise<boolean>;
  clearConnectionCatalog?: () => Promise<void>;
  /**
   * Multi-select JSON file picker that opens in the VS Code extensions
   * directory when one exists. Optional: older desktop builds lack it, and
   * web callers fall back to a plain file input.
   */
  pickThemeFiles?: () => Promise<readonly PickedThemeFile[] | null>;
  setTheme: (theme: DesktopTheme) => Promise<void>;
  showContextMenu: <T extends string>(
    items: readonly ContextMenuItem<T>[],
    position?: { x: number; y: number },
  ) => Promise<T | null>;
  openExternal: (url: string) => Promise<boolean>;
  /**
   * Probe this desktop machine for installed remote-capable editor CLIs
   * (used for remote open-in-editor deep links). Optional: older desktop
   * builds lack it; callers fall back to VS Code only.
   */
  probeRemoteEditors?: () => Promise<readonly EditorId[]>;
  onMenuAction: (listener: (action: string) => void) => () => void;
  /**
   * Hold-to-quit hint pushes: "down" when the quit shortcut is first pressed,
   * "up" when it is released before the hold completes. Optional: older
   * desktop builds never emit it.
   */
  onQuitShortcut?: (listener: (state: "down" | "up") => void) => () => void;
  getWindowFullscreenState: () => boolean;
  onWindowFullscreenStateChange: (listener: (fullscreen: boolean) => void) => () => void;
  getUpdateState: () => Promise<DesktopUpdateState>;
  setUpdateChannel: (channel: DesktopUpdateChannel) => Promise<DesktopUpdateState>;
  checkForUpdate: () => Promise<DesktopUpdateCheckResult>;
  downloadUpdate: () => Promise<DesktopUpdateActionResult>;
  installUpdate: () => Promise<DesktopUpdateActionResult>;
  onUpdateState: (listener: (state: DesktopUpdateState) => void) => () => void;
  /**
   * Runs the Zerops sign-in in the system browser instead of the app window,
   * in the main process's mode (`DesktopZeropsSignInInput`): the hand-over
   * resolves with the callback fragment, device login with the approved
   * session or how it ended; either resolves `cancelled` on timeout or an
   * abandoned window. Optional: older desktop builds lack it, and callers fall back to
   * navigating the app window itself.
   */
  zeropsSignIn?: (input: DesktopZeropsSignInInput) => Promise<DesktopZeropsSignInResult>;
  /**
   * A device-login attempt's user code, pushed once its request is open and before its result.
   * Optional: older desktop builds run the hand-over only.
   */
  onZeropsSignInProgress?: (
    listener: (progress: DesktopZeropsSignInProgress) => void,
  ) => () => void;
}

export type ConfirmDialogVariant = "default" | "destructive";

export interface ConfirmDialogOptions {
  readonly variant?: ConfirmDialogVariant;
}

/**
 * APIs bound to the local app shell, not to any particular backend environment.
 *
 * These capabilities describe the desktop/browser host that the user is
 * currently running: dialogs, external-link opening, context menus, and
 * app-level settings/config access. They must not be used as a proxy for
 * "whatever environment the user is targeting", because in a multi-environment
 * world the local shell and a selected backend environment are distinct
 * concepts.
 */
export interface LocalApi {
  dialogs: {
    confirm: (message: string, options?: ConfirmDialogOptions) => Promise<boolean>;
  };
  shell: {
    openExternal: (url: string) => Promise<void>;
  };
  contextMenu: {
    show: <T extends string>(
      items: readonly ContextMenuItem<T>[],
      position?: { x: number; y: number },
    ) => Promise<T | null>;
    close: () => Promise<void>;
  };
  persistence: {
    getClientSettings: () => Promise<ClientSettings | null>;
    setClientSettings: (settings: ClientSettings) => Promise<void>;
  };
}
