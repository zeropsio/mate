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
    useSidebar: () => ({
      isMobile: false,
      setOpenMobile: () => {},
      toggleSidebar: () => {},
      state: "expanded",
    }),
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

vi.mock("~/zerops/ZeropsSessionProvider", () => ({
  useZeropsSessionOptional: () => ({
    status: "signed-in",
    user: { email: "ada@example.com", fullName: "Ada Lovelace", firstName: "Ada" },
    organizations: [{ id: "o", name: "Zerops", membershipId: "m" }],
    activeOrganization: { id: "o", name: "Zerops", membershipId: "m" },
    selectOrganization: () => Promise.resolve(),
    signOut: () => Promise.resolve(),
  }),
}));

import { SidebarChromeHeader, SidebarCornerMark, SidebarUtilityMenu } from "./SidebarChrome";

describe("SidebarChromeHeader", () => {
  it("renders the live mark alone, the product named once, without T3 branding", () => {
    const markup = renderToStaticMarkup(<SidebarChromeHeader isElectron={false} />);

    // The mark alone, as wide as the Mates' faces under it: no wordmark.
    expect(markup).toContain('data-mate-mark="live"');

    expect(markup).not.toContain(`viewBox="${MATE_LOCKUP.word.viewBox}"`);
    expect(markup).not.toContain("data-mate-lockup");
    expect(markup).toContain(`aria-hidden="true"`);
    // The link names the product once; the lockup inside it stays decorative.
    expect(markup).toContain(`aria-label="${APP_BASE_NAME}"`);
    expect(markup).toContain(APP_BASE_NAME);
    expect(markup).not.toContain("T3");
  });

  it("names the product in the closed menu", () => {
    const markup = renderToStaticMarkup(<SidebarCornerMark />);
    expect(markup).toContain(`aria-label="${APP_BASE_NAME}"`);
    expect(markup).toContain('data-mate-mark="live"');
  });

  it("ends the logo row in the jump box's way in, after the waiting faces' slot", () => {
    const markup = renderToStaticMarkup(
      <SidebarChromeHeader
        isElectron={false}
        jump={<button data-zerops-surface="sidebar-jump" type="button" />}
        waiting={<span data-zerops-surface="sidebar-waiting" />}
      />,
    );
    expect(markup.indexOf("sidebar-waiting-slot")).toBeGreaterThan(-1);
    expect(markup.indexOf('data-zerops-surface="sidebar-jump"')).toBeGreaterThan(
      markup.indexOf("sidebar-waiting-slot"),
    );
    // Without either, the row is the mark alone.
    expect(renderToStaticMarkup(<SidebarChromeHeader isElectron={false} />)).not.toContain(
      "sidebar-jump",
    );
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
  it.each([
    { pathname: "/", back: false },
    { pathname: "/zerops", back: false },
    { pathname: "/zerops/", back: false },
    { pathname: "/settings", back: true },
    { pathname: "/settings/appearance", back: true },
    { pathname: "/usage", back: false },
  ])("on $pathname: back=$back", ({ pathname, back }) => {
    router.pathname = pathname;
    const markup = renderToStaticMarkup(<SidebarUtilityMenu />);

    expect(markup.includes(">Back<")).toBe(back);
    expect(markup.includes('data-zerops-surface="sidebar-account"')).toBe(!back);
    // The collapse control is the foot's constant.
    expect(markup).toContain('aria-label="Collapse sidebar"');
  });

  it("says who is signed in and whose organization the rows above belong to", () => {
    router.pathname = "/";
    const markup = renderToStaticMarkup(<SidebarUtilityMenu />);

    expect(markup).toContain('aria-label="Account: Ada"');
    expect(markup).toContain(">Zerops<");
    // The four unlabelled glyphs the row replaced are gone from the foot.
    for (const label of ["Settings", "Zerops", "Usage", "Git"]) {
      expect(markup).not.toContain(`aria-label="${label}"`);
    }
  });
});

it("Usage keeps its account and organization footer", () => {
  router.pathname = "/usage";
  const markup = renderToStaticMarkup(<SidebarUtilityMenu />);
  expect(markup).toContain('aria-label="Account: Ada"');
  expect(markup).toContain(">Zerops<");
  expect(markup).not.toContain(">Back<");
});
