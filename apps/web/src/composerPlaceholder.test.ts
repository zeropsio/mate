import { describe, expect, it } from "vite-plus/test";

import {
  DISCONNECTED_COMPOSER_PLACEHOLDER,
  resolveComposerPlaceholders,
  CHIEF_COMPOSER_PLACEHOLDER,
  DEFAULT_CONNECTED_COMPOSER_PLACEHOLDER,
  ZEROPS_CONNECTED_COMPOSER_PLACEHOLDER,
  taskComposerPlaceholder,
} from "./composerPlaceholder";

describe("resolveComposerPlaceholders", () => {
  it.each([
    {
      name: "a Mate's conversation, its link still being made",
      whoLivesHere: "mate",
      zeropsAvailable: false,
      placeholders: {
        connected: ZEROPS_CONNECTED_COMPOSER_PLACEHOLDER,
        idle: ZEROPS_CONNECTED_COMPOSER_PLACEHOLDER,
      },
    },
    {
      name: "a Mate's conversation, its project read",
      whoLivesHere: "mate",
      zeropsAvailable: true,
      placeholders: {
        connected: ZEROPS_CONNECTED_COMPOSER_PLACEHOLDER,
        idle: ZEROPS_CONNECTED_COMPOSER_PLACEHOLDER,
      },
    },
    {
      name: "a thread with no Mate",
      whoLivesHere: "nobody",
      zeropsAvailable: false,
      placeholders: {
        connected: DEFAULT_CONNECTED_COMPOSER_PLACEHOLDER,
        idle: DISCONNECTED_COMPOSER_PLACEHOLDER,
      },
    },
    // Nobody named yet: no upstream words, nothing guessed; the Mate's words arrive in place.
    {
      name: "a conversation whose Mate is not named yet",
      whoLivesHere: "unknown",
      zeropsAvailable: false,
      placeholders: { connected: "", idle: "" },
    },
  ] as const)(
    "says one thing from the first frame in $name",
    ({ whoLivesHere, zeropsAvailable, placeholders }) => {
      expect(resolveComposerPlaceholders({ whoLivesHere, zeropsAvailable })).toEqual(placeholders);
    },
  );
});

it("a Chief's conversation invites asks across the organization, never what to build", () => {
  for (const zeropsAvailable of [false, true]) {
    expect(
      resolveComposerPlaceholders({ whoLivesHere: "mate", zeropsAvailable, chief: true }),
    ).toEqual({ connected: CHIEF_COMPOSER_PLACEHOLDER, idle: CHIEF_COMPOSER_PLACEHOLDER });
  }
  expect(CHIEF_COMPOSER_PLACEHOLDER).toBe("Ask about anything across your projects…");
});

it("a task's conversation invites the person to tell its Mate about the task, never what to build", () => {
  for (const zeropsAvailable of [false, true]) {
    const said = taskComposerPlaceholder("Raya");
    expect(
      resolveComposerPlaceholders({
        whoLivesHere: "mate",
        zeropsAvailable,
        task: { mate: "Raya" },
      }),
    ).toEqual({ connected: said, idle: said });
  }
  expect(taskComposerPlaceholder("Raya")).toBe("Tell Raya something about this task…");
  expect(taskComposerPlaceholder(null)).toBe("Tell this Mate something about this task…");
});
