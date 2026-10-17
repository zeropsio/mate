/**
 * Settings › Zerops › HQ's automated Mates, from what is read: each application's intake row in
 * every state it can be in, painted in its final shape from the first frame.
 */
import type { AppIntakeRead } from "@t3tools/client-runtime/data";
import { act } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { create } from "react-test-renderer";
import { describe, expect, it, vi } from "vite-plus/test";

import { AppIntakeView } from "./AutomatedMatesSettings";

const NONE: AppIntakeRead = { intake: null, action: { kind: "idle" }, answer: null };
const UNREAD: AppIntakeRead = { intake: undefined, action: { kind: "idle" }, answer: null };
const TAKING: AppIntakeRead = {
  intake: { repo: "acme/tea-shop", label: "mate", waiting: 0 },
  action: { kind: "idle" },
  answer: null,
};
const nothing = () => {};

function row(props: Partial<Parameters<typeof AppIntakeView>[0]>) {
  return renderToStaticMarkup(
    <AppIntakeView
      appId="tea-shop"
      choices={["acme/tea-shop"]}
      name="Tea Shop"
      onSet={nothing}
      onStop={nothing}
      read={NONE}
      reposRead
      {...props}
    />,
  );
}

/** The words a row's markup carries. */
const shown = (html: string) =>
  html
    .replace(/<[^>]+>/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();

describe("an application's intake row in Settings", () => {
  // The owner's cardinal sin: a row that reads first and answers later must not grow.
  it.each([
    { case: "HQ's applications not read", props: { read: UNREAD }, says: "Reading…" },
    {
      case: "its repositories not read",
      props: { reposRead: false },
      says: "Reading its repositories…",
    },
    {
      case: "taking tasks",
      props: { read: TAKING },
      says: "Takes issues labelled “mate” from acme/tea-shop",
    },
    { case: "no GitHub mirror", props: { choices: [] }, says: "Mirror its code to GitHub" },
  ])("holds the form's room while it says something else: $case", ({ props, says }) => {
    const html = row(props);
    expect(html).toContain("data-zerops-intake-room");
    expect(shown(html)).toContain(says);
  });

  it("holds no extra room where it shows the form", () => {
    expect(row({})).not.toContain("data-zerops-intake-room");
  });
});

describe("an application whose repositories could not be read", () => {
  it("says why, and reads them again when asked", () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const onReadAgain = vi.fn();
    const props = {
      appId: "tea-shop",
      choices: [],
      name: "Tea Shop",
      onSet: nothing,
      onStop: nothing,
      read: NONE,
      reposRead: false,
      reposFailure: "HQ is not answering right now.",
      onReadAgain,
    };
    expect(shown(row(props))).toContain("HQ is not answering right now.");
    expect(shown(row(props))).not.toContain("Reading its repositories…");
    let tree: ReturnType<typeof create> | undefined;
    act(() => {
      tree = create(<AppIntakeView {...props} />);
    });
    const again = tree!.root.find(
      (node) => node.type === "button" && JSON.stringify(node.props.children) === '"Read again"',
    );
    act(() => {
      again.props.onClick();
    });
    expect(onReadAgain).toHaveBeenCalledOnce();
    act(() => {
      tree!.unmount();
    });
  });
});
