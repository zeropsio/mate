import { describe, expect, it } from "vite-plus/test";

import {
  DISCONNECTED_COMPOSER_PLACEHOLDER,
  resolveComposerPlaceholders,
  DEFAULT_CONNECTED_COMPOSER_PLACEHOLDER,
  ZEROPS_CONNECTED_COMPOSER_PLACEHOLDER,
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
