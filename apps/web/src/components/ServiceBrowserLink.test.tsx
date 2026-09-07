import { describe, expect, it, vi } from "vite-plus/test";
import { renderToStaticMarkup } from "react-dom/server";
import type { MouseEvent } from "react";
import { ServiceBrowserLink } from "./ServiceBrowserLink";

vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useContext: () => null,
}));

function click(overrides: Partial<MouseEvent<HTMLAnchorElement>> = {}) {
  return {
    button: 0,
    defaultPrevented: false,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    preventDefault: vi.fn(),
    ...overrides,
  } as unknown as MouseEvent<HTMLAnchorElement>;
}

describe("ServiceBrowserLink", () => {
  it("opens an ordinary web click in the indicated panel", () => {
    const onOpen = vi.fn();
    const resolvePreview = () => onOpen;
    const onClick = vi.fn();
    const event = click();
    ServiceBrowserLink({ href: "https://example.com", resolvePreview, onClick }).props.onClick(
      event,
    );
    expect(onOpen).toHaveBeenCalledOnce();
    expect(event.preventDefault).toHaveBeenCalled();
    expect(onClick).toHaveBeenCalled();
  });
  it("keeps excluded web links external without cancelling navigation", () => {
    const resolvePreview = () => null;
    const onClick = vi.fn();
    const event = click();
    ServiceBrowserLink({
      href: "https://example.com/mate/shortlink/pulls/4",
      resolvePreview,
      onClick,
    }).props.onClick(event);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(onClick).toHaveBeenCalled();
  });
  it("shows the same destination before clicking without opening anything", () => {
    const open = vi.fn();
    const preview = renderToStaticMarkup(
      <ServiceBrowserLink href="https://app.example/mate/" resolvePreview={() => open}>
        App
      </ServiceBrowserLink>,
    );
    const external = renderToStaticMarkup(
      <ServiceBrowserLink href="https://other.example" resolvePreview={() => null}>
        Other
      </ServiceBrowserLink>,
    );
    expect(preview).toContain('data-link-indicator="preview"');
    expect(preview).toContain("Open in side panel");
    expect(external).toContain('data-link-indicator="external"');
    expect(external).toContain("Open in new tab");
    expect(open).not.toHaveBeenCalled();
  });
  it.each([
    { metaKey: true },
    { ctrlKey: true },
    { shiftKey: true },
    { altKey: true },
    { button: 1 },
    { defaultPrevented: true },
  ])("keeps native modified or handled clicks: %j", (modifiers) => {
    const onOpen = vi.fn();
    const resolvePreview = () => onOpen;
    const event = click(modifiers);
    ServiceBrowserLink({ href: "https://example.com", resolvePreview }).props.onClick(event);
    expect(onOpen).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
  });
  it.each(["mailto:hello@example.com", "#section", "file:///tmp/file", "javascript:alert(1)"])(
    "preserves special link behavior for %s",
    (href) => {
      const onOpen = vi.fn();
      const resolvePreview = () => onOpen;
      const onClick = vi.fn();
      ServiceBrowserLink({ href, resolvePreview, onClick }).props.onClick(click());
      expect(onOpen).not.toHaveBeenCalled();
      expect(onClick).toHaveBeenCalled();
    },
  );
});
