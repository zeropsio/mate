import { describe, expect, it } from "vite-plus/test";

import { parseGiteaChangeUrl } from "./giteaChangeLink.ts";

const GITEA = "https://web-30b8-3000.prg1.zerops.app";

describe("a Gitea address read back as a change", () => {
  it("reads the org, the repository and the number", () => {
    expect(parseGiteaChangeUrl(`${GITEA}/links/appdev/pulls/5`, GITEA)).toEqual({
      owner: "links",
      repository: "appdev",
      number: 5,
    });
  });

  it("does not mind a trailing slash, which a paste often carries", () => {
    expect(parseGiteaChangeUrl(`${GITEA}/links/appdev/pulls/5/`, GITEA)?.number).toBe(5);
  });

  it.each([
    { name: "a page below the change", href: `${GITEA}/links/appdev/pulls/5/files` },
    { name: "the list of changes", href: `${GITEA}/links/appdev/pulls` },
    { name: "an issue, which is not a change", href: `${GITEA}/links/appdev/issues/5` },
    { name: "the repository itself", href: `${GITEA}/links/appdev` },
    { name: "a number that is not one", href: `${GITEA}/links/appdev/pulls/nope` },
    { name: "a zeroth change", href: `${GITEA}/links/appdev/pulls/0` },
    { name: "not a url at all", href: "see the pull request" },
  ])("keeps its hands off $name", ({ href }) => {
    expect(parseGiteaChangeUrl(href, GITEA)).toBeNull();
  });

  it("recognises nothing at another forge, whose changes this app cannot read", () => {
    expect(parseGiteaChangeUrl("https://github.com/acme/api/pulls/5", GITEA)).toBeNull();
  });

  it("recognises nothing at all until it is told where its own forge is", () => {
    expect(parseGiteaChangeUrl(`${GITEA}/links/appdev/pulls/5`, undefined)).toBeNull();
    expect(parseGiteaChangeUrl(`${GITEA}/links/appdev/pulls/5`, "")).toBeNull();
    expect(parseGiteaChangeUrl(`${GITEA}/links/appdev/pulls/5`, "not a url")).toBeNull();
  });
});
