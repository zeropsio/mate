import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { MateTaskCard, MateTaskMessageRow } from "./MateTaskCard";

const issue = {
  kind: "github-issue",
  repo: "acme/tea-shop",
  number: 12,
  url: "https://github.com/acme/tea-shop/issues/12",
  title: "Fix the checkout total",
  author: "nova-dev",
} as const;

describe("a task's issue card", () => {
  it.each([
    [
      "names its issue, where it lives and who opened it",
      issue,
      "acme/tea-shop#12 · opened by nova-dev",
    ],
    [
      "names where it lives when nobody is known to have opened it",
      { ...issue, author: null },
      "acme/tea-shop#12",
    ],
  ] as const)("%s, with a way out to it on GitHub", (_case, task, source) => {
    const html = renderToStaticMarkup(<MateTaskCard task={task} />);
    expect(html).toContain("Fix the checkout total");
    expect(html).toContain(source);
    expect(html).toContain('href="https://github.com/acme/tea-shop/issues/12"');
    expect(html).toContain("Open on GitHub");
  });
});

describe("a task's issue card, as its chain", () => {
  const chainOf = (html: string) =>
    /data-zerops-surface="mate-task-chain"[^>]*>(.*?)<\/p>/u.exec(html)?.[1] ?? "";
  const words = (html: string) =>
    chainOf(html)
      .replace(/<[^>]+>/gu, "")
      .replace(/\u00a0/gu, " ");
  const pullRequest = { number: 14, url: "https://github.com/acme/tea-shop/pull/14" };

  it.each([
    ["holds an empty line while where it stands is not read", { kind: "unknown" }, " "],
    ["says its Mate works on it", { kind: "working", pullRequest: undefined }, "Working"],
    ["says its Mate waits for you", { kind: "waiting" }, "Waiting for you"],
    ["says its change waits for review", { kind: "review" }, "Waiting for review"],
    [
      "names the pull request its task ended with",
      { kind: "ended", ended: "merged", pullRequest: { ...pullRequest, state: "merged" } },
      "PR #14 · merged",
    ],
    [
      "says its task was stopped",
      { kind: "ended", ended: "stopped", pullRequest: undefined },
      "Stopped",
    ],
    ["holds an empty line for a task before its Mate's most recent", { kind: "earlier" }, " "],
    [
      "names its pull request on GitHub and its checks",
      { kind: "pull-request", pullRequest: { ...pullRequest, state: "open", checks: "passing" } },
      "PR #14 · open · checks passing",
    ],
    [
      "says its Mate works on its pull request again",
      { kind: "working", pullRequest: { ...pullRequest, state: "open", checks: "failing" } },
      "Working·PR #14 · open · checks failing",
    ],
    [
      "names its merged pull request",
      { kind: "pull-request", pullRequest: { ...pullRequest, state: "merged" } },
      "PR #14 · merged",
    ],
  ] as const)("%s", (_case, chain, line) => {
    const html = renderToStaticMarkup(<MateTaskCard chain={chain} task={issue} />);
    expect(words(html)).toBe(line);
    if (
      chain.kind === "pull-request" ||
      ((chain.kind === "working" || chain.kind === "ended") && chain.pullRequest)
    )
      expect(chainOf(html)).toContain('href="https://github.com/acme/tea-shop/pull/14"');
  });
});

describe("a follow-up told to a task's Mate", () => {
  it.each([
    ["comment", "ida-ops", "ida-ops commented on the issue"],
    ["reply", "Ida", "Ida replied in the thread"],
    ["review", "ida-ops", "ida-ops commented on the change"],
    ["edit", "nova-dev", "nova-dev edited the issue"],
    ["comment", null, "Someone commented on the issue"],
  ] as const)("a %s by %s reads “%s”, with its words", (from, author, heading) => {
    const html = renderToStaticMarkup(
      <MateTaskMessageRow message={{ id: "c1", from, author, text: "Keep the old rounding." }} />,
    );
    expect(html).toContain(heading);
    expect(html).toContain("Keep the old rounding.");
  });
});
