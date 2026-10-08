import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";
import { markupDom } from "../../../web/test/markupDom";

// Native host ports expose the labels supplied by the real components to a DOM reader.
vi.mock("react-native", async () => {
  const { createElement } = await import("react");
  const host =
    (tag: string) =>
    (props: {
      children?: ReactNode;
      accessibilityLabel?: string;
      accessibilityRole?: string;
      role?: string;
      accessibilityElementsHidden?: boolean;
    }) =>
      createElement(
        tag,
        {
          "aria-label": props.accessibilityLabel,
          role: props.accessibilityRole ?? props.role,
          "aria-hidden": props.accessibilityElementsHidden,
        },
        props.children,
      );
  return {
    View: host("div"),
    Text: host("span"),
    Pressable: host("div"),
    TextInput: host("input"),
    Platform: { OS: "ios", isPad: false },
    Animated: {},
    ActivityIndicator: host("div"),
  };
});
vi.mock("react-native-svg", () => ({ default: "svg", Path: "path" }));
vi.mock("expo-constants", () => ({
  default: { expoConfig: { extra: { appVariant: "production" } } },
}));
vi.mock("../native/native-glass", () => ({ NATIVE_LIQUID_GLASS_SUPPORTED: true }));
vi.mock("./useAndroidControlSizing", () => ({ useAndroidControlSizing: () => ({ scale: 1 }) }));
vi.mock("./AppSymbol", () => ({ SymbolView: () => null }));
vi.mock("./ControlPill", () => ({
  ControlPillMenu: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("../native/StackHeader", () => ({ NativeStackScreenOptions: () => null }));
vi.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0 }) }));
vi.mock("../features/settings/appearance/AppearancePreferencesProvider", () => ({
  useAppearancePreferences: () => ({ materialYouStyleLayoutActive: false }),
}));
vi.mock("../state/workspace", () => ({
  useWorkspaceState: () => ({
    state: {
      networkStatus: "online",
      connectionError: null,
      hasConnectingEnvironment: false,
      hasPendingShellSnapshot: false,
      hasLoadedShellSnapshot: true,
      hasReadyEnvironment: true,
    },
  }),
}));

import { BrandMark } from "./BrandMark";
import { CompactBrandTitle, getCompactBrandHeaderOptions } from "./CompactBrandTitle";
import { HomeHeader } from "../features/home/HomeHeader.android";
import { getConnectionAwareBrandHeaderOptions } from "../features/home/WorkspaceConnectionTitle";

const render = (content: ReactNode) => markupDom(renderToStaticMarkup(content));

describe("mobile native branding", () => {
  it("renders the product name and stage in the full brand header", () => {
    const document = render(createElement(BrandMark));
    expect(document.body.textContent).toContain("Zerops Mate");
    expect(document.body.textContent).toContain("Alpha");
    expect(document.body.textContent).not.toContain("T3 Connect");
  });
  it("names the compact native header as Zerops Mate, Threads", () => {
    const document = render(createElement(CompactBrandTitle));
    expect(
      document.querySelector('[role="heading"][aria-label="Zerops Mate, Threads"]'),
    ).not.toBeNull();
    expect(document.body.textContent).toBe("CodeAlpha");
  });
  it("renders the Android home header's brand beside its named controls", () => {
    const document = render(
      createElement(HomeHeader, {
        environments: [],
        projects: [],
        searchQuery: "",
        selectedEnvironmentId: null,
        selectedProjectKey: null,
        onSearchQueryChange: () => {},
        onEnvironmentChange: () => {},
        onProjectChange: () => {},
        onOpenEnvironments: () => {},
        onOpenSettings: () => {},
        onStartNewTask: () => {},
      }),
    );
    expect(document.body.textContent).toContain("CodeAlpha");
    expect(document.querySelector('[role="button"][aria-label="Open settings"]')).not.toBeNull();
  });
  it.each(["compact", "connection-aware"] as const)(
    "renders the brand through the stable native title slot (%s)",
    (kind) => {
      const options =
        kind === "compact"
          ? getCompactBrandHeaderOptions()
          : getConnectionAwareBrandHeaderOptions({
              headerWidth: 390,
              onOpenEnvironments: () => {},
            });
      expect(options.unstable_navigationItemStyle).toBe("navigator");
      expect(options.unstable_headerLeftItems).toBeUndefined();
      expect(typeof options.headerTitle).toBe("function");
      if (typeof options.headerTitle !== "function")
        throw new Error("Missing brand title renderer");
      const document = render(options.headerTitle({ children: "Threads" }));
      expect(
        document.querySelector('[role="heading"][aria-label="Zerops Mate, Threads"]'),
      ).not.toBeNull();
    },
  );
});
