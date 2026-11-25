import { writeBrowserStorage } from "../lib/storage";
import type { DesktopBridge } from "@t3tools/contracts";
import { safeErrorLogAttributes } from "@t3tools/client-runtime/errors";
import * as Schema from "effect/Schema";
import type { ThemeAppearance } from "@t3tools/shared/themePalettes";
import { useCallback, useEffect, useSyncExternalStore } from "react";

export const THEME_APPEARANCE_MODE_STORAGE_KEY = "t3code:theme-appearance-mode";

export type ThemePreferenceMode = ThemeAppearance | "system";

type ThemeSnapshot = {
  systemDark: boolean;
  appearanceMode: ThemePreferenceMode;
};

type DesktopThemeBridge = Pick<DesktopBridge, "setTheme">;

const MEDIA_QUERY = "(prefers-color-scheme: dark)";
const DEFAULT_THEME_SNAPSHOT: ThemeSnapshot = {
  systemDark: false,
  appearanceMode: "system",
};

const THEME_COLOR_META_NAME = "theme-color";
const DYNAMIC_THEME_COLOR_SELECTOR = `meta[name="${THEME_COLOR_META_NAME}"][data-dynamic-theme-color="true"]`;

export class ThemeStorageError extends Schema.TaggedError<ThemeStorageError>()(
  "ThemeStorageError",
  {
    operation: Schema.Literals(["read", "write"]),
    storageKey: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to ${this.operation} the appearance for ${this.storageKey}.`;
  }
}

export const isThemeStorageError = Schema.is(ThemeStorageError);

export class DesktopThemeSyncError extends Schema.TaggedError<DesktopThemeSyncError>()(
  "DesktopThemeSyncError",
  {
    mode: Schema.Literals(["light", "dark", "system"]),
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to sync the ${this.mode} appearance to the desktop shell.`;
  }
}

export const isDesktopThemeSyncError = Schema.is(DesktopThemeSyncError);

let listeners: Array<() => void> = [];
let lastSnapshot: ThemeSnapshot | null = null;
let snapshotStale = true;
let lastDesktopTheme: ThemePreferenceMode | null = null;
let lastAppliedTheme: ThemeSnapshot | null = null;

function emitChange() {
  snapshotStale = true;
  for (const listener of listeners) listener();
}

function getSystemDark() {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia(MEDIA_QUERY).matches
  );
}

function isThemePreferenceMode(value: string | null): value is ThemePreferenceMode {
  return value === "light" || value === "dark" || value === "system";
}

/** The stored appearance; nothing stored, or storage unavailable, follows the system. */
export function readAppearanceModePreference(): ThemePreferenceMode {
  if (typeof window === "undefined") return DEFAULT_THEME_SNAPSHOT.appearanceMode;
  try {
    const raw = window.localStorage.getItem(THEME_APPEARANCE_MODE_STORAGE_KEY);
    if (isThemePreferenceMode(raw)) return raw;
  } catch {
    // Unreadable storage falls back to following the system.
  }
  return DEFAULT_THEME_SNAPSHOT.appearanceMode;
}

export function writeAppearanceModePreference(appearanceMode: ThemePreferenceMode): void {
  if (typeof window === "undefined") return;
  try {
    writeBrowserStorage(window.localStorage, THEME_APPEARANCE_MODE_STORAGE_KEY, appearanceMode);
  } catch (cause) {
    throw new ThemeStorageError({
      operation: "write",
      storageKey: THEME_APPEARANCE_MODE_STORAGE_KEY,
      cause,
    });
  }
}

function ensureThemeColorMetaTag(): HTMLMetaElement {
  let element = document.querySelector<HTMLMetaElement>(DYNAMIC_THEME_COLOR_SELECTOR);
  if (element) {
    return element;
  }

  element = document.createElement("meta");
  element.name = THEME_COLOR_META_NAME;
  element.setAttribute("data-dynamic-theme-color", "true");
  document.head.append(element);
  return element;
}

function normalizeThemeColor(value: string | null | undefined): string | null {
  const normalizedValue = value?.trim().toLowerCase();
  if (
    !normalizedValue ||
    normalizedValue === "transparent" ||
    normalizedValue === "rgba(0, 0, 0, 0)" ||
    normalizedValue === "rgba(0 0 0 / 0)"
  ) {
    return null;
  }

  return value?.trim() ?? null;
}

function resolveBrowserChromeSurface(): HTMLElement {
  return (
    document.querySelector<HTMLElement>("main[data-slot='sidebar-inset']") ??
    document.querySelector<HTMLElement>("[data-slot='sidebar-inner']") ??
    document.body
  );
}

export function syncBrowserChromeTheme() {
  if (typeof document === "undefined" || typeof getComputedStyle === "undefined") return;
  const rootStyles = getComputedStyle(document.documentElement);
  const themeChromeColor = normalizeThemeColor(
    rootStyles.getPropertyValue("--app-chrome-background"),
  );
  const surfaceColor = normalizeThemeColor(
    getComputedStyle(resolveBrowserChromeSurface()).backgroundColor,
  );
  const fallbackColor = normalizeThemeColor(getComputedStyle(document.body).backgroundColor);
  const backgroundColor = themeChromeColor ?? surfaceColor ?? fallbackColor;
  if (!backgroundColor) return;

  document.documentElement.style.backgroundColor = backgroundColor;
  document.body.style.backgroundColor = backgroundColor;
  // Update every theme-color meta so any element another layer added (for
  // example a media-scoped one) carries the resolved color too.
  const themeColorMetas = document.querySelectorAll<HTMLMetaElement>(
    `meta[name="${THEME_COLOR_META_NAME}"]`,
  );
  if (themeColorMetas.length === 0) {
    ensureThemeColorMetaTag().setAttribute("content", backgroundColor);
    return;
  }
  for (const element of themeColorMetas) {
    element.setAttribute("content", backgroundColor);
  }
}

function resolveAppearance(snapshot: ThemeSnapshot): "light" | "dark" {
  if (snapshot.appearanceMode !== "system") return snapshot.appearanceMode;
  return snapshot.systemDark ? "dark" : "light";
}

function readSnapshot(): ThemeSnapshot {
  const appearanceMode = readAppearanceModePreference();
  return { appearanceMode, systemDark: appearanceMode === "system" ? getSystemDark() : false };
}

function applyTheme(suppressTransitions = false) {
  if (typeof document === "undefined" || typeof window === "undefined") return;
  const snapshot = readSnapshot();
  if (
    lastAppliedTheme?.systemDark === snapshot.systemDark &&
    lastAppliedTheme.appearanceMode === snapshot.appearanceMode
  ) {
    syncDesktopTheme(snapshot.appearanceMode);
    return;
  }

  if (suppressTransitions) {
    document.documentElement.classList.add("no-transitions");
  }
  const resolvedAppearance = resolveAppearance(snapshot);
  document.documentElement.classList.toggle("dark", resolvedAppearance === "dark");
  lastAppliedTheme = snapshot;
  syncBrowserChromeTheme();
  syncDesktopTheme(snapshot.appearanceMode);
  if (suppressTransitions) {
    // Force a reflow so the no-transitions class takes effect before removal
    // oxlint-disable-next-line no-unused-expressions
    document.documentElement.offsetHeight;
    requestAnimationFrame(() => {
      document.documentElement.classList.remove("no-transitions");
    });
  }
}

export async function syncDesktopThemePreference(
  bridge: DesktopThemeBridge,
  mode: ThemePreferenceMode,
): Promise<void> {
  try {
    await bridge.setTheme(mode);
  } catch (cause) {
    throw new DesktopThemeSyncError({ mode, cause });
  }
}

export function syncDesktopTheme(mode: ThemePreferenceMode) {
  if (typeof window === "undefined") return;
  const bridge = window.desktopBridge;
  if (!bridge || typeof bridge.setTheme !== "function" || lastDesktopTheme === mode) {
    return;
  }

  lastDesktopTheme = mode;
  void syncDesktopThemePreference(bridge, mode).catch((cause: unknown) => {
    const error = isDesktopThemeSyncError(cause)
      ? cause
      : new DesktopThemeSyncError({ mode, cause });
    console.error(error.message, {
      mode: error.mode,
      ...safeErrorLogAttributes(error),
    });
    if (lastDesktopTheme === mode) {
      lastDesktopTheme = null;
    }
  });
}

// Apply immediately on module load to prevent flash
if (typeof document !== "undefined" && typeof window !== "undefined") {
  applyTheme();
}

function getSnapshot(): ThemeSnapshot {
  if (typeof window === "undefined") return DEFAULT_THEME_SNAPSHOT;
  // Reading the preference hits localStorage, so only recompute after a
  // change was signalled; useTheme consumers call this on every render.
  if (!snapshotStale && lastSnapshot) return lastSnapshot;
  snapshotStale = false;
  const snapshot = readSnapshot();
  if (
    lastSnapshot &&
    lastSnapshot.systemDark === snapshot.systemDark &&
    lastSnapshot.appearanceMode === snapshot.appearanceMode
  ) {
    return lastSnapshot;
  }

  lastSnapshot = snapshot;
  return lastSnapshot;
}

function getServerSnapshot() {
  return DEFAULT_THEME_SNAPSHOT;
}

function handleSystemAppearanceChange() {
  if (readAppearanceModePreference() === "system") applyTheme(true);
  emitChange();
}

function handleStorageChange(e: StorageEvent) {
  if (e.key === THEME_APPEARANCE_MODE_STORAGE_KEY || e.key === null) {
    applyTheme(true);
    emitChange();
  }
}

let removeWindowListeners: (() => void) | null = null;

function subscribe(listener: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  listeners.push(listener);

  // The system-preference and cross-tab listeners are shared by all
  // subscribers; each event applies the theme once and notifies everyone.
  if (!removeWindowListeners) {
    const mq = typeof window.matchMedia === "function" ? window.matchMedia(MEDIA_QUERY) : null;
    mq?.addEventListener("change", handleSystemAppearanceChange);
    window.addEventListener("storage", handleStorageChange);
    removeWindowListeners = () => {
      mq?.removeEventListener("change", handleSystemAppearanceChange);
      window.removeEventListener("storage", handleStorageChange);
    };
  }

  return () => {
    listeners = listeners.filter((l) => l !== listener);
    if (listeners.length === 0) {
      removeWindowListeners?.();
      removeWindowListeners = null;
    }
  };
}

export function useTheme() {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const resolvedTheme = resolveAppearance(snapshot);

  const setAppearanceMode = useCallback((nextAppearanceMode: ThemePreferenceMode): boolean => {
    if (typeof window === "undefined") return false;
    try {
      writeAppearanceModePreference(nextAppearanceMode);
    } catch (cause) {
      const error = isThemeStorageError(cause)
        ? cause
        : new ThemeStorageError({
            operation: "write",
            storageKey: THEME_APPEARANCE_MODE_STORAGE_KEY,
            cause,
          });
      console.error(error.message, {
        operation: error.operation,
        storageKey: error.storageKey,
        ...safeErrorLogAttributes(error),
      });
      return false;
    }
    applyTheme(true);
    emitChange();
    return true;
  }, []);

  const refreshTheme = useCallback(() => {
    if (typeof window === "undefined") return;
    lastAppliedTheme = null;
    applyTheme(true);
    emitChange();
  }, []);

  // Keep DOM in sync on mount/change
  useEffect(() => {
    applyTheme();
  }, [snapshot.appearanceMode]);

  return {
    setAppearanceMode,
    refreshTheme,
    appearanceMode: snapshot.appearanceMode,
    resolvedTheme,
  } as const;
}
