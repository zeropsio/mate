/**
 * The design harness's pages as the kit's flows: a surface's states over made-up data, drawn from
 * the kit's components. A build serves them only where it carries the harness (the dev server, a
 * Mate's preview, the hosted harness); production lists none and bundles none.
 */
export interface KitFlow {
  /** The page's name, `design-overview` for `design-overview.html`. */
  readonly id: string;
  readonly title: string;
  /** The page's address, from the app's base: a frame on any page finds it. */
  readonly href: string;
  /** The harness module the page names, which the harness page loads. */
  readonly module: string;
}

const sources: Readonly<Record<string, string>> =
  import.meta.env.VITE_DESIGN_HARNESS === ""
    ? {}
    : import.meta.glob<string>("/design*.html", { query: "?raw", import: "default", eager: true });

export const KIT_FLOWS: readonly KitFlow[] = Object.entries(sources)
  .map(([path, source]) => ({
    id: path.slice(1, -".html".length),
    title: (/<title>([^<]*)<\/title>/u.exec(source)?.[1] ?? path)
      .replace(/^Mate — (?:the )?/u, "")
      .replace(/ harness$/u, ""),
    href: `${import.meta.env.BASE_URL}${path.slice(1)}`,
    module: /<script[^>]*\bsrc="([^"]+)"/u.exec(source)?.[1] ?? "",
  }))
  .toSorted((left, right) => left.title.localeCompare(right.title));
