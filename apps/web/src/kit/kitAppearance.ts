import { useLayoutEffect } from "react";

import { useTheme } from "~/hooks/useTheme";
import { applyThemePalette, ZEROPS_THEME_ID, type ThemeAppearance } from "~/themePalette";

/** How the kit page shows its sections: one appearance, or both side by side. */
export type KitView = ThemeAppearance | "both";

/** The ground a canvas stands on: the page's, a card's, the menu's. */
export const KIT_GROUNDS = ["page", "card", "menu"] as const;
export type KitGround = (typeof KIT_GROUNDS)[number];

/** A canvas's width presets, in CSS pixels: the reference window, then smaller ones. */
export const KIT_VIEWPORTS = [
  { width: 1786, label: "Desktop" },
  { width: 1280, label: "Laptop" },
  { width: 820, label: "Tablet" },
  { width: 390, label: "Phone" },
] as const;

export const KIT_ZOOMS = [100, 75, 50] as const;
export type KitZoom = (typeof KIT_ZOOMS)[number];

/**
 * The kit's whole state, in its address so any view can be shared: the page, its tab and
 * playground arguments, and the canvas's appearance, width, ground, zoom and outline.
 */
export interface KitSearch {
  readonly appearance?: KitView;
  /** Set on the frames of the "both" view and on "Open alone": the canvas alone, no shell. */
  readonly pane?: true;
  /** `overview` when unset; `foundations:colour`, a section's id, `flow:<id>`, `census[:<id>]`. */
  readonly page?: string;
  /** A component page's tab: `playground`, `variants` or `usage`. */
  readonly tab?: string;
  /** Which of a section's playgrounds, by its component's name, when it has several. */
  readonly story?: string;
  /** A playground's arguments that differ from its defaults: `variant:ghost;disabled:!true`. */
  readonly args?: string;
  /** The canvas's width in CSS pixels; unset, it fills its room. */
  readonly viewport?: number;
  readonly bg?: KitGround;
  readonly zoom?: KitZoom;
  readonly outline?: 1;
  /** A flow's state, by its id. */
  readonly state?: string;
}

const text = (value: unknown): string | undefined =>
  typeof value === "string" && value !== "" ? value : undefined;

const number = (value: unknown): number | undefined => {
  const parsed =
    typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
};

export function validateKitSearch(raw: Readonly<Record<string, unknown>>): KitSearch {
  const appearance =
    raw.appearance === "light" || raw.appearance === "dark" || raw.appearance === "both"
      ? raw.appearance
      : undefined;
  const pane = raw.pane === true || raw.pane === "true" || raw.pane === 1 || raw.pane === "1";
  // `?flow=` is the address the kit gave a flow before it had pages.
  const legacyFlow = text(raw.flow);
  const page = text(raw.page) ?? (legacyFlow === undefined ? undefined : `flow:${legacyFlow}`);
  const viewport = number(raw.viewport);
  const zoom = KIT_ZOOMS.find((candidate) => candidate === number(raw.zoom));
  const bg = KIT_GROUNDS.find((candidate) => candidate === raw.bg);
  const outline = raw.outline === 1 || raw.outline === "1" || raw.outline === true;
  const tab = text(raw.tab);
  const args = text(raw.args);
  const story = text(raw.story);
  const state = text(raw.state);
  return {
    ...(appearance === undefined ? {} : { appearance }),
    ...(pane ? { pane: true } : {}),
    ...(page === undefined || page === "overview" ? {} : { page }),
    ...(tab === undefined ? {} : { tab }),
    ...(story === undefined ? {} : { story }),
    ...(args === undefined ? {} : { args }),
    ...(viewport === undefined || viewport < 240 || viewport > 4096 ? {} : { viewport }),
    ...(bg === undefined || bg === "page" ? {} : { bg }),
    ...(zoom === undefined || zoom === 100 ? {} : { zoom }),
    ...(outline ? { outline: 1 } : {}),
    ...(state === undefined ? {} : { state }),
  };
}

/** The search as an address's query, in a stable order, without the leading `?`. */
export function kitSearchQuery(search: KitSearch): string {
  const params = new URLSearchParams();
  const order: ReadonlyArray<keyof KitSearch> = [
    "page",
    "tab",
    "state",
    "story",
    "args",
    "appearance",
    "viewport",
    "bg",
    "zoom",
    "outline",
    "pane",
  ];
  for (const key of order) {
    const value = search[key];
    if (value === undefined) continue;
    params.set(key, value === true ? "1" : String(value));
  }
  return params.toString();
}

/**
 * Paints the page in one appearance of the theme, the way the app paints itself
 * (`applyThemePalette` and the root `dark` class), without writing their preference: leaving the
 * page puts their own appearance back.
 */
export function useKitAppearance(appearance: ThemeAppearance | null): void {
  const { refreshTheme } = useTheme();
  useLayoutEffect(() => {
    if (appearance === null) return;
    applyThemePalette(ZEROPS_THEME_ID, appearance);
    document.documentElement.classList.toggle("dark", appearance === "dark");
    return refreshTheme;
  }, [appearance, refreshTheme]);
}
