import { useEffect, useState } from "react";
import { useGitBrowse } from "./useGitBrowse";

/** A file of a commit whose bytes a page shows or saves. */
export interface GitRawRequest {
  readonly appId: string;
  readonly repo: string;
  readonly sha: string;
  readonly path: string;
}

/**
 * A file's bytes (`raw`) as an object URL while `wanted`: read through the data layer, made into
 * a URL here, and revoked when the page lets it go or asks for another file. Never wanted, never
 * read.
 */
export function useGitRaw(request: GitRawRequest, wanted: boolean) {
  const { view, again } = useGitBrowse(
    {
      appId: request.appId,
      repo: request.repo,
      read: "raw",
      params: { sha: request.sha, path: request.path },
    },
    wanted ? true : undefined,
  );
  const blob = view.state === "known" ? view.answer : null;
  const [url, setUrl] = useState<{ readonly of: Blob; readonly href: string } | null>(null);
  useEffect(() => {
    if (blob === null) return;
    const href = URL.createObjectURL(blob);
    setUrl({ of: blob, href });
    return () => URL.revokeObjectURL(href);
  }, [blob]);
  return {
    view,
    again,
    /** The bytes' address while held; none before they arrive. */
    url: url !== null && url.of === blob ? url.href : null,
    type: blob?.type ?? null,
  };
}
