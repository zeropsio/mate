import { describe, expect, it, vi } from "vite-plus/test";
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
  it("opens an ordinary web click in the panel before the external handler", () => {
    const onOpen = vi.fn();
    const onClick = vi.fn();
    const event = click();
    ServiceBrowserLink({ href: "https://example.com", onOpen, onClick }).props.onClick(event);
    expect(onOpen).toHaveBeenCalledWith("https://example.com");
    expect(event.preventDefault).toHaveBeenCalled();
    expect(onClick).not.toHaveBeenCalled();
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
    const event = click(modifiers);
    ServiceBrowserLink({ href: "https://example.com", onOpen }).props.onClick(event);
    expect(onOpen).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
  });
  it.each(["mailto:hello@example.com", "#section", "file:///tmp/file", "javascript:alert(1)"])(
    "preserves special link behavior for %s",
    (href) => {
      const onOpen = vi.fn();
      const onClick = vi.fn();
      ServiceBrowserLink({ href, onOpen, onClick }).props.onClick(click());
      expect(onOpen).not.toHaveBeenCalled();
      expect(onClick).toHaveBeenCalled();
    },
  );
});
