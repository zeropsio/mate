/**
 * *Put it live*: the one step from a Mate's first result to an app people can open (the golden
 * path's G6 → G7 → G8). One sheet says what goes live and where — what is merged — one press makes
 * the project's production and releases to it; one line on production says how far HQ got, on
 * every device, its words replacing each other in place; and it ends on the release it runs.
 *
 * It replaces the path the onboarding run walked: a question after the merge (*Add stage* / *Add
 * production* / *Not now*) that left the conversation for the projects page, a two-page form
 * that asked again what it had been told, a checklist on the page, a *Review release* door offered
 * before production could take one, and a release sheet that ended on *Put it on your domain*.
 * Stage stays a later choice, from the project.
 *
 * Pure: what is offered, what the sheet says, and where HQ's run of it stands. The one start is
 * the host's (`PutLiveHost`); HQ makes production and releases to it as its `put_live` operation.
 */
import {
  hqOperationOf,
  operationFailureWords,
  type WaitingPress,
} from "@t3tools/client-runtime/data";
import type { HqOperation } from "@t3tools/client-runtime/zerops/hq";
import type { ProductionShape } from "@t3tools/shared/hqRelease";
import type { HqOperationFailure } from "@t3tools/shared/hqOperationFailure";
import {
  isPlatformSubdomain,
  recipeTierRunning,
  recipeTierServiceTypes,
  type ZeropsCorePackage,
  serviceTypeWords,
} from "@t3tools/client-runtime/zerops";

// ---------------------------------------------------------------------------
// The offer
// ---------------------------------------------------------------------------

/** Why *Put it live* waits while another environment of the page is being set up. */
export const PUT_LIVE_AFTER_CREATION = "Another environment is being set up first.";

/**
 * What a project's door to an environment it lacks says: production's puts the app live, in one
 * step (`PutLiveHost`); a stage's adds it, from the project's form.
 */
export function environmentDoorLabel(tier: "stage" | "production", name: string): string {
  return tier === "production" ? "Put it live" : `Add ${name.toLocaleLowerCase()}`;
}

// ---------------------------------------------------------------------------
// The sheet
// ---------------------------------------------------------------------------

export interface PutLiveSheetModel {
  readonly title: string;
  /**
   * What goes live: the change's title and at most three plain lines of what it does; `undefined`
   * while what is merged is read, the sheet standing in for it and its button waiting.
   */
  readonly what: { readonly title: string; readonly lines: ReadonlyArray<string> } | undefined;
  readonly where: {
    readonly name: string;
    readonly line: string;
    /**
     * What production gets, from the project's setup files: each service the press creates,
     * billed by Zerops — the press approves them, so the sheet names them (HQ refuses a release
     * that creates services nobody saw). `undefined` while the setup files are read.
     */
    readonly creates: ReadonlyArray<PutLiveService> | undefined;
    /**
     * Who production is for, asked before anything is made: each answer with what it makes. Empty
     * where there is nothing to make it from; `undefined` while the setup files are read.
     */
    readonly shapes: ReadonlyArray<PutLiveShapeChoice> | undefined;
    /** The answer picked; none is picked for the person. */
    readonly shape: ProductionShape | undefined;
  };
  /** Stage, offered for later — never asked now; none where the application holds one. */
  readonly later: string | undefined;
  readonly button: string;
  /** Why the button waits, where it does: the setup files being read, or none to make it from. */
  readonly hold: string | undefined;
  /** Pressed here: the run is under way and the button says so (`putLiveSheetUnderWay`). */
  readonly busy?: true | undefined;
  /** Why HQ did not take the last press, said beside the button, which is pressed again. */
  readonly refused?: string | undefined;
  /** HQ holds production: the button leads to it, and nothing here starts another. */
  readonly placed?: true | undefined;
  /** Whether the project's own form for production is offered from the sheet. */
  readonly setUpYourself?: boolean | undefined;
}

/** One answer to who production is for, and what it makes, in the person's words. */
export interface PutLiveShapeChoice {
  readonly shape: ProductionShape;
  readonly title: string;
  readonly line: string;
  /** How many copies run and on which core package: the difference in what it costs, truly said. */
  readonly meta: string;
}

/** A service the press creates in production: its hostname, and what it runs in people's words. */
export interface PutLiveService {
  readonly hostname: string;
  /** "PostgreSQL 18", "Bun 1.4", "Object storage". */
  readonly kind: string;
}

const MAX_LINES = 3;

/**
 * At most three plain lines of what a change does, from its description: its bullets first — each
 * by the name it leads with ("Tea finder — pick a blend by mood…" → "Tea finder"), the
 * review saying the rest — else its sentences; no headings, pictures, code or Markdown marks.
 */
export function putLiveLines(description: string | undefined): ReadonlyArray<string> {
  if (description === undefined) return [];
  const lines: Array<string> = [];
  const bullets: Array<string> = [];
  let fenced = false;
  for (const raw of description.split(/\r?\n/u)) {
    const line = raw.trim();
    if (line.startsWith("```")) {
      fenced = !fenced;
      continue;
    }
    if (fenced || line === "" || line.startsWith("#") || line.startsWith(">")) continue;
    if (/^!\[[^\]]*\]\([^)]*\)$/u.test(line)) continue;
    const bullet = /^(?:[-*+]|\d+[.)])\s+(.*)$/u.exec(line);
    const text = plain(bullet === null ? line : (bullet[1] ?? ""));
    if (text === "") continue;
    if (bullet === null) lines.push(text);
    else bullets.push(/^(.{2,48}?)(?:\s[—–-]\s|:\s)/u.exec(text)?.[1] ?? text);
  }
  return (bullets.length > 0 ? bullets : lines).slice(0, MAX_LINES);
}

function plain(text: string): string {
  return text
    .replace(/!\[[^\]]*\]\([^)]*\)/gu, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/gu, "$1")
    .replace(/(\*\*|__)(.*?)\1/gu, "$2")
    .replace(/(^|\W)[*_](\S.*?\S|\S)[*_](?=\W|$)/gu, "$1$2")
    .replace(/`([^`]*)`/gu, "$1")
    .replace(/\s+/gu, " ")
    .trim();
}

const PUT_LIVE_LATER = "Want somewhere to test first? Add a stage later from the project.";
const RECIPE_READING = "Reading how the project runs…";
export const CHOOSE_SHAPE = "Choose who it's for";
const SETUP_MISSING =
  "The project has no setup files for production yet: ask the Mate to add them.";
const SETUP_UNREADABLE = "The project's setup files can't be read right now.";

const NOTHING_MERGED = "Nothing is merged to put live yet.";
const MERGE_FIRST = "Merge a change first: what is merged goes live.";

const PUT_LIVE_WHERE = {
  name: "Production",
  line: "Its own public address, ready in a few minutes.",
};

/**
 * The sheet, from what goes live: the change it was asked from — or, asked from the project, what
 * is merged, newest first: one change in its own words, several by their titles. Painted once in
 * its final shape: while what is merged is read, it stands in for it and says nothing it takes back.
 */
export function putLiveSheet(input: {
  readonly project: string;
  /** `undefined` while what is merged is read. */
  readonly changes:
    | ReadonlyArray<{
        readonly title: string;
        readonly description?: string | undefined;
      }>
    | undefined;
  /** The production recipe, as read (`useZeropsGroupRecipe`). */
  readonly recipe: "loading" | "present" | "absent" | "unreadable";
  /** The services the recipe creates in production; `undefined` while it is read. */
  readonly creates?: ReadonlyArray<PutLiveService> | undefined;
  /** Who production may be for, from the recipe (`putLiveShapes`); `undefined` while it is read. */
  readonly shapes?: ReadonlyArray<PutLiveShapeChoice> | undefined;
  readonly shape?: ProductionShape | undefined;
  /** Whether the application holds a stage; `undefined` while its environments are read. */
  readonly stageHeld: boolean | undefined;
}): PutLiveSheetModel {
  const { changes } = input;
  const later = input.stageHeld === false ? PUT_LIVE_LATER : undefined;
  const shapes = input.recipe === "loading" ? undefined : (input.shapes ?? []);
  const where = {
    ...PUT_LIVE_WHERE,
    creates: input.recipe === "loading" ? undefined : (input.creates ?? []),
    shapes,
    shape: input.shape,
  };
  if (changes === undefined)
    return {
      title: `Put ${input.project} live`,
      what: undefined,
      where,
      later,
      button: "Put it live",
      hold: undefined,
    };
  const [first] = changes;
  const what =
    first === undefined
      ? { title: NOTHING_MERGED, lines: [] }
      : changes.length === 1
        ? { title: first.title, lines: putLiveLines(first.description) }
        : {
            title: `${changes.length} changes`,
            lines: changes.slice(0, MAX_LINES).map((change) => change.title),
          };
  return {
    title: `Put ${input.project} live`,
    what,
    where,
    later,
    button: "Put it live",
    hold:
      first === undefined
        ? MERGE_FIRST
        : input.recipe === "present"
          ? shapes !== undefined && shapes.length > 0 && input.shape === undefined
            ? CHOOSE_SHAPE
            : undefined
          : input.recipe === "loading"
            ? RECIPE_READING
            : input.recipe === "absent"
              ? SETUP_MISSING
              : SETUP_UNREADABLE,
  };
}

/**
 * The sheet while its project's run is under way: pressed here, its button says it is going live
 * for the moment the sheet stays; a run somebody started before the sheet opened is already on its
 * way, and its button waits.
 */
export function putLiveSheetUnderWay(
  model: PutLiveSheetModel,
  input: { readonly pressedHere: boolean },
): PutLiveSheetModel {
  return input.pressedHere
    ? { ...model, button: "Putting it live…", busy: true, hold: undefined }
    : { ...model, hold: "It's already on its way." };
}

const OTHER_SETUP = "Another setup on this application is running.";
const GIT_ONLY = "Production can be added here only as a Git branch.";

/**
 * The sheet as HQ's answers stand now, on any device: pressed here, its run; HQ holding production,
 * the way to it, for a press elsewhere may have made it while this sheet stood open; else HQ's run,
 * another setup, what HQ offers, and why the button waits.
 */
export function putLiveSheetNow(
  model: PutLiveSheetModel,
  input: {
    readonly pressedHere: boolean;
    /** HQ's `put_live` operation runs on the application. */
    readonly going: boolean;
    /** HQ holds a production of the application. */
    readonly placed: boolean;
    readonly otherSetup: boolean;
    /** HQ offers a Zerops production; `undefined` before it says. */
    readonly zeropsProduction: boolean | undefined;
    /** HQ offers the project's own form for production. */
    readonly setUpOffered: boolean;
    readonly waits: string | undefined;
    readonly refused: string | undefined;
  },
): PutLiveSheetModel {
  if (input.pressedHere)
    return { ...putLiveSheetUnderWay(model, { pressedHere: true }), setUpYourself: false };
  if (input.placed)
    return {
      ...model,
      what: model.what ?? { title: "Production is made", lines: [] },
      where: {
        ...model.where,
        line: "It's made. Its release shows on the project.",
        creates: [],
        shapes: [],
      },
      later: undefined,
      button: "See progress",
      hold: undefined,
      refused: undefined,
      placed: true,
      setUpYourself: false,
    };
  if (input.going)
    return { ...putLiveSheetUnderWay(model, { pressedHere: false }), setUpYourself: false };
  const setUpYourself = input.setUpOffered;
  if (input.otherSetup) return { ...model, hold: OTHER_SETUP, setUpYourself };
  if (input.zeropsProduction === false) return { ...model, hold: GIT_ONLY, setUpYourself };
  if (input.waits !== undefined && model.hold === undefined)
    return { ...model, hold: input.waits, setUpYourself };
  return { ...model, refused: input.refused, setUpYourself };
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

/**
 * Where an application's *Put it live* stands: HQ runs it as its `put_live` operation, and its
 * navigation shows it on the application to every device (`hqOperationOf`). Nothing of it runs or
 * is remembered in a tab.
 *
 * - `going` — HQ makes production, or, `releasing`, releases to it, since `since`.
 * - `review` — production is made, and its release creates something the press did not approve or
 *   reads a value production's vault lacks: the person decides it in the release's review.
 * - `waiting` — the maker's Zerops sign-in ran out: their Continue (`id`) carries it on.
 * - `failed` — it stopped with HQ's failure; Put it live is offered again.
 */
export type PutLiveStanding =
  | { readonly kind: "none" }
  | {
      readonly kind: "going";
      readonly releasing: boolean;
      readonly since: number | undefined;
    }
  | { readonly kind: "review" }
  | {
      readonly kind: "waiting";
      readonly id: string;
      readonly yours: boolean;
      readonly press: WaitingPress;
    }
  | { readonly kind: "failed"; readonly failure: HqOperationFailure };

const NOT_PUT_LIVE: PutLiveStanding = { kind: "none" };

/** HQ's phases of a `put_live` past production's own: the release. */
const RELEASING_PHASES: ReadonlySet<string> = new Set(["release_requested"]);

/** How the application's `put_live` operation stands, for the person HQ read it for. */
export function putLiveOf(operation: HqOperation | undefined): PutLiveStanding {
  const standing = hqOperationOf(operation, "put_live");
  switch (standing.kind) {
    case "none":
      return NOT_PUT_LIVE;
    case "going": {
      const since = operation === undefined ? Number.NaN : Date.parse(operation.at);
      return {
        kind: "going",
        releasing: operation !== undefined && RELEASING_PHASES.has(operation.phase),
        since: Number.isNaN(since) ? undefined : since,
      };
    }
    case "needs":
      return standing.needs === "release_review" ? { kind: "review" } : NOT_PUT_LIVE;
    case "waiting":
      return { kind: "waiting", id: standing.id, yours: standing.yours, press: standing.press };
    case "failed":
      return { kind: "failed", failure: standing.failure };
  }
}

/**
 * Whether the application's *Put it live* holds its release doors: production HQ is making is
 * released by that operation, so no door asks the person to release it meanwhile.
 */
export function putLiveHoldsRelease(operation: HqOperation | undefined): boolean {
  return hqOperationOf(operation, "put_live").kind === "going";
}

/** What production's line says of a *Put it live*: its title, and its step or why it stopped. */
export function putLiveProgress(
  project: string,
  standing: Exclude<PutLiveStanding, { readonly kind: "none" }>,
): { readonly title: string; readonly step: string } {
  switch (standing.kind) {
    case "going":
      return {
        title: `Putting ${project} live`,
        step: standing.releasing ? "Releasing" : "Making production",
      };
    case "review":
      return {
        title: `${project} isn't live yet`,
        step: "Production is made. Its release waits for your review.",
      };
    case "waiting":
      return {
        title: `${project} isn't live yet`,
        step: standing.yours
          ? "Your Zerops sign-in ran out before it finished."
          : "It waits for the person who started it to continue it.",
      };
    case "failed":
      return { title: `${project} isn't live yet`, step: operationFailureWords(standing.failure) };
  }
}

/**
 * A *Put it live* on its project's row in the menu, wherever the person is: under way, its step's
 * words on hover; stopped, why. Nothing with none.
 */
export function putLiveMark(
  project: string,
  standing: PutLiveStanding,
):
  | { readonly kind: "releasing"; readonly tip: string }
  | { readonly kind: "failed"; readonly tip: string }
  | undefined {
  if (standing.kind === "none") return undefined;
  const progress = putLiveProgress(project, standing);
  return standing.kind === "going"
    ? { kind: "releasing", tip: progress.step }
    : { kind: "failed", tip: `${progress.title}: ${progress.step}` };
}

/**
 * The address production leads with, without its scheme: its own domain where it has one — what
 * its people open — else its first address, the platform's.
 */
export function putLiveAddress(
  addresses: ReadonlyArray<{ readonly url: string }>,
): { readonly url: string; readonly host: string } | undefined {
  const first = addresses.find((address) => !isPlatformSubdomain(address.url)) ?? addresses[0];
  if (first === undefined) return undefined;
  return { url: first.url, host: first.url.replace(/^[a-z]+:\/\//iu, "").replace(/\/+$/u, "") };
}

// ---------------------------------------------------------------------------
// What the press approves
// ---------------------------------------------------------------------------

/**
 * The services production's recipe creates, as the sheet names them before the press: each type in
 * the words the release's plan says it by ("PostgreSQL 18", "Valkey 9.0", "File storage"), a
 * runtime by its language and version ("Bun 1.4"), never its base image.
 */
export function putLiveServices(yaml: string): ReadonlyArray<PutLiveService> {
  return (recipeTierServiceTypes(yaml) ?? []).map(({ hostname, type }) => ({
    hostname,
    kind: type === undefined ? hostname : putLiveServiceKind(type),
  }));
}

const COPIES_FOR_CUSTOMERS = 2;

/**
 * The containers a highly available managed service runs on: three, a count its variant fixes (zcp's
 * platform knowledge, `themes/model.md`: `:single` = 1, `:ha` = 3; the published schema pins
 * Elasticsearch's at 3). Storage's highly available variants are left uncounted: what the sources
 * say of them disagrees, so the sheet claims no number for them.
 */
function highlyAvailableCopies(type: string): number | undefined {
  return /^(?:seaweedfs|shared-storage)\b/u.test(type) ? undefined : 3;
}

/**
 * The two answers to who production is for, from its setup files: each says what it makes and
 * how many copies run, and on which core package — the honest difference in cost, since no price
 * list the client can read exists (a resource's price depends on what autoscaling gives it).
 * Trying it out runs one copy of each part; for real customers the services the files make highly
 * available stay so, and each runtime runs on at least two copies.
 */
export function putLiveShapes(yaml: string): ReadonlyArray<PutLiveShapeChoice> {
  const running = recipeTierRunning(yaml) ?? [];
  if (running.length === 0) return [];
  const kinds = new Map(putLiveServices(yaml).map(({ hostname, kind }) => [hostname, kind]));
  const resilient = running.filter((service) => !service.runtime && service.highlyAvailable);
  const counted = running.map((service) =>
    service.runtime
      ? Math.max(service.copies, COPIES_FOR_CUSTOMERS)
      : service.highlyAvailable
        ? highlyAvailableCopies(service.type)
        : 1,
  );
  const forCustomers = counted.reduce<number>((sum, copies) => sum + (copies ?? 0), 0);
  const uncounted = counted.some((copies) => copies === undefined);
  const runtimes = running.filter((service) => service.runtime).length;
  const app =
    runtimes === 0
      ? undefined
      : `${runtimes === 1 ? "the app runs" : "each part of the app runs"} on at least two copies that scale with traffic`;
  const kept =
    resilient.length === 0
      ? undefined
      : `${LIST.format(resilient.map(({ hostname }) => kinds.get(hostname) ?? hostname))} ${resilient.length === 1 ? "keeps" : "keep"} running if a server fails`;
  const said = [kept, app].filter((part) => part !== undefined).join("; ");
  return [
    {
      shape: "small",
      title: "Trying it out",
      line: "One copy of each part, at the smallest size.",
      meta: `${copies(running.length)} · free Lightweight package`,
    },
    {
      shape: "available",
      title: "For real customers",
      line: said === "" ? "As the project's setup files describe it." : `${capitalise(said)}.`,
      meta: `${uncounted ? "At least " : ""}${copies(forCustomers)} · paid Serious package`,
    },
  ];
}

/** The core package production's project is born on, by who it is for. */
export const putLiveCorePackage = (shape: ProductionShape): ZeropsCorePackage =>
  shape === "available" ? "SERIOUS" : "LIGHT";

const LIST = new Intl.ListFormat("en-GB", { style: "long", type: "conjunction" });
const copies = (count: number) => `${count} running ${count === 1 ? "copy" : "copies"}`;
const capitalise = (words: string) => words.charAt(0).toLocaleUpperCase("en-GB") + words.slice(1);

function putLiveServiceKind(type: string): string {
  const words = serviceTypeWords(type.replace(/^(?:alpine|ubuntu)\//u, ""));
  const at = words.indexOf(" · ");
  return (at === -1 ? words : words.slice(at + 3)).replace(/ app\b/u, "");
}
