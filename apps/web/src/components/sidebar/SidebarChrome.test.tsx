import type * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MATE_LOCKUP } from "@t3tools/shared/brand";
import { describe, expect, it, vi } from "vite-plus/test";

import { APP_BASE_NAME } from "../../branding";

const router = vi.hoisted(() => ({ pathname: "/" }));

vi.mock("@tanstack/react-router", async () => {
  const { createElement } = await import("react");
  return {
    Link: ({ to: _to, ...props }: React.ComponentProps<"a"> & { to: string }) =>
      createElement("a", props),
    useCanGoBack: () => false,
    useLocation: ({ select }: { select: (location: { pathname: string }) => unknown }) =>
      select({ pathname: router.pathname }),
    useNavigate: () => () => Promise.resolve(),
  };
});

vi.mock("../ui/sidebar", async () => {
  const { createElement } = await import("react");
  return {
    SidebarHeader: (props: React.ComponentProps<"header">) => createElement("header", props),
    SidebarTrigger: (props: React.ComponentProps<"button">) => createElement("button", props),
    SidebarMenu: (props: React.ComponentProps<"ul">) => createElement("ul", props),
    SidebarMenuItem: (props: React.ComponentProps<"li">) => createElement("li", props),
    // The real button turns `isActive` into `data-active`; the mock keeps that
    // one contract so the test reads what the sidebar's own styles key on.
    SidebarMenuButton: ({
      isActive,
      size: _size,
      ...props
    }: React.ComponentProps<"button"> & { isActive?: boolean; size?: string }) =>
      createElement("button", { ...props, "data-active": isActive }),
    useSidebar: () => ({ isMobile: false, setOpenMobile: () => {}, toggleSidebar: () => {} }),
  };
});

vi.mock("../ui/tooltip", async () => {
  const { createElement, Fragment } = await import("react");
  return {
    Tooltip: ({ children }: { children?: React.ReactNode }) =>
      createElement(Fragment, null, children),
    TooltipTrigger: ({ render }: { render: React.ReactElement }) => render,
    TooltipPopup: () => null,
  };
});

vi.mock("./SidebarUpdatePill", () => ({
  SidebarUpdatePill: () => null,
  SidebarUpdateArchitectureWarning: () => null,
}));

vi.mock("./SidebarProviderUpdatePill", () => ({
  SidebarProviderUpdatePill: () => null,
}));

vi.mock("../../hooks/useSettings", () => ({
  useEnvironmentIdentificationMode: () => "artwork",
}));

vi.mock("../../branding", () => ({
  APP_BASE_NAME: "Injected Product Name",
}));

import { SidebarChromeHeader, SidebarUtilityMenu } from "./SidebarChrome";

describe("SidebarChromeHeader", () => {
  it("renders the shared Mate lockup and sourced product name without T3 branding", () => {
    const markup = renderToStaticMarkup(<SidebarChromeHeader isElectron={false} />);

    // The lockup: the live mark and the wordmark, two boxes that are one; the
    // name set once by geometry.
    expect(markup).toContain(`viewBox="${MATE_LOCKUP.word.viewBox}"`);
    expect(markup).toContain('data-mate-lockup="live"');
    expect(markup).toContain('data-mate-mark="live"');
    expect(markup).toContain(`aria-hidden="true"`);
    // The link names the product once; the lockup inside it stays decorative.
    expect(markup).toContain(`aria-label="${APP_BASE_NAME}"`);
    expect(markup).toContain(APP_BASE_NAME);
    expect(markup).not.toContain("T3");
  });

  it("renders no stage artwork with a built-in theme selected", () => {
    const markup = renderToStaticMarkup(
      <div data-theme-id="t3-chat">
        <SidebarChromeHeader isElectron={false} />
      </div>,
    );

    expect(markup).not.toContain("sidebar-stage-backdrop");
    expect(markup).not.toContain("stage-art");
  });
});

describe("SidebarUtilityMenu", () => {
  const UTILITIES = ["Settings", "Zerops", "Usage"] as const;

  function utilities(markup: string) {
    return UTILITIES.filter((label) => markup.includes(`aria-label="${label}"`));
  }

  function activeUtility(markup: string) {
    const active = UTILITIES.filter((label) =>
      new RegExp(`<button[^>]*aria-label="${label}"[^>]*data-active="true"`, "u").test(markup),
    );
    return active.length === 0 ? null : active;
  }

  // The footer keeps one shape across the routes that own it: the three
  // utilities everywhere but the two pages that are somewhere else (settings,
  // usage), where the only sensible control is the way back. The projects
  // screen is the root of a Zerops account, so it is not "somewhere else" —
  // it just lights its own icon.
  it.each([
    { pathname: "/", back: false, active: null },
    { pathname: "/zerops", back: false, active: ["Zerops"] },
    { pathname: "/zerops/", back: false, active: null },
    { pathname: "/settings", back: true, active: null },
    { pathname: "/settings/appearance", back: true, active: null },
    { pathname: "/usage", back: true, active: null },
  ])("on $pathname: back=$back, active=$active", ({ pathname, back, active }) => {
    router.pathname = pathname;
    const markup = renderToStaticMarkup(<SidebarUtilityMenu />);

    expect(markup.includes(">Back<")).toBe(back);
    expect(utilities(markup)).toEqual(back ? [] : [...UTILITIES]);
    expect(activeUtility(markup)).toEqual(active);
    // The collapse control is the footer's constant.
    expect(markup).toContain('aria-label="Collapse sidebar"');
  });
});
