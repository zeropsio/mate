/**
 * A place — production or a stage — said on one line, the same wherever it stands: its dot, its
 * name, a word as a pill only where something is not calm (Release failed, Down, Releasing v0.1.4,
 * Deploying…), what runs there in its version, since when, and its address. A calm place says no
 * state word beside its name: its dot carries it. A place where nothing runs says so, muted.
 *
 * Read from the card's `PlaceLine` (`placeLines`), whose words are the menu chip's.
 *
 * Pure: no React.
 */
import { placeAddress } from "../place/place.logic";
import { placeLabel, type PlaceLine } from "../projects/projectCard.logic";
import { PLACE_RUNNING_WORD } from "../SidebarProductionChip.logic";

/** A place's dot tone, as a `Badge` tone: running green, under way blue, broken red, else grey. */
export type PlaceTone = "success" | "info" | "danger" | "neutral";

export interface PlaceLineView {
  /** "Production"; a stage by its own name, capitalised (`environmentTitle`). */
  readonly title: string;
  readonly tone: PlaceTone;
  /** The not-calm word, as a pill in its tone. */
  readonly pill: { readonly word: string; readonly tone: "danger" | "info" } | undefined;
  /** The calm state's word ("Running"), said only where the line stands without its name. */
  readonly state: string | undefined;
  /** What runs, `v0.1.3` or a commit: set in mono. */
  readonly version: string | undefined;
  /** The rest, muted, `·` between: "since Nov 1", "still runs v0.1.3", "Not released yet". */
  readonly facts: ReadonlyArray<string>;
  /** The address it stands for, opened beside the page; none where nothing is deployed. */
  readonly address: { readonly host: string; readonly url: string } | undefined;
}

const VERSION = /^(?:v?\d+(?:\.\d+)+(?:[-+][\w.]+)?|[0-9a-f]{7,40})$/u;

const hostOf = (url: string): string => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

/** The address a place's line stands for: production's own domain first, a stage's subdomain. */
export function placeLineAddress(
  line: Pick<PlaceLine, "kind" | "addresses" | "nothingDeployed">,
): PlaceLineView["address"] {
  if (line.nothingDeployed === true) return undefined;
  const routes = line.addresses.map((address) => ({ host: hostOf(address.url), url: address.url }));
  return placeAddress(line.kind, routes);
}

/** A place's line, split into what each density draws (`PlaceLine` component). */
export function placeLineView(line: PlaceLine): PlaceLineView {
  const title = placeLabel(line);
  const address = placeLineAddress(line);
  const [first, ...rest] = line.words;
  const split = (words: ReadonlyArray<string>) => {
    const at = words.findIndex((word) => VERSION.test(word));
    return {
      version: at === -1 ? undefined : words[at],
      facts: at === -1 ? words : words.filter((_, index) => index !== at),
    };
  };
  switch (line.dot) {
    case "running": {
      const calm = first === PLACE_RUNNING_WORD;
      return {
        title,
        tone: "success",
        pill: undefined,
        state: calm ? first : undefined,
        ...split(calm ? rest : line.words),
        address,
      };
    }
    case "failed":
    case "down":
      return {
        title,
        tone: "danger",
        pill: first === undefined ? undefined : { word: first, tone: "danger" },
        state: undefined,
        version: undefined,
        facts: rest,
        address,
      };
    case "releasing":
      return {
        title,
        tone: "info",
        pill: first === undefined ? undefined : { word: first, tone: "info" },
        state: undefined,
        version: undefined,
        facts: rest,
        address,
      };
    case "none":
    case "unknown":
      return {
        title,
        tone: "neutral",
        pill: undefined,
        state: undefined,
        version: undefined,
        facts: line.words,
        address,
      };
  }
}
