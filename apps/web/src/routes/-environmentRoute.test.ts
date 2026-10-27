import { describe, expect, it } from "vite-plus/test";

import {
  addressOpensConversation,
  draftIdFromPathname,
  environmentIdFromAddress,
  environmentIdFromPathname,
} from "./-environmentRoute";

describe("environmentIdFromPathname", () => {
  it.each<[string, string | null]>([
    ["/env-1/thread-1", "env-1"],
    ["/env-1/thread-1/", "env-1"],
    ["/draft/748c8ab9-2b3f-4cf1-97d7-3b99cb061fa0", null],
    ["/settings/archived", null],
    ["/zerops/authorized", null],
    ["/projects/key", null],
    ["/mate/p-quinn", null],
    ["/", null],
    ["/env-1", null],
    ["/env-1/thread-1/extra", null],
  ])("%s → %s", (pathname, expected) => {
    expect(environmentIdFromPathname(pathname)).toBe(expected);
  });
});

// The address bar as a reload finds it, before the router strips the bundle's prefix.
describe("environmentIdFromAddress", () => {
  it.each<[string, string, string | null]>([
    ["/env-1/thread-1", "", "env-1"],
    ["/mate/env-1/thread-1", "/mate", "env-1"],
    ["/mate/p-quinn", "", null],
    ["/mate", "/mate", null],
    ["/mate/", "/mate", null],
    ["/other/env-1/thread-1", "/mate", null],
  ])("%s under %s → %s", (pathname, basePath, expected) => {
    expect(environmentIdFromAddress(pathname, basePath)).toBe(expected);
  });
});

// DESIGN §9 C1b: a draft is its environment's conversation too, suppressed with it.
describe("draftIdFromPathname", () => {
  it.each<[string, string | null]>([
    ["/draft/748c8ab9-2b3f-4cf1-97d7-3b99cb061fa0", "748c8ab9-2b3f-4cf1-97d7-3b99cb061fa0"],
    ["/draft/d-1/", "d-1"],
    ["/env-1/thread-1", null],
    ["/draft", null],
    ["/draft/d-1/extra", null],
  ])("%s → %s", (pathname, expected) => {
    expect(draftIdFromPathname(pathname)).toBe(expected);
  });
});

describe("addressOpensConversation", () => {
  it.each<[string, string, boolean]>([
    ["/mate/env-1/thread-1", "/mate", true],
    ["/mate/draft/draft-1", "/mate", true],
    ["/env-1/thread-1", "", true],
    ["/mate/zerops", "/mate", false],
    ["/mate/mate/project-1", "/mate", false],
    ["/mate/settings/general", "/mate", false],
    ["/mate", "/mate", false],
    ["/other/env-1/thread-1", "/mate", false],
  ])(
    "A reload of %s (served at '%s') opens a conversation, its code fetched at boot: %s",
    (pathname, basePath, opens) => {
      expect(addressOpensConversation(pathname, basePath)).toBe(opens);
    },
  );
});
