import { assembleRecordCard } from "../components/chat/MessagesTimeline.logic";
/**
 * The run's result in the states pass 16's plan draws it: one result over
 * time — just finished, after the person merges its change, after a later
 * run redeploys its service, if that service stops tonight — then a long
 * run's result (nine pills once) and a run that came back from a failure
 * and whose change landed; then the pictures a run took and looked at, in
 * the strip under its rows. Each stands in the card as a run the person
 * comes back to draws it — its summary line, the result in the band under
 * it — with the facts from outside the run, and the pictures' files, given.
 *
 * Fixtures only: names, hosts, changes and pictures are invented.
 */
import { EnvironmentId, TurnId } from "@t3tools/contracts";
import type { ZeropsOperation } from "@t3tools/client-runtime/zerops/model";
import { useEffect, useState } from "react";

import type { AssetUrlState } from "~/assets/assetUrls";
import type {
  OutcomeLater,
  OutcomeModel,
  OutcomePicture,
  OutcomeService,
} from "~/components/chat/conversation.logic";
import { ExpandedImageDialog } from "~/components/chat/ExpandedImageDialog";
import type { ExpandedImagePreview } from "~/components/chat/ExpandedImagePreview";
import type { MessagesTimelineRow } from "~/components/chat/MessagesTimeline.logic";
import { RunChat } from "~/components/chat/RunChat";
import type {
  ResultChange,
  ResultFacts,
  ResultServiceNow,
} from "~/components/chat/runResult.logic";
import { TurnReport, type ResultFiles } from "~/components/chat/TurnReport";
import { stepOf } from "~/components/chat/workSteps.logic";

const NOW = Date.now();
const ago = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();

const svgUrl = (svg: string) => `data:image/svg+xml;base64,${btoa(svg)}`;

/** A page the run checked, with a picture of it: a flat page drawn on the fly. */
const PICTURE = (() => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="440" height="280" viewBox="0 0 440 280"><rect width="440" height="280" fill="#f6f7f9"/><rect width="440" height="44" fill="#e8ebf0"/><rect x="28" y="84" width="220" height="18" rx="4" fill="#cfd5de"/><rect x="28" y="120" width="360" height="10" rx="3" fill="#dde2e9"/><rect x="28" y="142" width="300" height="10" rx="3" fill="#dde2e9"/><rect x="28" y="164" width="330" height="10" rx="3" fill="#dde2e9"/></svg>`;
  return { src: svgUrl(svg), width: 1440, height: 900 };
})();

/** A desktop page, 1440 × 900, in its own colour: a header, a headline, a grid of cards. */
function desktopPage(accent: string, paper: string): string {
  return svgUrl(
    `<svg xmlns="http://www.w3.org/2000/svg" width="1440" height="900" viewBox="0 0 1440 900"><rect width="1440" height="900" fill="${paper}"/><rect width="1440" height="76" fill="${accent}"/><rect x="64" y="26" width="160" height="24" rx="6" fill="#ffffff" fill-opacity=".85"/><rect x="1128" y="26" width="248" height="24" rx="12" fill="#ffffff" fill-opacity=".35"/><rect x="64" y="140" width="620" height="44" rx="8" fill="#1f2430" fill-opacity=".82"/><rect x="64" y="204" width="480" height="18" rx="5" fill="#1f2430" fill-opacity=".3"/>${[
      0, 1, 2,
    ]
      .map(
        (column) =>
          `<rect x="${64 + column * 448}" y="280" width="416" height="260" rx="18" fill="#ffffff"/><rect x="${96 + column * 448}" y="312" width="180" height="16" rx="5" fill="${accent}" fill-opacity=".7"/><rect x="${96 + column * 448}" y="344" width="320" height="10" rx="4" fill="#1f2430" fill-opacity=".18"/><rect x="${96 + column * 448}" y="364" width="280" height="10" rx="4" fill="#1f2430" fill-opacity=".18"/>`,
      )
      .join("")}</svg>`,
  );
}

/** A phone's screenshot, 1179 × 2556: a status bar, the app's header, its first cards. */
function phonePage(accent: string, paper: string): string {
  return svgUrl(
    `<svg xmlns="http://www.w3.org/2000/svg" width="1179" height="2556" viewBox="0 0 1179 2556"><rect width="1179" height="2556" fill="${paper}"/><rect width="1179" height="150" fill="${accent}"/><rect x="72" y="62" width="110" height="34" rx="10" fill="#ffffff" fill-opacity=".9"/><rect x="900" y="66" width="200" height="28" rx="10" fill="#ffffff" fill-opacity=".6"/><rect y="150" width="1179" height="190" fill="${accent}" fill-opacity=".86"/><rect x="72" y="214" width="420" height="58" rx="14" fill="#ffffff"/><circle cx="1070" cy="244" r="40" fill="#ffffff" fill-opacity=".7"/><rect x="60" y="400" width="1059" height="520" rx="48" fill="#ffffff"/><rect x="108" y="456" width="560" height="54" rx="12" fill="#1f2430" fill-opacity=".8"/><rect x="108" y="540" width="860" height="30" rx="10" fill="#1f2430" fill-opacity=".22"/><rect x="108" y="592" width="760" height="30" rx="10" fill="#1f2430" fill-opacity=".22"/><rect x="108" y="700" width="300" height="120" rx="24" fill="${accent}" fill-opacity=".8"/><rect x="60" y="980" width="1059" height="360" rx="48" fill="#ffffff"/><rect x="108" y="1036" width="480" height="46" rx="12" fill="#1f2430" fill-opacity=".7"/><rect x="108" y="1110" width="880" height="30" rx="10" fill="#1f2430" fill-opacity=".2"/></svg>`,
  );
}

/** A tablet's page, 1640 × 2360: a header, a map, a panel under it. */
function tabletPage(accent: string, paper: string): string {
  return svgUrl(
    `<svg xmlns="http://www.w3.org/2000/svg" width="1640" height="2360" viewBox="0 0 1640 2360"><rect width="1640" height="2360" fill="${paper}"/><rect width="1640" height="140" fill="${accent}"/><rect x="80" y="50" width="220" height="40" rx="10" fill="#ffffff" fill-opacity=".9"/><path d="M0 900 C 400 700 700 1000 1100 820 S 1500 700 1640 760 V1300 H0Z" fill="${accent}" fill-opacity=".35"/><circle cx="820" cy="640" r="30" fill="${accent}"/><rect x="80" y="1400" width="1480" height="700" rx="48" fill="#ffffff"/><rect x="140" y="1470" width="700" height="60" rx="14" fill="#1f2430" fill-opacity=".8"/><rect x="140" y="1570" width="1200" height="34" rx="10" fill="#1f2430" fill-opacity=".22"/></svg>`,
  );
}

/** A whole page captured top to bottom, 1440 × 5200: a hero, then section after section. */
function fullPage(accent: string, paper: string): string {
  return svgUrl(
    `<svg xmlns="http://www.w3.org/2000/svg" width="1440" height="5200" viewBox="0 0 1440 5200"><rect width="1440" height="5200" fill="${paper}"/><rect width="1440" height="76" fill="${accent}"/><rect x="64" y="26" width="160" height="24" rx="6" fill="#ffffff" fill-opacity=".85"/><rect x="64" y="160" width="760" height="64" rx="10" fill="#1f2430" fill-opacity=".85"/><rect x="64" y="250" width="560" height="20" rx="6" fill="#1f2430" fill-opacity=".3"/><rect x="64" y="310" width="200" height="56" rx="14" fill="${accent}"/>${[
      0, 1, 2, 3, 4, 5,
    ]
      .map(
        (section) =>
          `<rect x="64" y="${520 + section * 760}" width="1312" height="620" rx="28" fill="#ffffff"/><rect x="112" y="${568 + section * 760}" width="420" height="30" rx="8" fill="${accent}" fill-opacity=".7"/><rect x="112" y="${624 + section * 760}" width="1100" height="14" rx="5" fill="#1f2430" fill-opacity=".18"/>`,
      )
      .join("")}</svg>`,
  );
}

/** A panorama, 3600 × 900: the whole timeline laid side by side. */
function panoramaPage(accent: string, paper: string): string {
  return svgUrl(
    `<svg xmlns="http://www.w3.org/2000/svg" width="3600" height="900" viewBox="0 0 3600 900"><rect width="3600" height="900" fill="${paper}"/><rect width="3600" height="90" fill="${accent}"/><rect y="440" width="3600" height="12" fill="${accent}" fill-opacity=".5"/>${[
      0, 1, 2, 3, 4, 5, 6, 7,
    ]
      .map(
        (point) =>
          `<circle cx="${220 + point * 450}" cy="446" r="36" fill="${accent}"/><rect x="${120 + point * 450}" y="540" width="200" height="120" rx="18" fill="#ffffff"/>`,
      )
      .join("")}</svg>`,
  );
}

/** A phone turned on its side, 844 × 390: a map with its panel. */
function landscapePage(accent: string, paper: string): string {
  return svgUrl(
    `<svg xmlns="http://www.w3.org/2000/svg" width="844" height="390" viewBox="0 0 844 390"><rect width="844" height="390" fill="${paper}"/><path d="M0 250 C 160 180 260 300 420 230 S 700 150 844 210 V390 H0Z" fill="${accent}" fill-opacity=".35"/><path d="M0 300 C 200 250 320 340 520 290 S 760 250 844 280 V390 H0Z" fill="${accent}" fill-opacity=".55"/><circle cx="430" cy="170" r="14" fill="${accent}"/><circle cx="610" cy="120" r="10" fill="${accent}" fill-opacity=".8"/><rect x="24" y="20" width="230" height="350" rx="22" fill="#ffffff" fill-opacity=".92"/><rect x="48" y="48" width="140" height="20" rx="6" fill="#1f2430" fill-opacity=".8"/><rect x="48" y="86" width="180" height="10" rx="4" fill="#1f2430" fill-opacity=".25"/><rect x="48" y="106" width="150" height="10" rx="4" fill="#1f2430" fill-opacity=".25"/></svg>`,
  );
}

/** Each picture's size in pixels, as a screenshot's header gives it. */
const PHONE = { width: 1179, height: 2556 };
const LANDSCAPE = { width: 844, height: 390 };
const DESKTOP = { width: 1440, height: 900 };
const TABLET = { width: 1640, height: 2360 };
const FULL_PAGE = { width: 1440, height: 5200 };
const PANORAMA = { width: 3600, height: 900 };
const shapeOf = (size: { readonly width: number; readonly height: number }) =>
  size.width / size.height;

function take(key: string, url: string, overrides: Partial<ZeropsOperation> = {}): ZeropsOperation {
  return {
    key,
    kind: "browser",
    phase: "done",
    anchorAt: ago(3),
    anchorActivityId: key,
    settledAt: ago(3),
    turnId: "t1",
    subject: url,
    kicker: `Browser · ${url}`,
    voice: `Checking ${url}`,
    voiceSource: "mate",
    statusWord: "Checked",
    steps: [],
    links: [],
    callIds: [key],
    hasResult: true,
    screenshot: PICTURE,
    ...overrides,
  };
}

/** A check that read the page and took no picture. */
function withoutPicture(check: ZeropsOperation): ZeropsOperation {
  const { screenshot: _screenshot, ...rest } = check;
  return rest;
}

function service(hostname: string, overrides: Partial<OutcomeService> = {}): OutcomeService {
  return {
    hostname,
    tone: "ok",
    word: "Deployed",
    version: null,
    url: null,
    at: ago(2),
    failure: null,
    ...overrides,
  };
}

const NOTHING_LATER: OutcomeLater = {
  services: [],
  changes: [],
  tasks: [],
  pages: [],
  views: [],
  files: [],
  answered: false,
};

function outcome(overrides: Partial<OutcomeModel>): OutcomeModel {
  return {
    key: "outcome:t1",
    turnKey: "t1",
    live: [],
    landed: [],
    files: null,
    checks: null,
    pictures: [],
    created: [],
    notDone: [],
    planLeft: [],
    change: null,
    crewTask: null,
    activity: [],
    later: NOTHING_LATER,
    ...overrides,
  };
}

/** A picture the Mate looked at: a screenshot it took of its own app. */
function looked(path: string): OutcomePicture {
  return { kind: "file", key: `file:${path}`, path, name: path.split("/").at(-1)! };
}

/** A page a check took, by its address. */
function checked(
  key: string,
  url: string,
  src: string,
  device: string | null = null,
  ratio = shapeOf(DESKTOP),
) {
  const address = new URL(url);
  return {
    kind: "check" as const,
    key,
    src,
    caption: address.pathname,
    page: `${address.host}${address.pathname}`,
    device,
    failed: false,
    ratio,
  };
}

const running: ResultServiceNow = { status: "ACTIVE", since: ago(60), versionAt: ago(60) };

function forge(
  open: ReadonlyArray<ResultChange>,
  merged: ReadonlyArray<ResultChange> = [],
): ResultFacts["changes"] {
  return { groupId: "group-snap", open, merged, known: true };
}

const APPDEV = "https://appdev-1f3c-3000.prg1.example.app";
const WORLDSTAGE = "https://worldstage-2b7d.prg1.example.app";
const TURN = TurnId.make("t1");

const STATUS_PAGE: ResultChange = { repository: "app", number: 2, title: "Add a /status page" };
const NOVA = outcome({
  live: [service("appdev", { word: "Dev server running" })],
  checks: { count: 1, views: 1, failures: 0, takes: [take("op:b1", `${APPDEV}/status`)] },
  pictures: [checked("op:b1", `${APPDEV}/status`, PICTURE.src)],
  files: { count: 3, additions: 45, deletions: 3, turnId: TURN, fromTurnId: null },
  change: { repository: "app", number: 2 },
  activity: [
    { kind: "edit", count: 3 },
    { kind: "command", count: 2 },
    { kind: "read", count: 1 },
  ],
});

const WORLD_STATE: ResultChange = {
  repository: "world",
  number: 4,
  title: "Move the world state into its own service",
};
const FEN = outcome({
  live: [
    service("worlddev", { word: "Dev server running" }),
    service("worldstage", { version: "9e2c4b1", url: WORLDSTAGE }),
  ],
  checks: {
    count: 5,
    views: 2,
    failures: 0,
    takes: [
      take("op:b1", `${WORLDSTAGE}/`),
      take("op:b2", `${WORLDSTAGE}/`, { deviceName: "iPhone 16" }),
      take("op:b3", `${WORLDSTAGE}/map`),
      take("op:b4", `${WORLDSTAGE}/map`, { deviceName: "iPhone 16" }),
      take("op:b5", `${WORLDSTAGE}/map`, { deviceName: "iPad Pro" }),
    ],
  },
  pictures: [
    checked(
      "op:b2",
      `${WORLDSTAGE}/`,
      phonePage("#3d5a99", "#eef1f7"),
      "iPhone 16",
      shapeOf(PHONE),
    ),
    checked(
      "op:b5",
      `${WORLDSTAGE}/map`,
      tabletPage("#2f6f5e", "#f1f6f3"),
      "iPad Pro",
      shapeOf(TABLET),
    ),
  ],
  files: { count: 59, additions: 2400, deletions: 529, turnId: TURN, fromTurnId: null },
  change: { repository: "world", number: 4 },
  activity: [
    { kind: "edit", count: 59 },
    { kind: "command", count: 102 },
    { kind: "read", count: 5 },
    { kind: "search", count: 5 },
    { kind: "workflow", count: 3 },
  ],
});

const JUNO = outcome({
  live: [
    service("storedev", { word: "Dev server running" }),
    service("storestage", {
      word: "Healthy",
      version: "5a8d3f0",
      url: "https://storestage-7c1e.prg1.example.app",
    }),
  ],
  landed: [
    {
      key: "landed:54",
      repository: "store",
      number: 54,
      line: "store #54",
      title: "Speed up the product pages",
    },
  ],
  activity: [
    { kind: "edit", count: 2 },
    { kind: "command", count: 66 },
    { kind: "read", count: 5 },
  ],
});

const BROKEN = outcome({
  live: [
    service("appdev", { word: "Dev server running" }),
    service("appstage", {
      tone: "failed",
      word: "Build failing",
      failure: {
        reason: "3 type errors in session.ts",
        at: ago(4),
        logLines: ["src/session.ts(4,7): error TS2322", "Found 3 errors."],
      },
    }),
  ],
  crewTask: { number: 12, title: "Camera rig" },
  planLeft: ["Write the tests for the status route"],
  activity: [{ kind: "command", count: 7 }],
});

// ---------------------------------------------------------------------------
// The pictures
// ---------------------------------------------------------------------------

/** A file the workspace answered for: its address, and the size it read off its header. */
const read = (
  url: string,
  size: { readonly width: number; readonly height: number },
): AssetUrlState => ({ _tag: "Success", url, imageDimensions: size });

const SHOTS = "/var/www/world/.shots";
const HOME_PHONE = `${SHOTS}/home-mobile.png`;
const WORLD_PHONE = `${SHOTS}/world-mobile.png`;
const MAP_LANDSCAPE = `${SHOTS}/map-landscape.png`;

// A long run whose checks took no picture — the stage's front page passed,
// and a check of the page already open — while the Mate screenshotted its
// own app on a phone, upright and on its side, and looked at each.
const LOOKED = outcome({
  live: [
    service("worldstage", { version: "4b7e21a", url: WORLDSTAGE }),
    service("worlddev", { word: "Dev server running" }),
  ],
  checks: {
    count: 2,
    views: 2,
    failures: 0,
    takes: [
      withoutPicture(take("op:c1", `${WORLDSTAGE}/`)),
      withoutPicture(take("op:c2", "the page")),
    ],
  },
  pictures: [looked(HOME_PHONE), looked(WORLD_PHONE), looked(MAP_LANDSCAPE)],
  activity: [
    { kind: "command", count: 102 },
    { kind: "read", count: 5 },
    { kind: "search", count: 5 },
  ],
});
const LOOKED_FILES: ResultFiles = new Map([
  [HOME_PHONE, read(phonePage("#2f6f5e", "#f4f1ea"), PHONE)],
  [WORLD_PHONE, read(phonePage("#3d5a99", "#eef1f7"), PHONE)],
  [MAP_LANDSCAPE, read(landscapePage("#2f6f5e", "#e7efe9"), LANDSCAPE)],
]);

// The same page checked on a phone and on a desktop: each picture whole, in
// its own shape, at the strip's one height.
const PHONE_AND_DESKTOP = outcome({
  live: [service("worldstage", { version: "4b7e21a", url: WORLDSTAGE })],
  checks: {
    count: 2,
    views: 2,
    failures: 0,
    takes: [
      take("op:p1", `${WORLDSTAGE}/`, { deviceName: "iPhone 16" }),
      take("op:p2", `${WORLDSTAGE}/map`),
    ],
  },
  pictures: [
    checked(
      "op:p1",
      `${WORLDSTAGE}/`,
      phonePage("#3d5a99", "#eef1f7"),
      "iPhone 16",
      shapeOf(PHONE),
    ),
    checked(
      "op:p2",
      `${WORLDSTAGE}/map`,
      desktopPage("#2f6f5e", "#f1f6f3"),
      null,
      shapeOf(DESKTOP),
    ),
  ],
  activity: [{ kind: "command", count: 9 }],
});

// A page captured whole, top to bottom, and a panorama: past what a tile
// holds, each shows its top.
const PANORAMA_SHOT = `${SHOTS}/timeline-wide.png`;
const PAST_THE_TILE = outcome({
  live: [service("worldstage", { version: "4b7e21a", url: WORLDSTAGE })],
  checks: {
    count: 2,
    views: 2,
    failures: 0,
    takes: [take("op:f1", `${WORLDSTAGE}/`), take("op:f2", `${WORLDSTAGE}/pricing`)],
  },
  pictures: [
    checked("op:f1", `${WORLDSTAGE}/`, fullPage("#6b4fa3", "#f6f3fb"), null, shapeOf(FULL_PAGE)),
    checked(
      "op:f2",
      `${WORLDSTAGE}/pricing`,
      desktopPage("#b0532c", "#faf6f2"),
      null,
      shapeOf(DESKTOP),
    ),
    looked(PANORAMA_SHOT),
  ],
  activity: [{ kind: "command", count: 6 }],
});
const PAST_THE_TILE_FILES: ResultFiles = new Map([
  [PANORAMA_SHOT, read(panoramaPage("#2f6f5e", "#eef4f0"), PANORAMA)],
]);

// Nine pictures: four pages checked on a desktop, five screenshots looked at.
const NINE_PATHS = ["cart", "checkout", "search", "account", "orders"].map(
  (page) => `/var/www/store/.shots/${page}-mobile.png`,
);
const NINE = outcome({
  live: [
    service("storestage", {
      word: "Healthy",
      version: "8c1d9e2",
      url: "https://storestage-7c1e.prg1.example.app",
    }),
  ],
  pictures: [
    checked(
      "op:d1",
      "https://storestage-7c1e.prg1.example.app/",
      desktopPage("#b0532c", "#faf6f2"),
      null,
      shapeOf(DESKTOP),
    ),
    looked(NINE_PATHS[0]!),
    checked(
      "op:d2",
      "https://storestage-7c1e.prg1.example.app/products",
      desktopPage("#3d5a99", "#f3f5fa"),
      null,
      shapeOf(DESKTOP),
    ),
    looked(NINE_PATHS[1]!),
    checked(
      "op:d3",
      "https://storestage-7c1e.prg1.example.app/cart",
      desktopPage("#6b4fa3", "#f6f3fb"),
      null,
      shapeOf(DESKTOP),
    ),
    looked(NINE_PATHS[2]!),
    looked(NINE_PATHS[3]!),
    checked(
      "op:d4",
      "https://storestage-7c1e.prg1.example.app/checkout",
      desktopPage("#2f6f5e", "#f1f6f3"),
      null,
      shapeOf(DESKTOP),
    ),
    looked(NINE_PATHS[4]!),
  ],
  activity: [{ kind: "command", count: 31 }],
});
const NINE_FILES: ResultFiles = new Map(
  NINE_PATHS.map((path, index) => [
    path,
    read(
      phonePage(["#b0532c", "#3d5a99", "#6b4fa3", "#2f6f5e", "#8a6d1f"][index]!, "#f7f5f1"),
      PHONE,
    ),
  ]),
);

// A run that changed nothing it leaves running: it only looked.
const ONLY_PICTURES = outcome({
  pictures: [looked(HOME_PHONE), looked(MAP_LANDSCAPE)],
  activity: [
    { kind: "command", count: 4 },
    { kind: "read", count: 2 },
  ],
});

// A screenshot still being read, and one the Mate deleted since.
const GONE = outcome({
  live: [service("worlddev", { word: "Dev server running" })],
  pictures: [looked(MAP_LANDSCAPE), looked(HOME_PHONE), looked(WORLD_PHONE)],
  activity: [{ kind: "command", count: 12 }],
});
const GONE_FILES: ResultFiles = new Map([
  [HOME_PHONE, read(phonePage("#2f6f5e", "#f4f1ea"), PHONE)],
  [WORLD_PHONE, { _tag: "Failure" }],
]);
const GONE_FILES_READ: ResultFiles = new Map([
  ...GONE_FILES,
  [MAP_LANDSCAPE, read(landscapePage("#2f6f5e", "#e7efe9"), LANDSCAPE)],
]);

/** `?late`: the file still being read is read a moment after the first frame, as a workspace answers. */
const LATE = new URLSearchParams(location.search).has("late");

interface ResultState {
  readonly label: string;
  readonly note: string;
  readonly outcome: OutcomeModel;
  readonly facts: ResultFacts;
  /** How long it worked, in minutes. */
  readonly minutes: number;
  readonly files?: ResultFiles;
}

const STATES: ReadonlyArray<ResultState> = [
  {
    label: "Just finished",
    note: "The change waits for review; the app runs, its page checked, its picture in the strip.",
    outcome: NOVA,
    facts: { changes: forge([STATUS_PAGE]), services: new Map([["appdev", running]]) },
    minutes: 1.34,
  },
  {
    label: "After you merge #2",
    note: "The change left the result once it was merged; in the app, the line says merged as #2.",
    outcome: NOVA,
    facts: { changes: forge([], [STATUS_PAGE]), services: new Map([["appdev", running]]) },
    minutes: 1.34,
  },
  {
    label: "After a later run redeploys appdev",
    note: "appdev shows under that run now; what this run saw stays, in its strip.",
    outcome: { ...NOVA, later: { ...NOTHING_LATER, services: ["appdev"], answered: true } },
    facts: { changes: forge([], [STATUS_PAGE]), services: new Map([["appdev", running]]) },
    minutes: 1.34,
  },
  {
    label: "If appdev stops tonight",
    note: "Still this run's service, and broken now: back in red, with its fix.",
    outcome: NOVA,
    facts: {
      changes: forge([], [STATUS_PAGE]),
      services: new Map([["appdev", { status: "STOPPED", since: ago(95), versionAt: ago(60) }]]),
    },
    minutes: 1.34,
  },
  {
    label: "Fen's 1 h 31 m run",
    note: "Nine identical pills once, the change fourth: the change first now.",
    outcome: FEN,
    facts: { changes: forge([WORLD_STATE]) },
    minutes: 91,
  },
  {
    label: "Juno's 2 h 8 m run",
    note: "A failure it recovered from is the work's; the change that landed is the line's.",
    outcome: JUNO,
    facts: {},
    minutes: 128,
  },
  {
    label: "Broken, a task to land, a step left",
    note: "Still broken first, then what waits for you, then what runs.",
    outcome: BROKEN,
    facts: {
      crew: {
        environmentId: EnvironmentId.make("environment-local"),
        tasks: new Map([[12, { id: "task-12", state: "ready", owner: "rules" }]]),
      },
    },
    minutes: 6,
  },
  {
    label: "Pictures it looked at",
    note: "Its checks took none; the screenshots it took of its own app and looked at are the strip. A check of the page already open is no row.",
    outcome: LOOKED,
    facts: {},
    minutes: 91,
    files: LOOKED_FILES,
  },
  {
    label: "A phone beside a desktop",
    note: "The same stage checked on a phone and on a desktop: each picture whole, in its own shape, at the strip's one height.",
    outcome: PHONE_AND_DESKTOP,
    facts: {},
    minutes: 8,
  },
  {
    label: "Past what a tile holds",
    note: "A page captured top to bottom and a panorama: each clamped, showing its top.",
    outcome: PAST_THE_TILE,
    facts: {},
    minutes: 11,
    files: PAST_THE_TILE_FILES,
  },
  {
    label: "Nine pictures",
    note: "Six tiles, the sixth saying how many more; the viewer holds all nine.",
    outcome: NINE,
    facts: {},
    minutes: 24,
    files: NINE_FILES,
  },
  {
    label: "Only pictures",
    note: "Nothing it leaves running: the strip is the whole result.",
    outcome: ONLY_PICTURES,
    facts: {},
    minutes: 3,
    files: LOOKED_FILES,
  },
  {
    label: "A file gone, one still read",
    note: "One on its way is a quiet tile in a desktop's room, at the strip's height; with ?late it is read after 1.2 s and takes its shape. One deleted since keeps its tile, muted.",
    outcome: GONE,
    facts: {},
    minutes: 12,
    files: GONE_FILES,
  },
];

type RecordRow = Extract<MessagesTimelineRow, { kind: "record" }>;

/** The run as a person who comes back to it reads it: its summary line, "Show work" beside it. */
function record(key: string, state: ResultState): RecordRow {
  const row: Omit<RecordRow, "chatItems" | "paging" | "hasWork" | "slot"> = {
    kind: "record" as const,
    id: `record:${key}`,
    createdAt: ago(state.minutes),
    turnKey: key,
    live: false,
    items: [
      {
        kind: "step",
        key: `step:${key}`,
        at: ago(state.minutes / 2),
        step: stepOf(
          {
            id: `${key}-w1`,
            createdAt: ago(state.minutes / 2),
            label: "Command run",
            tone: "tool",
            itemType: "command_execution",
            command: "pnpm build",
            sourceActivityKind: "tool.completed",
            toolLifecycleStatus: "completed",
          },
          undefined,
          false,
        ),
      },
    ],
    now: null,
    answering: false,
    status: {
      live: false,
      face: "produced",
      startedAt: ago(state.minutes),
      endedAt: ago(0),
      waitedMs: 0,
      waitingSince: null,
      worked: true,
    },
    outcome: state.outcome,
  };
  return { ...row, ...assembleRecordCard(row) };
}

export function ResultStates() {
  // A picture clicked opens the app's own viewer, on every picture of its run.
  const [preview, setPreview] = useState<ExpandedImagePreview | null>(null);
  const [answered, setAnswered] = useState(false);
  useEffect(() => {
    if (!LATE) return;
    const timer = setTimeout(() => setAnswered(true), 1200);
    return () => clearTimeout(timer);
  }, []);
  return (
    <>
      {STATES.map((state, index) => (
        <section key={state.label} className="grid gap-2" data-harness-state={state.label}>
          <div>
            <h2 className="font-medium text-foreground text-sm">{state.label}</h2>
            <p className="text-muted-foreground text-xs">{state.note}</p>
          </div>
          <div>
            <div className="run-tray run-tray-top">
              <RunChat row={record(`result-${index}`, state)} />
            </div>
            <div className="run-tray run-tray-middle pt-1">
              <div className="run-band">
                <TurnReport
                  facts={state.facts}
                  onOpenImage={setPreview}
                  onOpenTurnDiff={() => undefined}
                  outcome={state.outcome}
                  {...(state.files === undefined
                    ? {}
                    : {
                        files:
                          answered && state.files === GONE_FILES ? GONE_FILES_READ : state.files,
                      })}
                />
              </div>
            </div>
            <div className="run-tray run-tray-bottom" />
          </div>
        </section>
      ))}
      {preview === null ? null : (
        <ExpandedImageDialog onClose={() => setPreview(null)} preview={preview} />
      )}
    </>
  );
}
