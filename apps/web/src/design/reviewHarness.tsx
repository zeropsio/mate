/**
 * A project row's Review and Release tags and their changes popover, at the menu's real width.
 *
 * Served by the dev server at `/design-review.html` (`?theme=dark`, `?open=Orbit` opens Orbit's
 * popover, `?live=1500` changes Orbit's list on its own). Rows stand on the menu's ground as the menu draws them; the buttons under them change
 * a project's items live, so the count's roll, a tag's arrival and an item leaving an open
 * popover can be watched. Fixtures only, with invented names: nothing here ships.
 *
 * Tea, Kettle, Saucer and Harbor are applications that limit who merges (Ada K. and Sam R. do):
 * Tea, Kettle and Saucer as a person who cannot merge there reads them — changes ready for their
 * ask, changes they asked for, one of each — and Harbor as Ada K. does, with a change Dana L.
 * asked her to merge. Under the menu, each project's tags again as the conversation's header
 * draws them (`HeaderReviewDoor`).
 *
 * Grove holds only a colleague's changes (listed, quiet, never counted); Pier a change Dana L.
 * asked for that Ada K. then commented on (hers to read again); Moor a release that is offered to
 * the person looking and is somebody else's to make.
 */
import { EnvironmentId } from "@t3tools/contracts";
import { changeStandingOf, type FlowPullRequest } from "@t3tools/client-runtime/zerops";
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

import { Row as KitRow } from "~/components/ui/row";
import { MateFace } from "~/components/zerops/primitives";
import {
  changeReviewItem,
  crewTaskReviewItem,
  HeaderReviewDoor,
  ProjectReviewTags,
  type ProjectReviewItem,
} from "~/components/zerops/SidebarProjectReview";
import { applyThemePalette, ZEROPS_THEME_ID } from "~/themePalette";
import { ReviewContext, reviewTargetKey, type OpenReview } from "~/zerops/review";
import "../index.css";

const params = new URLSearchParams(location.search);
const appearance = params.get("theme") === "dark" ? "dark" : "light";
const OPEN = params.get("open");
/** Orbit's changes come and go on their own every `live` ms, so an open popover can be watched. */
const LIVE = Number(params.get("live") ?? 0);

const pull = (repository: string, number: number, title: string): FlowPullRequest =>
  ({
    repository,
    number,
    title,
    kind: "code",
    mateProjectId: `mate-${repository}`,
    url: undefined,
    mergeability: "clean",
    behind: false,
    merged: false,
    mergedAt: undefined,
  }) as unknown as FlowPullRequest;

const NOVA = { name: "Nova", tint: "violet", shape: "clover" } as const;
const PIP = { name: "Pip", tint: "sky", shape: "gem", ownerName: "Tomas" } as const;
const ORBIT_PULLS = [
  pull("appdev", 12, "Add a due date to each todo and sort the list by it"),
  pull("apidev", 3, "Rate-limit the public API"),
  pull("appdev", 14, "Archive finished todos after a week"),
  pull("appdev", 15, "Translate the settings page"),
];
const orbitItem = (index: number): ProjectReviewItem => {
  const source = ORBIT_PULLS[index % ORBIT_PULLS.length]!;
  return changeReviewItem({
    pull: { ...source, number: source.number + Math.floor(index / ORBIT_PULLS.length) * 100 },
    among: ORBIT_PULLS,
    groupId: "orbit",
    by: index % 2 === 1 ? PIP : NOVA,
    mine: index % 2 === 0,
  });
};
const CREW_TASK = crewTaskReviewItem({
  environmentId: EnvironmentId.make("environment-orbit"),
  taskId: "task-7",
  title: "Write the scoring rules",
  by: { name: "Sid", tint: "amber", shape: "seal", crewOf: "Nova" },
  mine: true,
});

/** Who merges in the limited applications, and what the member list calls everybody. */
const NAMES = { ada: "Ada K.", sam: "Sam R.", dana: "Dana L." };
const LIMITED = { people: ["ada", "sam"] };
/** Dana L. looks: she works in Tea, Kettle and Saucer and cannot merge there. */
const asDana = changeStandingOf(
  {
    apps: {
      tea: { merges: "held", ...LIMITED },
      kettle: { merges: "held", ...LIMITED },
      saucer: { merges: "held", ...LIMITED },
      pier: { merges: "held", ...LIMITED },
    },
    names: NAMES,
    // The harness' changes are of her own Mates: a comment on one is for her.
    own: { "mate-appdev": true },
  },
  { userId: "dana" },
);
/** Ada K. looks: she merges in Harbor. */
const asAda = changeStandingOf(
  { apps: { harbor: { merges: "yes", ...LIMITED } }, names: NAMES },
  { userId: "ada" },
);
const WREN = { name: "Wren", tint: "olive", shape: "gem" } as const;
const ASKED = { by: "dana", at: "2026-11-16T09:00:00Z" };

/** A limited application's change as the person looking reads it. */
const limitedItem = (
  standingOf: typeof asDana,
  groupId: string,
  by: typeof NOVA | typeof WREN,
  number: number,
  title: string,
  asked: boolean,
  /** Somebody commented on it since she last opened its review. */
  commentedBy?: string,
): ProjectReviewItem => {
  const change = {
    ...pull("appdev", number, title),
    ...(asked ? { mergeAsk: ASKED } : {}),
    ...(commentedBy === undefined
      ? {}
      : { lastComment: { at: "2026-11-16T10:00:00Z", by: commentedBy } }),
  };
  return changeReviewItem({
    pull: change,
    among: [],
    groupId,
    by,
    mine: true,
    standing: standingOf(groupId, change),
  });
};

/** A colleague's change, in a project that limits nothing: theirs to merge. */
const colleagueItem = (number: number, title: string): ProjectReviewItem =>
  changeReviewItem({
    pull: pull("appdev", number, title),
    among: [],
    groupId: "grove",
    by: { ...WREN, ownerName: "Sam R." },
    mine: false,
  });

const LIMITED_PROJECTS: ReadonlyArray<Project> = [
  {
    id: "tea",
    name: "Tea",
    mate: "Nova",
    tint: "violet",
    items: [
      limitedItem(asDana, "tea", NOVA, 21, "Add a gift note to the checkout", true),
      limitedItem(asDana, "tea", NOVA, 22, "Show delivery days on the cart", false),
      limitedItem(asDana, "tea", WREN, 23, "Tidy the tea list on small screens", false),
    ],
    release: undefined,
  },
  {
    id: "saucer",
    name: "Saucer",
    mate: "Wren",
    tint: "olive",
    items: [limitedItem(asDana, "saucer", WREN, 4, "Round the product pictures", false)],
    release: undefined,
  },
  {
    id: "kettle",
    name: "Kettle",
    mate: "Wren",
    tint: "olive",
    items: [
      limitedItem(asDana, "kettle", WREN, 7, "New colours for the landing page", true),
      limitedItem(asDana, "kettle", WREN, 9, "Bigger buttons in the footer", true),
    ],
    release: undefined,
  },
  {
    id: "harbor",
    name: "Harbor",
    mate: "Nova",
    tint: "violet",
    items: [
      limitedItem(asAda, "harbor", NOVA, 31, "Sort the ports by country", false),
      limitedItem(asAda, "harbor", WREN, 32, "Redraw the harbor map legend", true),
    ],
    release: undefined,
  },
  {
    id: "grove",
    name: "Grove",
    mate: "Wren",
    tint: "olive",
    items: [
      colleagueItem(51, "Plant list with photos"),
      colleagueItem(52, "Opening hours in the footer"),
    ],
    release: undefined,
  },
  {
    id: "pier",
    name: "Pier",
    mate: "Nova",
    tint: "violet",
    items: [limitedItem(asDana, "pier", NOVA, 41, "Ferry times on the home page", true, "ada")],
    release: undefined,
  },
  {
    id: "moor",
    name: "Moor",
    mate: "Wren",
    tint: "olive",
    items: [],
    release: { waiting: 2, atLeast: false, quiet: true },
  },
];

interface Project {
  readonly id: string;
  readonly name: string;
  readonly mate: string;
  readonly tint: "violet" | "coral" | "olive";
  readonly items: ReadonlyArray<ProjectReviewItem>;
  readonly release:
    | { readonly waiting: number; readonly atLeast: boolean; readonly quiet?: true }
    | undefined;
}

function Row({ project }: { readonly project: Project }) {
  return (
    <KitRow
      badges={
        <ProjectReviewTags
          groupId={project.id}
          items={project.items}
          projectName={project.name}
          release={project.release}
        />
      }
      lead={<MateFace shape="clover" size={32} state="idle" tint={project.tint} />}
      line="Merged the due dates; the list sorts by them now."
      meta="3m"
      size="lg"
      title={
        <>
          {project.name}{" "}
          <span className="font-normal text-sidebar-muted-foreground">· {project.mate}</span>
        </>
      }
    />
  );
}

function Harness() {
  const [orbit, setOrbit] = useState(3);
  const [crew, setCrew] = useState(true);
  const [release, setRelease] = useState(true);
  const [opened, setOpened] = useState("nothing yet");
  const openReview: OpenReview = (target) => setOpened(reviewTargetKey(target));
  const orbitItems = Array.from({ length: orbit }, (_, index) => orbitItem(index));
  const projects: ReadonlyArray<Project> = [
    {
      id: "orbit",
      name: "Orbit",
      mate: "Nova",
      tint: "violet",
      items: crew ? [...orbitItems, CREW_TASK] : orbitItems,
      release: release ? { waiting: 3, atLeast: false } : undefined,
    },
    {
      id: "lumen",
      name: "Lumen storefront",
      mate: "Rook",
      tint: "coral",
      items: [
        changeReviewItem({
          pull: pull("shopdev", 8, "Show stock on the product page"),
          among: [],
          groupId: "lumen",
          by: { name: "Rook", tint: "coral", shape: "clover" },
          mine: true,
        }),
      ],
      release: undefined,
    },
    {
      id: "quay",
      name: "Quay",
      mate: "Wren",
      tint: "olive",
      items: [],
      release: { waiting: 12, atLeast: true },
    },
    ...LIMITED_PROJECTS,
  ];
  useEffect(() => {
    if (LIVE <= 0) return;
    let step = 0;
    const timer = setInterval(() => {
      step += 1;
      setOrbit([3, 2, 3, 4][step % 4]!);
    }, LIVE);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (OPEN === null) return;
    const tag = document.querySelector<HTMLButtonElement>(
      `[data-zerops-surface="sidebar-project-review"][aria-label$="in ${OPEN}"]`,
    );
    tag?.click();
  }, []);
  return (
    <ReviewContext value={openReview}>
      <div className="flex min-h-screen gap-8 bg-background p-8 text-foreground">
        <div
          style={{ width: 435 }}
          className="flex flex-col gap-0.5 rounded-2xl bg-sidebar p-2 text-sidebar-foreground"
          data-harness="menu"
        >
          {projects.map((project) => (
            <Row key={project.id} project={project} />
          ))}
          {/* The same tags as a conversation's header draws them, a project a line. */}
          <div
            className="mt-6 flex flex-col items-start gap-2 px-2 pb-2"
            data-harness="header-doors"
          >
            {LIMITED_PROJECTS.map((project) => (
              <div className="flex h-9 items-center gap-1" key={project.id}>
                <span className="w-16 text-xs text-sidebar-muted-foreground">{project.name}</span>
                <HeaderReviewDoor
                  held={false}
                  review={{
                    groupId: project.id,
                    items: project.items,
                    projectName: project.name,
                    release: project.release,
                  }}
                />
              </div>
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-2 text-sm">
          <p>Opened: {opened}</p>
          <div className="flex flex-wrap gap-2">
            <button
              className="rounded border px-2 py-1"
              onClick={() => setOrbit((n) => n + 1)}
              type="button"
            >
              + change
            </button>
            <button
              className="rounded border px-2 py-1"
              onClick={() => setOrbit((n) => Math.max(0, n - 1))}
              type="button"
            >
              − change
            </button>
            <button
              className="rounded border px-2 py-1"
              onClick={() => setCrew((on) => !on)}
              type="button"
            >
              crew task
            </button>
            <button
              className="rounded border px-2 py-1"
              onClick={() => setRelease((on) => !on)}
              type="button"
            >
              release
            </button>
          </div>
        </div>
      </div>
    </ReviewContext>
  );
}

document.documentElement.classList.toggle("dark", appearance === "dark");
applyThemePalette(ZEROPS_THEME_ID, appearance);

const host = document.getElementById("design");
if (host) {
  createRoot(host).render(
    <StrictMode>
      <Harness />
    </StrictMode>,
  );
}
