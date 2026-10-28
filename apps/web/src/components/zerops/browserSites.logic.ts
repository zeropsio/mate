/**
 * The Browser tab's list of a Mate's sites (`mateAddresses`), grouped by where each one runs:
 * Development, the Mate's Preview, the group's Stage, Production, then the tools beside the app
 * (mailpit, adminer). Under a group's heading a row needs only its name — a part's friendly name
 * (`mateParts`), or a tool's service — since the heading already says which one it is.
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

export function browserSiteGroups(
  addresses: ReadonlyArray<MateAddress>,
): ReadonlyArray<BrowserSiteGroup> {
  return GROUPS.flatMap(({ key, title }) => {
    const rows = addresses
      .filter((address) => (address.role ?? "tools") === key)
      .map((address) => ({ address, name: address.name }));
    return rows.length === 0 ? [] : [{ key, title, rows }];
  });
}
