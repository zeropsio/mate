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
      value?: string;
      placeholder?: string;
      accessibilityElementsHidden?: boolean;
    }) =>
      createElement(
        tag,
        {
          "aria-label": props.accessibilityLabel,
          role: props.accessibilityRole ?? props.role,
          "aria-hidden": props.accessibilityElementsHidden,
          defaultValue: props.value,
          placeholder: props.placeholder,
        },
        props.children,
      );
  return {
    ScrollView: host("div"),
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

vi.mock("@effect/atom-react", async () => {
  const { AsyncResult } = await import("effect/reactivity");
  return {
    useAtomValue: (atom: unknown) => (atom === "server-config" ? null : AsyncResult.success({})),
    useAtomSet: () => () => {},
  };
});
vi.mock("../state/server", () => ({
  serverEnvironment: { configValueAtom: () => "server-config" },
}));
vi.mock("react-native-reanimated", async () => {
  const { View } = await import("react-native");
  return {
    default: { View },
    LinearTransition: { duration: () => undefined },
    FadeIn: { duration: () => undefined },
    FadeOut: { duration: () => undefined },
  };
});
vi.mock("../features/connection/ConnectionStatusDot", () => ({ ConnectionStatusDot: () => null }));
vi.mock("../lib/copyTextWithHaptic", () => ({ copyTextWithHaptic: () => {} }));
vi.mock("@react-navigation/native", () => ({
  useNavigation: () => ({ goBack: () => {}, navigate: () => {} }),
}));
vi.mock("@clerk/expo", () => ({ useAuth: () => ({ isLoaded: true, isSignedIn: false }) }));
vi.mock("expo-notifications", () => ({}));
vi.mock("../features/layout/AdaptiveWorkspaceLayout", () => ({
  useAdaptiveWorkspaceLayout: () => ({ layout: { usesSplitView: false } }),
}));
vi.mock("../features/layout/native-glass-header-items", () => ({
  withNativeGlassHeaderItem: (item: unknown) => item,
}));
vi.mock("../features/cloud/publicConfig", () => ({
  hasCloudPublicConfig: () => false,
  resolveRelayClerkTokenOptions: () => ({}),
}));
vi.mock("../state/use-remote-environment-registry", () => ({
  useSavedRemoteConnections: () => ({ savedConnectionsById: {} }),
}));
vi.mock("../features/zerops/ZeropsSessionProvider", () => ({
  useZeropsSession: () => ({ status: "signed-out", user: null }),
}));
vi.mock("../state/preferences", () => ({
  mobilePreferencesAtom: "preferences",
  updateMobilePreferencesAtom: "update-preferences",
}));
vi.mock("../lib/runtime", () => ({ runtime: {} }));
vi.mock("../features/updates/app-updates", () => ({
  isAppUpdateCheckAvailable: () => false,
  registerHiddenUpdateTap: () => {},
  runAppUpdateCheck: () => {},
}));
vi.mock("./ThemedSwitch", () => ({ ThemedSwitch: () => null }));
vi.mock("../features/agent-awareness/capabilities", () => ({
  supportsAgentAwarenessPush: () => false,
}));
vi.mock("../features/agent-awareness/liveActivityPreferences", () => ({
  setLiveActivityUpdatesEnabled: () => {},
}));
vi.mock("../features/agent-awareness/notificationPermissions", () => ({
  requestAgentNotificationPermission: () => {},
}));
vi.mock("../features/agent-awareness/remoteRegistration", () => ({
  getAgentAwarenessRegistrationStatus: () => "unknown",
  subscribeAgentAwarenessRegistrationStatus: () => () => {},
  refreshAgentAwarenessRegistration: () => {},
}));
import { EnvironmentId } from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import { ConnectionEnvironmentRow } from "../features/connection/ConnectionEnvironmentRow";
import { SettingsRouteScreen } from "../features/settings/SettingsRouteScreen";
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

describe("retired mobile connection branding", () => {
  it("never names a connection T3 Connect in its collapsed or expanded surface", () => {
    for (const expanded of [false, true]) {
      const document = render(
        createElement(ConnectionEnvironmentRow, {
          environment: {
            environmentId: EnvironmentId.make("env-ada"),
            environmentLabel: "Ada",
            displayUrl: "https://ada.example",
            isRelayManaged: false,
            connectionState: "connected",
            connectionError: null,
            connectionErrorTraceId: null,
          },
          expanded,
          onToggle: () => {},
          onReconnect: () => {},
          onRemove: () => {},
          onUpdate: async () => AsyncResult.success(undefined),
        }),
      );
      expect(document.body.textContent).toContain("Ada");
      const labels = Array.from(document.querySelectorAll("[aria-label], input")).map((node) =>
        [
          node.getAttribute("aria-label"),
          node.getAttribute("placeholder"),
          node.getAttribute("value"),
        ].join(" "),
      );
      expect([document.body.textContent, ...labels].join(" ")).not.toContain("T3 Connect");
    }
  });
  it("never shows T3 Connect on Settings", () => {
    const document = render(createElement(SettingsRouteScreen));
    expect(document.body.textContent).toContain("Zerops Account");
    expect(document.body.textContent).toContain("Environments");
    expect(document.body.textContent).not.toContain("T3 Connect");
    expect(
      Array.from(document.querySelectorAll("[aria-label]"))
        .map((node) => node.getAttribute("aria-label"))
        .join(" "),
    ).not.toContain("T3 Connect");
  });
});
