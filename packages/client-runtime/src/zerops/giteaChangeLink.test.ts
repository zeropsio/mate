import { describe, expect, it } from "vite-plus/test";

import { parseGiteaChangeUrl, resolveGiteaChange } from "./giteaChangeLink.ts";

const GITEA = "https://forge-7c1d-3000.prg1.zerops.app";

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
    { name: "a page below the repository", href: `${GITEA}/links/appdev/src/branch/main` },
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

describe("a link in chat resolved to a change of the person's group", () => {
  const slugs = new Map([
    ["group-1", "links"],
    ["group-2", "orchard"],
  ]);
  const change = { groupId: "group-1", owner: "links", repository: "appdev", number: 5 };
  it.each([
    { name: "the change's own address", href: `${GITEA}/links/appdev/pulls/5`, expected: change },
    {
      name: "the same address a link's own words carry",
      href: `${GITEA}/links/appdev/pulls/5?style=split`,
      expected: change,
    },
    { name: "its files", href: `${GITEA}/links/appdev/pulls/5/files`, expected: change },
    { name: "its commits", href: `${GITEA}/links/appdev/pulls/5/commits`, expected: change },
    {
      name: "a comment on it",
      href: `${GITEA}/links/appdev/pulls/5#issuecomment-12`,
      expected: change,
    },
    {
      name: "its files at an anchor",
      href: `${GITEA}/links/appdev/pulls/5/files#diff-3f2a`,
      expected: change,
    },
    {
      name: "the forge's host in capitals",
      href: `${GITEA.toUpperCase().replace("HTTPS", "https")}/links/appdev/pulls/5`,
      expected: change,
    },
    {
      name: "the org in capitals, as Gitea answers either",
      href: `${GITEA}/Links/appdev/pulls/5`,
      expected: { ...change, owner: "Links" },
    },
    {
      name: "a foreign host",
      href: "https://forge.example.org/links/appdev/pulls/5",
      expected: null,
    },
    { name: "an org no group holds", href: `${GITEA}/strangers/appdev/pulls/5`, expected: null },
    { name: "an issue", href: `${GITEA}/links/appdev/issues/5`, expected: null },
  ])("$name", ({ href, expected }) => {
    expect(resolveGiteaChange(href, GITEA, slugs)).toEqual(expected);
  });
});
