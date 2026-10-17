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
