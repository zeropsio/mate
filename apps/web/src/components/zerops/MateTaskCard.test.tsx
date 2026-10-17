import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { MateTaskCard } from "./MateTaskCard";

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
