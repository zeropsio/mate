/**
 * A remote's address and access token, with the guide that names the exact token for the host
 * typed: the picker's token tab (GitHub or GitLab) and the row's Replace token share it.
 */
import { gitTokenGuide } from "@t3tools/shared/gitTokenGuide";
import { useId } from "react";

import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { OutLink } from "../../settings/automationParts";

/** GitHub's page for a new fine-grained token, before the address names its owner. */
const GITHUB_NEW_TOKEN = "https://github.com/settings/personal-access-tokens/new";

export function GithubTokenFields({
  url,
  onUrl,
  token,
  onToken,
  projectName,
}: {
  readonly url: string;
  /** Absent: the address is the remote's own and only the token changes. */
  readonly onUrl?: (url: string) => void;
  readonly token: string;
  readonly onToken: (token: string) => void;
  readonly projectName: string;
}) {
  const urlId = useId();
  const tokenId = useId();
  const guide = gitTokenGuide(url, projectName);
  return (
    <div className="grid gap-3">
      {onUrl === undefined ? null : (
        <div className="grid gap-1.5">
          <Label htmlFor={urlId}>Repository address</Label>
          <Input
            autoComplete="off"
            autoFocus
            id={urlId}
            nativeInput
            onChange={(event) => onUrl(event.target.value)}
            placeholder="https://gitlab.com/owner/name"
            size="sm"
            spellCheck={false}
            value={url}
          />
        </div>
      )}
      <div className="grid gap-1.5">
        <Label htmlFor={tokenId}>Access token</Label>
        <Input
          aria-describedby={`${tokenId}-guide`}
          autoComplete="off"
          id={tokenId}
          nativeInput
          onChange={(event) => onToken(event.target.value)}
          size="sm"
          type="password"
          value={token}
        />
        <p className="text-xs text-muted-foreground" id={`${tokenId}-guide`}>
          {guide.kind === "guide" ? (
            <>
              <OutLink href={guide.tokenUrl}>Create a token on {guide.hostLabel}</OutLink> ·{" "}
              {guide.repository} · {guide.permission}.
              {guide.host === "github"
                ? " Workflows: Read and write only if a release changes .github/workflows."
                : null}
            </>
          ) : (
            <>
              <OutLink href={GITHUB_NEW_TOKEN}>Create a token on GitHub</OutLink> · Select the
              repository · Contents, Issues and Webhooks: Read and write.
            </>
          )}
        </p>
      </div>
    </div>
  );
}

/** Whether the address names a repository a token can be guided for. */
export const tokenAddressReady = (url: string, projectName: string) =>
  gitTokenGuide(url, projectName).kind === "guide";
