import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { reactHookHarness as hooks } from "../../test/reactHookHarness";
import { visitElements } from "../../test/reactElementTree";

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  const { reactHookHarness } = await import("../../test/reactHookHarness");
  return {
    ...actual,
    useState: reactHookHarness.useState,
  };
});

vi.mock("react/compiler-runtime", async () => {
  const { reactHookHarness } = await import("../../test/reactHookHarness");
  return { c: reactHookHarness.useMemoCache };
});

import { ZeropsDataQuery } from "./ZeropsDataQuery";

function findByAttribute(tree: unknown, attribute: string) {
  return visitElements(tree, (element) => attribute in element.props);
}

describe("ZeropsDataQuery", () => {
  beforeEach(() => {
    hooks.reset();
  });

  it("shows the read-only placeholder", () => {
    hooks.beginRender();
    const tree = ZeropsDataQuery({ onSubmit: vi.fn() });
    const input = findByAttribute(tree, "data-zerops-data-query-input");
    expect(input?.props.placeholder).toBe("Read-only SQL — SELECT only");
  });

  it("submits the typed statement on Run", () => {
    const onSubmit = vi.fn();
    hooks.beginRender();
    let tree = ZeropsDataQuery({ onSubmit });

    const input = findByAttribute(tree, "data-zerops-data-query-input")!;
    (input.props.onChange as (event: { target: { value: string } }) => void)({
      target: { value: "select 1" },
    });

    hooks.beginRender();
    tree = ZeropsDataQuery({ onSubmit });
    const submit = findByAttribute(tree, "data-zerops-data-query-submit")!;
    (submit.props.onClick as () => void)();

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith("select 1");
  });

  it("does not submit a blank statement", () => {
    const onSubmit = vi.fn();
    hooks.beginRender();
    const tree = ZeropsDataQuery({ onSubmit });
    const submit = findByAttribute(tree, "data-zerops-data-query-submit")!;
    expect(submit.props.disabled).toBe(true);

    (submit.props.onClick as () => void)();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
