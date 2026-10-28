/**
 * `home`: a repository's home at the commit `rev` names now (`@t3tools/shared/hqGitBrowse/home`).
 * It moves with its ref: read again on an explicit ask or a new visit, never on a timer.
 *
 * @module zerops/gitBrowse/home
 */
import { GitHome, GitHomeQuery } from "@t3tools/shared/hqGitBrowse/home";

export const homeRead = { query: GitHomeQuery, value: GitHome, moving: true } as const;

/** The GitHub page of a mounted repository, from the remote HQ follows. */
export const githubRepositoryUrl = (remote: { readonly url: string }) =>
  remote.url.replace(/\.git$/u, "");

/** Storage and compressed archives use decimal units; exact source bytes stay in the hint. */
export function formatStorageBytes(bytes: number): string {
  const units = ["B", "kB", "MB", "GB", "TB"];
  let unit = bytes < 1000 ? 0 : Math.min(Math.floor(Math.log10(bytes) / 3), units.length - 1);
  if (unit < units.length - 1 && Number((bytes / 1000 ** unit).toFixed(2)) >= 1000) unit++;
  return unit === 0 ? `${bytes} B` : `${(bytes / 1000 ** unit).toFixed(2)} ${units[unit]}`;
}

/** HQ alone decides whether a repository is large; rounded labels never make that decision. */
export function repositoryStorage(storage: GitHome["about"]["storage"]) {
  return {
    line:
      storage?.usedBytes == null
        ? "Git storage is not available yet."
        : `Git storage: ${formatStorageBytes(storage.usedBytes)} of ${formatStorageBytes(storage.limitBytes)}`,
    large: storage?.large === true,
    hint:
      "Git storage includes history. This repository’s limit, set for your organization." +
      (storage?.usedBytes == null
        ? ""
        : ` ${storage.usedBytes.toLocaleString("en-US")} bytes of ${storage.limitBytes.toLocaleString("en-US")} bytes.`),
  };
}
