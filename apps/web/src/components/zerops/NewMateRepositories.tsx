import { useChangeOffers } from "~/zerops/useChangeOffers";
import { useGitBrowseReads } from "~/zerops/useGitBrowse";
import { useHqAppDetail } from "~/zerops/useHqAppDetail";
import { GitRepositoryStorage } from "./gitBrowser/GitRepositoryStorage";

/** Repository metadata held only while the Add Mate dialog is open. */
export function NewMateRepositories({ appId }: { readonly appId: string }) {
  const { repos } = useHqAppDetail(appId);
  const allowed = useChangeOffers()(appId)?.read;
  const requests = (repos ?? []).map(({ name }) => ({
    appId,
    repo: name,
    read: "home" as const,
    params: { content: "metadata" as const },
  }));
  const { views } = useGitBrowseReads(requests, allowed);
  if (repos === undefined || repos.length === 0 || allowed !== true) return null;
  return (
    <section aria-label="Repositories" className="flex flex-col gap-3">
      {repos.map(({ name }, index) => {
        const view = views[index];
        return (
          <div className="flex flex-col gap-1" key={name}>
            <p className="text-sm font-medium text-foreground">{name}</p>
            <GitRepositoryStorage
              storage={view?.state === "known" ? view.answer.about.storage : undefined}
            />
          </div>
        );
      })}
    </section>
  );
}
