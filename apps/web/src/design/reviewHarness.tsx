/**
 * A project row's Review and Release tags and their changes popover, at the menu's real width.
 *
 * Served by the dev server at `/design-review.html` (`?theme=dark`, `?open=Orbit` opens Orbit's
 * popover, `?live=1500` changes Orbit's list on its own). Rows stand on the menu's ground as the menu draws them; the buttons under them change
 * a project's items live, so the count's roll, a tag's arrival and an item leaving an open
 * popover can be watched. Fixtures only, with invented names: nothing here ships.
 */
import { EnvironmentId } from "@t3tools/contracts";
import type { FlowPullRequest } from "@t3tools/client-runtime/zerops";
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

import { MateFace } from "~/components/zerops/primitives";
import {
  changeReviewItem,
  crewTaskReviewItem,
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
const PIP = { name: "Pip", tint: "sky", shape: "gem", ownerFirstName: "Tomas" } as const;
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

interface Project {
  readonly id: string;
  readonly name: string;
  readonly mate: string;
  readonly tint: "violet" | "coral" | "olive";
  readonly items: ReadonlyArray<ProjectReviewItem>;
  readonly release: { readonly waiting: number; readonly atLeast: boolean } | undefined;
}

function Row({ project }: { readonly project: Project }) {
  return (
    <div className="menu-row group relative items-center rounded-xl hover:bg-sidebar-row-hover">
      <MateFace shape="clover" size={32} state="idle" tint={project.tint} />
      <span className="flex min-w-0 flex-col">
        <span className="flex h-5.5 min-w-0 items-center gap-2">
          <span className="menu-name min-w-0 flex-1 truncate font-medium">
            {project.name}{" "}
            <span className="font-normal text-sidebar-muted-foreground">· {project.mate}</span>
          </span>
          <ProjectReviewTags
            groupId={project.id}
            items={project.items}
            projectName={project.name}
            release={project.release}
          />
          <span className="menu-time w-16 shrink-0 text-end text-sidebar-muted-foreground tabular-nums">
            3m
          </span>
        </span>
        <span className="menu-line2 truncate text-sidebar-muted-foreground">
          Merged the due dates; the list sorts by them now.
        </span>
      </span>
    </div>
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
