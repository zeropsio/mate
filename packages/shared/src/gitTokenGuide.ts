/** Local instructions from a URL; never evidence of remote identity or permissions. */
export function gitTokenGuide(repositoryUrl: string, project: string) {
  const input = repositoryUrl.trim();
  if (input === "") return { kind: "empty" } as const;
  const invalid = { kind: "invalid" } as const;
  // Keep URL normalization from accepting backslashes, dot paths or extra URL fields.
  if (!/^https:\/\/[^/?#\\]+\/[A-Za-z0-9_./-]+$/i.test(input)) return invalid;
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return invalid;
  }
  if (url.username || url.password || url.search || url.hash) return invalid;
  const parts = input
    .slice(input.indexOf("/", input.indexOf("://") + 3) + 1)
    .replace(/\/$/, "")
    .replace(/\.git$/, "")
    .split("/");
  if (parts.length < 2 || parts.some((part) => !part || part === "." || part === ".."))
    return invalid;
  const repository = parts.join("/");
  const owner = parts.slice(0, -1).join("/");
  const host = url.hostname;
  if (host === "github.com" || host.endsWith(".github.com")) {
    if (parts.length !== 2) return invalid;
    const tokenUrl = new URL("https://github.com/settings/personal-access-tokens/new");
    // GitHub's template supports a forty-character name and write includes read.
    let name = "";
    for (const character of `Mate ${project}`) {
      if (name.length + character.length > 40) break;
      name += character;
    }
    tokenUrl.search = new URLSearchParams({
      name,
      target_name: owner,
      expires_in: "366",
      contents: "write",
      workflows: "write",
      // Optional: HQ shows the CI of the commits it pushes with these.
      checks: "read",
      statuses: "read",
      actions: "read",
    }).toString();
    return {
      kind: "guide",
      host: "github",
      hostLabel: "GitHub",
      owner,
      repository,
      tokenUrl: tokenUrl.href,
      permission: "Contents: Read and write",
    } as const;
  }
  if (host === "gitlab.com" || host.startsWith("gitlab.")) {
    return {
      kind: "guide",
      host: "gitlab",
      hostLabel: host,
      owner,
      repository,
      tokenUrl: `${url.origin}/-/user_settings/personal_access_tokens`,
      permission: "write_repository",
    } as const;
  }
  // An arbitrary host is not proof of a forge type; label its likely settings path.
  return {
    kind: "guide",
    host: "unknown",
    hostLabel: host,
    owner,
    repository,
    tokenUrl: `${url.origin}/user/settings/applications`,
    permission: "write:repository",
  } as const;
}
