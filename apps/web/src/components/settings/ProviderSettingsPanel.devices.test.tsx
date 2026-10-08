import { markupDom } from "../../../test/markupDom";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { EnvironmentId } from "@t3tools/contracts";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { visitElements } from "../../test/reactElementTree";
import { reactHookHarness as hooks } from "../../test/reactHookHarness";

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  const { reactHookHarness } = await import("../../test/reactHookHarness");
  return {
    ...actual,
    useCallback: reactHookHarness.useCallback,
    useMemo: reactHookHarness.useMemo,
    useRef: reactHookHarness.useRef,
    useState: reactHookHarness.useState,
  };
});

vi.mock("react/compiler-runtime", async () => {
  const { reactHookHarness } = await import("../../test/reactHookHarness");
  return { c: reactHookHarness.useMemoCache };
});

const OPEN = EnvironmentId.make("open-mate");
const PARKED = EnvironmentId.make("parked-mate");

const device = (environmentId: EnvironmentId, label: string, phase: string) => ({
  environmentId,
  label,
  entry: { target: { _tag: "BearerConnectionTarget", label } },
  connection: { phase, error: null, traceId: null },
});

vi.mock("../../state/environments", () => ({
  useEnvironments: () => ({
    isReady: true,
    environments: [device(OPEN, "Fen", "connected"), device(PARKED, "Ida", "available")],
  }),
  usePrimaryEnvironmentId: () => null,
}));

import { ProviderSettingsPanel } from "./ProviderSettingsPanel";

type Element = ReactElement<Record<string, unknown>>;

/** The panel's content, one level down: its children stay elements, never rendered. */
function renderContent(): Element {
  hooks.beginRender();
  const page = ProviderSettingsPanel({}) as Element;
  const content = visitElements(
    page,
    (element) =>
      typeof element.type === "function" && element.type.name === "ProviderSettingsPanelContent",
  );
  if (content === null) throw new Error("the panel renders its content");
  return (content.type as (props: Record<string, unknown>) => Element)(content.props);
}

function collect(node: unknown, accept: (element: Element) => boolean): Element[] {
  const found: Element[] = [];
  visitElements(node, (element) => {
    if (accept(element)) found.push(element);
    return false;
  });
  return found;
}

describe("ProviderSettingsPanel — devices", () => {
  beforeEach(() => {
    hooks.reset();
  });

  it("offers only the Mates the app is connected to, and says so", () => {
    const tree = renderContent();

    const group = collect(
      tree,
      (element) => element.props.role === "group" && element.props["aria-label"] === "Devices",
    )[0];
    expect(group).toBeDefined();
    const document = markupDom(renderToStaticMarkup(group!));
    const buttons = Array.from(document.querySelectorAll("button[aria-pressed]"));
    expect(buttons).toHaveLength(1);
    expect(buttons[0]?.textContent).toContain("Fen");
    expect(buttons[0]?.getAttribute("aria-pressed")).toBe("true");
    expect(document.body.textContent).not.toContain("Ida");
    expect(
      collect(tree, (element) => element.props.children === "Only Mates the app is connected to."),
    ).not.toHaveLength(0);
  });
});
