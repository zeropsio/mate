// @effect-diagnostics nodeBuiltinImport:off - native Node smart HTTP and real git process boundary.
import * as NodeFSP from "node:fs/promises";
import * as NodeNet from "node:net";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import { GitError } from "./api.ts";

const blocked = new NodeNet.BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.168.0.0", 16],
  ["224.0.0.0", 3],
] as const) {
  blocked.addSubnet(address, prefix, "ipv4");
}
for (const [address, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["64:ff9b::", 96],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const) {
  blocked.addSubnet(address, prefix, "ipv6");
}
const internal = /(?:^|\.)(?:localhost|local|internal|zerops|zerops-project)$/;

/** Literal host check only: a public name that resolves to a private address is not caught here. */
export const defaultImportHost = (host: string): boolean => {
  const name = host.replace(/\.$/, "").toLowerCase();
  const family = NodeNet.isIP(name);
  if (family !== 0) return !blocked.check(name, family === 6 ? "ipv6" : "ipv4");
  // Single-label names are Zerops service hostnames (db, zcp) on the project network.
  return name.includes(".") && !internal.test(name);
};

export interface ImportPolicy {
  readonly root: string;
  readonly importRoots: ReadonlyArray<string>;
  readonly allowHost: (host: string) => boolean;
}
const refused = (message: string) =>
  new GitError({ operation: "import", reason: "source_refused", message });
const realpath = (path: string) => NodeFSP.realpath(path).catch(() => null);
const within = (path: string, base: string | null) =>
  base !== null && (path === base || path.startsWith(`${base}${NodePath.sep}`));

/** Public sources are https only; local ones only under an import root and never under root. */
export const resolveSource = async (
  source: string,
  policy: ImportPolicy,
): Promise<{ readonly source: string; readonly protocol: "file" | "https" }> => {
  const url = NodePath.isAbsolute(source) ? null : URL.parse(source);
  if (url?.protocol === "https:") {
    if (url.username || url.password || url.search || url.hash)
      throw refused("Import URL must not carry credentials, query, or fragment");
    if (!policy.allowHost(url.hostname.replace(/^\[|\]$/g, "")))
      throw refused("Import host refused");
    return { source: url.href, protocol: "https" };
  }
  let path = url === null && NodePath.isAbsolute(source) ? source : null;
  if (url?.protocol === "file:" && !url.search && !url.hash) {
    try {
      path = NodeURL.fileURLToPath(url);
    } catch {
      throw refused("Local import source refused");
    }
  }
  if (path === null) throw refused("Import source must be an https URL");
  // Compare resolved paths, so a symlink inside an import root cannot reach another app.
  const real = await realpath(path);
  const roots = await Promise.all(policy.importRoots.map(realpath));
  if (
    !real ||
    within(real, await realpath(policy.root)) ||
    !roots.some((base) => within(real, base))
  )
    throw refused("Local import source refused");
  return { source: real, protocol: "file" };
};
