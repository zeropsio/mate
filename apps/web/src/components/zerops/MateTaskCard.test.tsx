import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import type { TaskSession } from "~/zerops/taskSession.logic";

import { MateTaskMessageRow, MateTaskSessionBar } from "./MateTaskCard";

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
    const html = renderToStaticMarkup(<MateTaskSessionBar task={task} />);
    expect(html).toContain(source);
    expect(html).toContain('href="https://github.com/acme/tea-shop/issues/12"');
    expect(html).toContain("Open on GitHub");
  });
});

describe("a task's issue card, as its chain", () => {
  const statusOf = (html: string) =>
    (/data-zerops-surface="mate-task-status-words"[^>]*>([^<]*)</u.exec(html)?.[1] ?? "").replace(
      /\u00a0/gu,
      " ",
    );
  const factsOf = (html: string) =>
    (/data-zerops-surface="mate-task-facts"[^>]*>([\s\S]*)$/u.exec(html)?.[1] ?? "").replace(
      /<[^>]+>/gu,
      " ",
    );
  const pullRequest = { number: 14, url: "https://github.com/acme/tea-shop/pull/14" };
  const session = (over: Partial<TaskSession>): TaskSession => ({
    status: null,
    taskId: "task-12",
    stoppable: false,
    workedMs: null,
    spentUsd: null,
    change: null,
    pullRequest: null,
    ...over,
  });

  it.each([
    ["holds an empty line while where it stands is not read", session({}), " ", []],
    ["says its Mate works on it", session({ status: "working" }), "Working", []],
    ["says its Mate waits for you", session({ status: "waiting" }), "Waiting for you", []],
    ["says its change waits for review", session({ status: "review" }), "Up for review", []],
    [
      "names the pull request its task ended with",
      session({ status: "merged", pullRequest: { ...pullRequest, state: "merged" } }),
      "Merged",
      ["PR #14"],
    ],
    ["says its task was stopped", session({ status: "stopped" }), "Stopped", []],
    ["holds an empty line for a task before its Mate's most recent", session({}), " ", []],
    [
      "names its pull request on GitHub and its checks",
      session({
        status: "review",
        pullRequest: { ...pullRequest, state: "open", checks: "passing" },
      }),
      "Up for review",
      ["PR #14", "checks passing"],
    ],
    [
      "says its Mate works on its pull request again",
      session({
        status: "working",
        pullRequest: { ...pullRequest, state: "open", checks: "failing" },
      }),
      "Working",
      ["PR #14", "checks failing"],
    ],
    [
      "names its merged pull request",
      session({ status: "merged", pullRequest: { ...pullRequest, state: "merged" } }),
      "Merged",
      ["PR #14"],
    ],
  ] as const)("%s", (_case, given, status, facts) => {
    const html = renderToStaticMarkup(<MateTaskSessionBar session={given} task={issue} />);
    expect(statusOf(html)).toBe(status);
    for (const fact of facts) expect(factsOf(html)).toContain(fact);
    if (given.pullRequest !== null)
      expect(html).toContain('href="https://github.com/acme/tea-shop/pull/14"');
  });

  it("says what it cost and how long it worked, and offers Stop only while it can be stopped", () => {
    const working = session({ status: "working", spentUsd: 0.42, workedMs: 12 * 60_000 });
    const html = renderToStaticMarkup(
      <MateTaskSessionBar onStop={() => undefined} session={working} task={issue} />,
    );
    expect(factsOf(html)).toContain("$0.42");
    expect(factsOf(html)).toContain("12m");
    expect(factsOf(html)).toContain("Stop");
    const ended = renderToStaticMarkup(
      <MateTaskSessionBar session={{ ...working, status: "stopped" }} task={issue} />,
    );
    expect(factsOf(ended)).not.toContain("Stop");
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
