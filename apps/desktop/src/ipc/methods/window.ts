import {
  ContextMenuItemSchema,
  DesktopAppBrandingSchema,
  DesktopThemeSchema,
  EDITORS,
  EditorId,
  PickedThemeFileSchema,
  REMOTE_CAPABLE_EDITOR_IDS,
  type PickedThemeFile,
} from "@t3tools/contracts";
import { resolveEditorCommand } from "@t3tools/shared/editor";
import * as HostProcess from "@t3tools/shared/hostProcess";
import * as NodeOS from "node:os";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import * as DesktopEnvironment from "../../app/DesktopEnvironment.ts";
import * as ElectronApp from "../../electron/ElectronApp.ts";
import * as ElectronDialog from "../../electron/ElectronDialog.ts";
import * as ElectronMenu from "../../electron/ElectronMenu.ts";
import * as ElectronShell from "../../electron/ElectronShell.ts";
import * as ElectronTheme from "../../electron/ElectronTheme.ts";
import * as ElectronWindow from "../../electron/ElectronWindow.ts";
import * as IpcChannels from "../channels.ts";
import * as DesktopIpc from "../DesktopIpc.ts";

const ContextMenuPosition = Schema.Struct({
  x: Schema.Number,
  y: Schema.Number,
});

const ContextMenuInput = Schema.Struct({
  items: Schema.Array(ContextMenuItemSchema),
  position: Schema.optionalKey(ContextMenuPosition),
});

export const getAppBranding = DesktopIpc.makeSyncIpcMethod({
  channel: IpcChannels.GET_APP_BRANDING_CHANNEL,
  result: Schema.NullOr(DesktopAppBrandingSchema),
  handler: Effect.fn("desktop.ipc.window.getAppBranding")(function* () {
    const environment = yield* DesktopEnvironment.DesktopEnvironment;
    return environment.branding;
  }),
});

export const getSystemLocale = DesktopIpc.makeSyncIpcMethod({
  channel: IpcChannels.GET_SYSTEM_LOCALE_CHANNEL,
  result: Schema.String,
  handler: Effect.fn("desktop.ipc.window.getSystemLocale")(function* () {
    const electronApp = yield* ElectronApp.ElectronApp;
    return yield* electronApp.systemLocale;
  }),
});

export const getWindowFullscreenState = DesktopIpc.makeSyncIpcMethod({
  channel: IpcChannels.GET_WINDOW_FULLSCREEN_STATE_CHANNEL,
  result: Schema.Boolean,
  handler: Effect.fn("desktop.ipc.window.getWindowFullscreenState")(function* () {
    const electronWindow = yield* ElectronWindow.ElectronWindow;
    const window = yield* electronWindow.currentMainOrFirst;
    return Option.isSome(window) && window.value.isFullScreen();
  }),
});

export const setTheme = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.SET_THEME_CHANNEL,
  payload: DesktopThemeSchema,
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.window.setTheme")(function* (theme) {
    const electronTheme = yield* ElectronTheme.ElectronTheme;
    yield* electronTheme.setSource(theme);
  }),
});

export const showContextMenu = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.CONTEXT_MENU_CHANNEL,
  payload: ContextMenuInput,
  result: Schema.NullOr(Schema.String),
  handler: Effect.fn("desktop.ipc.window.showContextMenu")(function* (input) {
    const electronMenu = yield* ElectronMenu.ElectronMenu;
    const electronWindow = yield* ElectronWindow.ElectronWindow;
    const window = yield* electronWindow.focusedMainOrFirst;
    if (Option.isNone(window)) {
      return null;
    }

    const selectedItemId = yield* electronMenu.showContextMenu({
      window: window.value,
      items: input.items,
      position: Option.fromNullishOr(input.position),
    });
    return Option.getOrNull(selectedItemId);
  }),
});

export const openExternal = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.OPEN_EXTERNAL_CHANNEL,
  payload: Schema.String,
  result: Schema.Boolean,
  handler: Effect.fn("desktop.ipc.window.openExternal")(function* (url) {
    const shell = yield* ElectronShell.ElectronShell;
    return yield* shell.openExternal(url);
  }),
});

export const probeRemoteEditors = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.PROBE_REMOTE_EDITORS_CHANNEL,
  payload: Schema.Undefined,
  result: Schema.Array(EditorId),
  handler: Effect.fn("desktop.ipc.window.probeRemoteEditors")(function* () {
    const available: Array<EditorId> = [];
    const env = yield* HostProcess.HostProcessEnvironment;
    for (const editorId of REMOTE_CAPABLE_EDITOR_IDS) {
      const editor = EDITORS.find((editor) => editor.id === editorId);
      if (editor && Option.isSome(yield* resolveEditorCommand(editor, env))) {
        available.push(editorId);
      }
    }
    return available;
  }),
});

/** Theme files are a few KB; anything larger returns empty text and lets the
 *  renderer reject it by size without the contents ever crossing the bridge. */
const PICKED_THEME_FILE_MAX_BYTES = 256 * 1024;

export const pickThemeFiles = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.PICK_THEME_FILES_CHANNEL,
  payload: Schema.Undefined,
  result: Schema.NullOr(Schema.Array(PickedThemeFileSchema)),
  handler: Effect.fn("desktop.ipc.window.pickThemeFiles")(function* () {
    const dialog = yield* ElectronDialog.ElectronDialog;
    const electronWindow = yield* ElectronWindow.ElectronWindow;
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    // The VS Code extensions directory is the same dotfolder on Windows,
    // macOS, and Linux; when it is missing the picker opens wherever the
    // platform would by default.
    const extensionsDir = path.join(NodeOS.homedir(), ".vscode", "extensions");
    const defaultPath = yield* fileSystem
      .exists(extensionsDir)
      .pipe(Effect.orElseSucceed(() => false));
    const paths = yield* dialog.pickFiles({
      owner: yield* electronWindow.focusedMainOrFirst,
      defaultPath: defaultPath ? Option.some(extensionsDir) : Option.none(),
      filters: [{ name: "JSON", extensions: ["json"] }],
      multiple: true,
    });
    if (paths.length === 0) {
      return null;
    }
    return yield* Effect.forEach(paths, (filePath) => {
      const name = path.basename(filePath);
      return Effect.gen(function* () {
        const info = yield* fileSystem.stat(filePath);
        const size = Number(info.size);
        if (size > PICKED_THEME_FILE_MAX_BYTES) {
          return { name, size, text: "" } satisfies PickedThemeFile;
        }
        const text = yield* fileSystem.readFileString(filePath);
        return { name, size, text } satisfies PickedThemeFile;
      }).pipe(
        // An unreadable file degrades to an entry the renderer reports.
        Effect.orElseSucceed((): PickedThemeFile => ({ name, size: 0, text: "" })),
      );
    });
  }),
});
