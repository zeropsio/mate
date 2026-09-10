import { describe, expect, it } from "vite-plus/test";

import { environmentIdFromPathname } from "./-environmentRoute";

describe("environmentIdFromPathname", () => {
  it.each<[string, string | null]>([
    ["/env-1/thread-1", "env-1"],
    ["/env-1/thread-1/", "env-1"],
    ["/draft/748c8ab9-2b3f-4cf1-97d7-3b99cb061fa0", null],
    ["/settings/archived", null],
    ["/zerops/authorized", null],
    ["/projects/key", null],
    ["/", null],
    ["/env-1", null],
    ["/env-1/thread-1/extra", null],
  ])("%s → %s", (pathname, expected) => {
    expect(environmentIdFromPathname(pathname)).toBe(expected);
  });
});
