/**
 * `home`: a repository's home at the commit `rev` names now (`@t3tools/shared/hqGitBrowse/home`).
 * It moves with its ref: read again on an explicit ask or a new visit, never on a timer.
 *
 * @module zerops/gitBrowse/home
 */
import type { HqRepoStorage } from "@t3tools/contracts";
import { GitHome, GitHomeQuery } from "@t3tools/shared/hqGitBrowse/home";

export const homeRead = { query: GitHomeQuery, value: GitHome, moving: true } as const;

/** The GitHub page of a mounted repository, from the remote HQ follows. */
export const githubRepositoryUrl = (remote: { readonly url: string }) =>
  remote.url.replace(/\.git$/u, "");

/**
 * Storage and compressed archives use binary units, as HQ's whole-GiB cap does: a whole value
 * reads "6 GiB", others up to two decimals; exact source bytes stay in the hint.
 */
export function formatStorageBytes(bytes: number): string {
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  const scaled = (unit: number) => Number((bytes / 1024 ** unit).toFixed(2));
  let unit = bytes < 1024 ? 0 : Math.min(Math.floor(Math.log2(bytes) / 10), units.length - 1);
  if (unit < units.length - 1 && scaled(unit) >= 1024) unit++;
  return unit === 0 ? `${bytes} B` : `${scaled(unit)} ${units[unit]}`;
}

/**
 * The figure as it stands: the repository's storage read (or a set's answer) once it is known,
 * else what its home said; whether it is large stays the home's.
 */
export function currentStorage(
  home: GitHome["about"]["storage"],
  read: Pick<HqRepoStorage, "usedBytes" | "limitBytes"> | null,
): GitHome["about"]["storage"] {
  return read === null
    ? home
    : {
        usedBytes: read.usedBytes,
        limitBytes: read.limitBytes,
        large: home?.large ?? null,
        routeBodyLimitBytes: home?.routeBodyLimitBytes ?? null,
      };
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
