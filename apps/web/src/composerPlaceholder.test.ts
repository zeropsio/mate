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
      mateHere: true,
      zeropsAvailable: false,
      placeholders: {
        connected: ZEROPS_CONNECTED_COMPOSER_PLACEHOLDER,
        idle: ZEROPS_CONNECTED_COMPOSER_PLACEHOLDER,
      },
    },
    {
      name: "a Mate's conversation, its project read",
      mateHere: true,
      zeropsAvailable: true,
      placeholders: {
        connected: ZEROPS_CONNECTED_COMPOSER_PLACEHOLDER,
        idle: ZEROPS_CONNECTED_COMPOSER_PLACEHOLDER,
      },
    },
    {
      name: "a thread with no Mate",
      mateHere: false,
      zeropsAvailable: false,
      placeholders: {
        connected: DEFAULT_CONNECTED_COMPOSER_PLACEHOLDER,
        idle: DISCONNECTED_COMPOSER_PLACEHOLDER,
      },
    },
  ])(
    "says one thing from the first frame in $name",
    ({ mateHere, zeropsAvailable, placeholders }) => {
      expect(resolveComposerPlaceholders({ mateHere, zeropsAvailable })).toEqual(placeholders);
    },
  );
});
