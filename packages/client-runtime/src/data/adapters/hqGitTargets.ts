/** Git facts ride the application's existing detail stream; no independent observation. */
import { HqGitAdoption, HqRemoteProbe, RepoName } from "@t3tools/shared/hqChanges";
import { HqDeliveryAnswer } from "@t3tools/shared/hqDeploys";
import { HqGitReleasePreflight } from "@t3tools/shared/hqRelease";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

export type HqGitTargetRecord =
  | { readonly kind: "probe"; readonly repo: string; readonly value: HqRemoteProbe }
  | { readonly kind: "preflight"; readonly repo: string; readonly value: HqGitReleasePreflight }
  | { readonly kind: "adoption"; readonly repo: string; readonly value: HqGitAdoption }
  | { readonly kind: "delivery"; readonly value: HqDeliveryAnswer };

const readProbe = Schema.decodeUnknownOption(HqRemoteProbe);
const readPreflight = Schema.decodeUnknownOption(HqGitReleasePreflight);
const readAdoption = Schema.decodeUnknownOption(HqGitAdoption);
const readDelivery = Schema.decodeUnknownOption(HqDeliveryAnswer);

/** The repository identity comes from the record key, never from a token or a project address. */
export function isHqGitTargetKey(key: string): boolean {
  if (key === "delivery") return true;
  const [kind, ...parts] = key.split(":");
  return (
    (kind === "probe" || kind === "preflight" || kind === "adoption") &&
    Schema.is(RepoName)(parts.join(":"))
  );
}

export function decodeHqGitTarget(raw: unknown, key: string): HqGitTargetRecord | null {
  if (!isHqGitTargetKey(key)) return null;
  if (key === "delivery") {
    const value = Option.getOrNull(readDelivery(raw));
    return value === null ? null : { kind: "delivery", value };
  }
  const separator = key.indexOf(":");
  const kind = key.slice(0, separator);
  const repo = key.slice(separator + 1);
  if (kind === "probe") {
    const value = Option.getOrNull(readProbe(raw));
    return value === null ? null : { kind, repo, value };
  }
  if (kind === "preflight") {
    const value = Option.getOrNull(readPreflight(raw));
    return value === null || value.repo !== repo ? null : { kind, repo, value };
  }
  const value = Option.getOrNull(readAdoption(raw));
  return value === null || value.repo !== repo ? null : { kind: "adoption", repo, value };
}
