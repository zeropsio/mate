/**
 * The Browser tab's list of a Mate's sites (`mateAddresses`), grouped by where each one runs:
 * Development, the Mate's Preview, the group's Stage, Production, then the tools beside the app
 * (mailpit, adminer). Under a group's heading a row needs only the service's name — the heading
 * already says which one it is — so `nextstoredev` reads "nextstore" under Development.
 *
 * Pure: no React, no store.
 */
import type { MateAddress, MateAddressRole } from "~/zerops/mateAddresses.logic";

export interface BrowserSiteRow {
  readonly address: MateAddress;
  /** The service's name; the group heading says the environment. */
  readonly name: string;
}

export interface BrowserSiteGroup {
  readonly key: MateAddressRole | "tools";
  readonly title: string;
  readonly rows: ReadonlyArray<BrowserSiteRow>;
}

const GROUPS: ReadonlyArray<{ readonly key: BrowserSiteGroup["key"]; readonly title: string }> = [
  { key: "dev", title: "Development" },
  { key: "preview", title: "Preview" },
  { key: "stage", title: "Stage" },
  { key: "production", title: "Production" },
  { key: "tools", title: "Tools" },
];

/** What a workspace's or a preview's hostname adds to the app's name: its half of the pair. */
const PAIR_SUFFIX: Partial<Record<MateAddressRole, string>> = { dev: "dev", preview: "stage" };

function siteName(address: MateAddress): string {
  const suffix = address.role === undefined ? undefined : PAIR_SUFFIX[address.role];
  const { name } = address;
  return suffix !== undefined && name.length > suffix.length && name.endsWith(suffix)
    ? name.slice(0, -suffix.length)
    : name;
}

export function browserSiteGroups(
  addresses: ReadonlyArray<MateAddress>,
): ReadonlyArray<BrowserSiteGroup> {
  return GROUPS.flatMap(({ key, title }) => {
    const rows = addresses
      .filter((address) => (address.role ?? "tools") === key)
      .map((address) => ({ address, name: siteName(address) }));
    return rows.length === 0 ? [] : [{ key, title, rows }];
  });
}
