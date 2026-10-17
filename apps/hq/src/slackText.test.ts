import { assert, describe, it } from "@effect/vitest";

import { askOf, statusText, titleOf } from "./slackText.ts";

describe("an ask from Slack", () => {
  it.each([
    ["<@U0MATE> brew more tea", "brew more tea"],
    ["brew <@U0MATE|mate> more tea", "brew  more tea"],
    ["<@U0MATE> ask <@U0RHEA|rhea> and <@U0KIM>", "ask @rhea and @U0KIM"],
    ["<@U0MATE> see <#C0SUPPORT|support> or <#C0OPS>", "see #support or #C0OPS"],
    ["<@U0MATE> <!here> <!subteam^S1|@tea-team> <!date^1|tomorrow>", "@here @tea-team tomorrow"],
    [
      "<@U0MATE> <https://acme.test/menu|the menu>, <https://acme.test> and <mailto:nova@acme.test|nova@acme.test>",
      "the menu (https://acme.test/menu), https://acme.test and nova@acme.test",
    ],
    ["<@U0MATE> 1 &lt; 2 &amp;&amp; 3 &gt; 2", "1 < 2 && 3 > 2"],
    ["<@U0MATE>   ", ""],
  ])("reads %j as %j: Mate's mention out, Slack's markup in plain words", (text, ask) => {
    assert.strictEqual(askOf(text, "U0MATE"), ask);
  });

  it("titles a task by the ask's first line that says something", () => {
    assert.strictEqual(titleOf("\n  Hotter tea  \nand faster"), "Hotter tea");
    assert.strictEqual(titleOf("x".repeat(300)).length, 256);
  });
});

describe("a task's status in its Slack thread", () => {
  it("says the task's words as Slack shows them literally, its links as links", () => {
    assert.strictEqual(
      statusText({ kind: "failed", mate: "Fen <3", why: "tests & build failed" }),
      "Fen &lt;3 couldn't finish this: tests &amp; build failed",
    );
    assert.strictEqual(
      statusText({ kind: "change", mate: "Fen", link: "https://mate.zerops.io/c/1|x>" }),
      "Fen opened a change for review: <https://mate.zerops.io/c/1%7Cx%3E>",
    );
    assert.strictEqual(
      statusText({ kind: "stopped", mate: null, why: "The Slack thread was deleted." }),
      "Stopped: The Slack thread was deleted.",
    );
  });
});
