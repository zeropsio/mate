import { useId, useState } from "react";
import { gitTokenGuide } from "@t3tools/shared/gitTokenGuide";
import { Input } from "~/components/ui/input";
import { FlatCard } from "./primitives";

export function GitTokenGuide({ project }: { readonly project: string }) {
  const id = useId();
  const [repositoryUrl, setRepositoryUrl] = useState("");
  const guide = gitTokenGuide(repositoryUrl, project);
  return (
    <section aria-label="Direct push token guide" className="flex min-w-0 flex-col gap-3">
      <div>
        <h2 className="text-base font-medium text-foreground">Token for your repository</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Direct push to a branch only. This guide does not connect a repository or check access.
        </p>
      </div>
      <FlatCard>
        <div className="flex min-w-0 flex-col gap-3 p-4">
          <label htmlFor={id} className="text-sm font-medium text-foreground">
            Repository HTTPS URL
          </label>
          <Input
            id={id}
            type="url"
            aria-label="Repository HTTPS URL"
            aria-invalid={guide.kind === "invalid"}
            aria-describedby={`${id}-instructions`}
            placeholder="https://github.com/owner/repository"
            autoComplete="off"
            spellCheck={false}
            value={repositoryUrl}
            onChange={(event) => setRepositoryUrl(event.target.value)}
          />
          <div
            id={`${id}-instructions`}
            className="flex flex-col gap-2 text-sm text-muted-foreground"
          >
            {guide.kind === "empty" ? (
              <p>Enter your repository URL to see which token to create.</p>
            ) : guide.kind === "invalid" ? (
              <p role="alert">
                Enter an HTTPS repository URL, such as https://github.com/owner/repository. SSH URLs
                are not supported.
              </p>
            ) : (
              <>
                <p>
                  {guide.hostLabel} · {guide.repository}
                </p>
                {guide.host === "github" ? (
                  <>
                    <p>
                      Create a fine-grained personal access token. Resource owner: {guide.owner}.
                    </p>
                    <p>
                      Under Repository access, choose <strong>Only select repositories</strong> →{" "}
                      {guide.repository}. The link cannot select the repository for you.
                    </p>
                    <p>
                      {guide.permission} is required. Workflows: Read and write is optional; keep it
                      if releases change .github/workflows. The link includes it.
                    </p>
                    <p>Your organization may require token approval or limit its lifetime.</p>
                  </>
                ) : guide.host === "gitlab" ? (
                  <>
                    <p>
                      Create a personal access token with {guide.permission} for {guide.repository}.
                    </p>
                  </>
                ) : (
                  <>
                    <p>
                      Check {guide.hostLabel}’s token settings. For Gitea or Forgejo, use{" "}
                      {guide.permission}. Other hosts may use different permission names.
                    </p>
                  </>
                )}
                <p>
                  <a
                    className="text-primary underline underline-offset-2"
                    href={guide.tokenUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {guide.host === "unknown"
                      ? "Open likely token settings"
                      : `Create ${guide.host === "github" ? "GitHub fine-grained" : "GitLab personal access"} token`}
                  </a>
                </p>
              </>
            )}
          </div>
        </div>
      </FlatCard>
    </section>
  );
}
