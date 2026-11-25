/**
 * The design harness's pages as the kit's flows: a surface's states over made-up data, drawn from
 * the kit's components. A build serves them where it carries the harness (the dev server and every
 * hosted setup, `zerops.yml`); a build without it lists none and bundles none.
 */
/** The appearance a harness page draws in. */
export type FlowTheme = "light" | "dark";

/** The one query parameter that names a harness page's appearance: `?theme=dark`, else light. */
const THEME_PARAM = "theme";

/** The appearance a harness page's query asks for (`harnessPage.ts` paints it). */
export const flowThemeOf = (search: string): FlowTheme =>
  new URLSearchParams(search).get(THEME_PARAM) === "dark" ? "dark" : "light";

/** A state's page in one appearance: the flow's address, the state's query, then its theme. */
export const flowSrc = (
  flow: KitFlow,
  state: KitFlowState | undefined,
  theme: FlowTheme | undefined,
): string => {
  const params = new URLSearchParams(state?.search ?? "");
  if (theme !== undefined) params.set(THEME_PARAM, theme);
  const query = params.toString();
  return query === "" ? flow.href : `${flow.href}?${query}`;
};

export interface KitFlowState {
  /** Unique in its flow, `idle`. */
  readonly id: string;
  /** A few words for what the page shows, `Idle`. */
  readonly label: string;
  /** The query, without `?` and without its theme, that shows it; empty for the page's default. */
  readonly search: string;
}

export interface KitFlow {
  /** The page's name, `design-overview` for `design-overview.html`. */
  readonly id: string;
  readonly title: string;
  /** The page's address, from the app's base: a frame on any page finds it. */
  readonly href: string;
  /** The harness module the page names, which the harness page loads. */
  readonly module: string;
  /** The part of the product it shows, from the page's `kit-area` meta: `Conversation`. */
  readonly area?: string;
  /**
   * Every state the page shows by its address, from its `kit-states` meta, the default first. The
   * kit reads them from the page's text: a harness module mounts itself on import.
   */
  readonly states?: readonly KitFlowState[];
}

const sources: Readonly<Record<string, string>> =
  import.meta.env.VITE_DESIGN_HARNESS === ""
    ? {}
    : import.meta.glob<string>("/design*.html", { query: "?raw", import: "default", eager: true });

const ENTITIES: Readonly<Record<string, string>> = {
  "&amp;": "&",
  "&#39;": "'",
  "&quot;": '"',
  "&lt;": "<",
  "&gt;": ">",
};

const metaOf = (source: string, name: string): string | undefined => {
  const content = new RegExp(
    `<meta\\s+name="${name}"\\s+content=(?:'([^']*)'|"([^"]*)")`,
    "u",
  ).exec(source);
  const raw = content?.[1] ?? content?.[2];
  return raw?.replace(/&(?:amp|#39|quot|lt|gt);/gu, (entity) => ENTITIES[entity] ?? entity);
};

const isState = (value: unknown): value is KitFlowState =>
  typeof value === "object" &&
  value !== null &&
  "id" in value &&
  typeof value.id === "string" &&
  "label" in value &&
  typeof value.label === "string" &&
  "search" in value &&
  typeof value.search === "string";

/** A page's states; a meta that does not parse lists none, and the page still shows. */
const statesOf = (source: string): readonly KitFlowState[] | undefined => {
  const raw = metaOf(source, "kit-states");
  if (raw === undefined) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isState) : undefined;
  } catch {
    return undefined;
  }
};

export const KIT_FLOWS: readonly KitFlow[] = Object.entries(sources)
  .map(([path, source]): KitFlow => {
    const area = metaOf(source, "kit-area");
    const states = statesOf(source);
    return {
      id: path.slice(1, -".html".length),
      title: (/<title>([^<]*)<\/title>/u.exec(source)?.[1] ?? path)
        .replace(/^Mate — (?:the )?/u, "")
        .replace(/ harness$/u, "")
        .replace(/^\p{Ll}/u, (first) => first.toUpperCase()),
      href: `${import.meta.env.BASE_URL}${path.slice(1)}`,
      module: /<script[^>]*\bsrc="([^"]+)"/u.exec(source)?.[1] ?? "",
      ...(area === undefined ? {} : { area }),
      ...(states === undefined ? {} : { states }),
    };
  })
  .toSorted((left, right) => left.title.localeCompare(right.title));
