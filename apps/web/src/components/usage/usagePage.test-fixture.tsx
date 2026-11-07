import { cloneElement, createElement, type ReactElement, type ReactNode } from "react";
import { vi } from "vite-plus/test";

import * as breadcrumb from "../WorkspaceBreadcrumb";
import * as container from "../WorkspacePageContainer";
import * as header from "../WorkspacePageHeader";

const buttons = await import("../ui/button");
const scrollArea = await import("../ui/scroll-area");
const select = await import("../ui/select");
const sidebar = await import("../ui/sidebar");
const toggle = await import("../ui/toggle-group");
const tooltip = await import("../ui/tooltip");

type HostProps = { readonly children?: ReactNode } & Record<string, unknown>;
const host =
  (element: "button" | "div" | "span" | "main" | "header") =>
  ({ children, ...props }: HostProps) =>
    createElement(element, props, children);

/** Keep controls inspectable while each test owns and restores its presentation fixtures. */
export function stubUsageControls() {
  vi.spyOn(buttons, "Button").mockImplementation(
    host("button") as unknown as typeof buttons.Button,
  );
  vi.spyOn(buttons, "InlineButton").mockImplementation(
    host("button") as unknown as typeof buttons.InlineButton,
  );
  vi.spyOn(scrollArea, "ScrollArea").mockImplementation(
    host("div") as unknown as typeof scrollArea.ScrollArea,
  );
  vi.spyOn(select, "Select").mockImplementation(host("div") as unknown as typeof select.Select);
  vi.spyOn(select, "SelectItem").mockImplementation(
    host("div") as unknown as typeof select.SelectItem,
  );
  vi.spyOn(select, "SelectPopup").mockImplementation(
    host("div") as unknown as typeof select.SelectPopup,
  );
  vi.spyOn(select, "SelectTrigger").mockImplementation(
    host("div") as unknown as typeof select.SelectTrigger,
  );
  vi.spyOn(select, "SelectValue").mockImplementation(
    host("div") as unknown as typeof select.SelectValue,
  );
  vi.spyOn(sidebar, "SidebarInset").mockImplementation(
    host("div") as unknown as typeof sidebar.SidebarInset,
  );
  vi.spyOn(toggle, "Toggle").mockImplementation(host("button") as unknown as typeof toggle.Toggle);
  vi.spyOn(toggle, "ToggleGroup").mockImplementation(
    host("div") as unknown as typeof toggle.ToggleGroup,
  );
  vi.spyOn(tooltip, "Tooltip").mockImplementation(host("div") as unknown as typeof tooltip.Tooltip);
  vi.spyOn(tooltip, "TooltipPopup").mockImplementation(
    host("div") as unknown as typeof tooltip.TooltipPopup,
  );
  vi.spyOn(tooltip, "TooltipTrigger").mockImplementation((({
    render,
    children,
  }: {
    render?: ReactElement;
    children?: ReactNode;
  }) =>
    render ? (
      cloneElement(render, undefined, children)
    ) : (
      <div>{children}</div>
    )) as unknown as typeof tooltip.TooltipTrigger);
  vi.spyOn(breadcrumb, "WorkspaceBreadcrumb").mockImplementation(
    host("div") as unknown as typeof breadcrumb.WorkspaceBreadcrumb,
  );
  vi.spyOn(breadcrumb, "WorkspaceBreadcrumbItem").mockImplementation(
    host("div") as unknown as typeof breadcrumb.WorkspaceBreadcrumbItem,
  );
  vi.spyOn(breadcrumb, "WorkspaceBreadcrumbSeparator").mockImplementation(
    host("span") as unknown as typeof breadcrumb.WorkspaceBreadcrumbSeparator,
  );
  vi.spyOn(container, "WorkspacePageContainer").mockImplementation(
    host("main") as unknown as typeof container.WorkspacePageContainer,
  );
  vi.spyOn(header, "WorkspacePageHeader").mockImplementation(
    host("header") as unknown as typeof header.WorkspacePageHeader,
  );
}
