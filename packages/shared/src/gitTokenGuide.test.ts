import { describe, expect, it } from "vite-plus/test";
import { gitTokenGuide } from "./gitTokenGuide.ts";

describe("direct token instructions", () => {
  it("creates only the direct GitHub token template for the URL's resource owner", () => {
    const guide = gitTokenGuide(" https://github.com/acme/widgets.git/ ", "Shop & Tools");
    expect(guide).toEqual({
      kind: "guide",
      host: "github",
      hostLabel: "GitHub",
      owner: "acme",
      repository: "acme/widgets",
      permission: "Contents, Issues and Webhooks: Read and write",
      tokenUrl:
        "https://github.com/settings/personal-access-tokens/new?name=Mate+Shop+%26+Tools&target_name=acme&expires_in=366&contents=write&workflows=write&checks=read&statuses=read&actions=read&issues=write&repository_hooks=write",
    });
  });
  it.each(["&".repeat(60), "😀".repeat(60)])(
    "encodes a token name within forty characters without splitting a character: %s",
    (project) => {
      const guide = gitTokenGuide("https://github.com/acme/widgets", project);
      expect(guide.kind).toBe("guide");
      if (guide.kind !== "guide") throw new Error("Guide missing");
      const name = new URL(guide.tokenUrl).searchParams.get("name")!;
      expect(name.length).toBeLessThanOrEqual(40);
      expect(name).toBe(
        project.startsWith("&") ? "Mate " + "&".repeat(35) : "Mate " + "😀".repeat(17),
      );
      expect(name).not.toContain("�");
    },
  );
  it.each([
    [
      "https://gitlab.com/team/subgroup/widgets.git",
      "gitlab",
      "team/subgroup",
      "write_repository",
      "https://gitlab.com/-/user_settings/personal_access_tokens",
    ],
    [
      "https://gitlab.example.org/team/widgets",
      "gitlab",
      "team",
      "write_repository",
      "https://gitlab.example.org/-/user_settings/personal_access_tokens",
    ],
    [
      "https://forge.example.org/team/widgets",
      "unknown",
      "team",
      "write:repository",
      "https://forge.example.org/user/settings/applications",
    ],
    [
      "https://github.com.example.org/team/widgets",
      "unknown",
      "team",
      "write:repository",
      "https://github.com.example.org/user/settings/applications",
    ],
  ])(
    "uses the host's vocabulary without claiming verified identity: %s",
    (url, host, owner, permission, tokenUrl) => {
      expect(gitTokenGuide(url, "Shop")).toMatchObject({
        kind: "guide",
        host,
        owner,
        permission,
        tokenUrl,
      });
    },
  );
  it.each([
    "git@github.com:acme/widgets.git",
    "ssh://git@github.com/acme/widgets",
    "http://github.com/acme/widgets",
    "not a URL",
    "https://github.com/acme",
    "https://github.com/acme/widgets/tree/main",
    "https://github.com/acme/widgets?token=secret",
    "https://github.com/acme/widgets#token",
    "https://user:secret@github.com/acme/widgets",
    "https://github.com/acme/../widgets",
    "https://github.com/acme//widgets",
    "https://github.com/acme/widgets\\extra",
    "https://github.com/acme/%77idgets",
  ])("refuses malformed, credential-bearing and non-HTTPS repository URLs: %s", (url) => {
    expect(gitTokenGuide(url, "Shop")).toEqual({ kind: "invalid" });
  });
  it("keeps an empty URL distinct from an invalid one", () => {
    expect(gitTokenGuide("  ", "Shop")).toEqual({ kind: "empty" });
  });
});
