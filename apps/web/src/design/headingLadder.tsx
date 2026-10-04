/**
 * `design.html?set=ladder`: every state of a project heading's second line (D′) on one column,
 * each open and folded, as the prod/stage board draws its ladder — the same `ProjectHeader`,
 * pills and line the menu draws, fed made-up inputs. A landing replays every 6 s: the state
 * before it, then the one it lands in, so "is live" shows, stands 4 s and folds.
 */
import type { ComingStep, StopComing, ZeropsGroup } from "@t3tools/client-runtime/zerops";
import { useEffect, useState } from "react";

import { SidebarProductionChip } from "~/components/zerops/SidebarProductionChip";
import type { HeadingLineInput } from "~/components/zerops/SidebarHeadingLine.logic";
import type { ProductionChip } from "~/components/zerops/SidebarProductionChip.logic";
import { ProjectHeader } from "~/components/zerops/SidebarZeropsTree";

const group = (name: string): ZeropsGroup =>
  ({
    groupId: `g-${name}`,
    name,
    nameSource: "hq",
    environments: [],
    pending: [],
    production: undefined,
  }) as unknown as ZeropsGroup;

const prodChip = (
  state: ProductionChip["state"],
  facts: Partial<ProductionChip> = {},
): ProductionChip => ({ label: "prod", state, ...facts });
const stageChip = (state: ProductionChip["state"]): ProductionChip => ({
  label: "stage",
  state,
  version: "main",
});

const production = (
  chip: ProductionChip,
  over: Partial<NonNullable<HeadingLineInput["production"]>> = {},
): HeadingLineInput["production"] => ({
  projectId: "prod",
  chip,
  coming: undefined,
  failure: undefined,
  ...over,
});
const coming = (step: ComingStep): StopComing => ({
  kind: "coming",
  step,
});
const input = (over: Partial<HeadingLineInput>): HeadingLineInput => ({
  production: undefined,
  stages: [],
  waiting: 0,
  waitingAtLeast: false,
  allOnStage: false,
  ...over,
});

interface Rung {
  readonly label: string;
  readonly name: string;
  readonly chips: ReadonlyArray<ProductionChip>;
  readonly line: HeadingLineInput;
  /** Where it lands from: replayed, so the landing shows. */
  readonly before?: HeadingLineInput;
}

const HEALTHY = prodChip("ok", { version: "v2.3.0" });
const RELEASING = prodChip("releasing", { version: "v2.3.0", next: "v2.4.0" });
const LIVE = prodChip("ok", { version: "v2.4.0" });

const RUNGS: ReadonlyArray<Rung> = [
  {
    label: "1 Healthy, nothing waits",
    name: "Beviro",
    chips: [HEALTHY],
    line: input({ production: production(HEALTHY) }),
  },
  {
    label: "2 3 changes merged, not released",
    name: "Beviro",
    chips: [HEALTHY],
    line: input({ production: production(HEALTHY), waiting: 3 }),
  },
  {
    label: "2′ with a stage that runs them",
    name: "Beviro",
    chips: [stageChip("ok"), HEALTHY],
    line: input({
      production: production(HEALTHY),
      stages: [{ projectId: "stage", name: "stage", coming: undefined, serves: true }],
      waiting: 3,
      allOnStage: true,
    }),
  },
  {
    label: "3 Releasing v2.4.0",
    name: "Beviro",
    chips: [RELEASING],
    line: input({ production: production(RELEASING) }),
  },
  {
    label: "4 v2.4.0 just went live (replays)",
    name: "Beviro",
    chips: [LIVE],
    line: input({ production: production(LIVE) }),
    before: input({ production: production(RELEASING) }),
  },
  {
    label: "5 v2.4.0 didn’t go out",
    name: "Beviro",
    chips: [prodChip("failed", { version: "v2.3.0" })],
    line: input({
      production: production(prodChip("failed", { version: "v2.3.0" }), {
        failure: {
          tag: "v2.4.0",
          kind: "deploy-failed",
          at: undefined,
          error: undefined,
          service: "app",
        },
      }),
    }),
  },
  {
    label: "6 Down",
    name: "Beviro",
    chips: [prodChip("down")],
    line: input({ production: production(prodChip("down")) }),
  },
  {
    label: "7 Stopped",
    name: "Beviro",
    chips: [prodChip("stopped")],
    line: input({ production: production(prodChip("stopped")) }),
  },
  {
    label: "8 Production coming up",
    name: "Beviro",
    chips: [prodChip("creating")],
    line: input({ production: production(prodChip("creating"), { coming: coming("build") }) }),
  },
  {
    label: "8′ its first build live (replays)",
    name: "Beviro",
    chips: [prodChip("ok", { version: "v0.1.0" })],
    line: input({ production: production(prodChip("ok", { version: "v0.1.0" })) }),
    before: input({ production: production(prodChip("creating"), { coming: coming("address") }) }),
  },
  {
    label: "9 Nothing released yet, 3 changes merged",
    name: "Beviro",
    chips: [prodChip("empty")],
    line: input({ production: production(prodChip("empty")), waiting: 3 }),
  },
  {
    label: "14 A stage coming up",
    name: "ZIT",
    chips: [stageChip("creating")],
    line: input({
      stages: [{ projectId: "stage", name: "stage", coming: coming("build"), serves: false }],
    }),
  },
  {
    label: "14″ A stage's first deploy HQ has under way",
    name: "Brine",
    chips: [stageChip("creating")],
    line: input({
      stages: [
        {
          projectId: "stage",
          name: "stage",
          coming: coming("deploy-on-its-way"),
          serves: false,
        },
      ],
    }),
  },
  {
    label: "14′ the stage up (replays)",
    name: "ZIT",
    chips: [stageChip("ok")],
    line: input({
      stages: [{ projectId: "stage", name: "stage", coming: undefined, serves: true }],
    }),
    before: input({
      stages: [{ projectId: "stage", name: "stage", coming: coming("address"), serves: false }],
    }),
  },
  {
    label: "15 Didn’t come up",
    name: "ZIT",
    chips: [stageChip("failed")],
    line: input({
      stages: [
        {
          projectId: "stage",
          name: "stage",
          coming: { kind: "failed", reason: "the app’s build failed" },
          serves: false,
        },
      ],
    }),
  },
  {
    label: "Long name, a long reason",
    name: "Imperial Titan storefront and partner portal",
    chips: [stageChip("ok"), prodChip("failed", { version: "v12.9.0" })],
    line: input({
      production: production(prodChip("failed", { version: "v12.9.0" }), {
        failure: {
          tag: "v12.10.0",
          kind: "refused",
          at: undefined,
          error: undefined,
          service: undefined,
        },
      }),
    }),
  },
];

/** A rung's line, replaying its landing every 6 s where it has one. */
function useReplayed(rung: Rung): HeadingLineInput {
  const [shown, setShown] = useState(rung.before ?? rung.line);
  useEffect(() => {
    if (rung.before === undefined) return;
    const { before, line } = rung;
    let landed = false;
    const flip = () => {
      landed = !landed;
      setShown(landed ? line : before);
    };
    const first = setTimeout(flip, 800);
    const timer = setInterval(flip, 6_000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [rung]);
  return shown;
}

function RungHeading({ rung, collapsed }: { readonly rung: Rung; readonly collapsed: boolean }) {
  const line = useReplayed(rung);
  const g = group(rung.name);
  return (
    <ProjectHeader
      chips={rung.chips.map((chip) => (
        <SidebarProductionChip
          chip={chip}
          groupId={g.groupId}
          key={chip.label}
          mates={[]}
          menu={() => ({ stops: [] })}
          onAskToFix={undefined}
          onOpenStop={() => undefined}
          projectName={rung.name}
          stops={[]}
        />
      ))}
      collapsed={collapsed}
      group={g}
      line={line}
      onBrowseProjects={() => {}}
      onToggle={() => {}}
    />
  );
}

export function HeadingLadder({ width }: { readonly width: number }) {
  return (
    <div className="flex min-h-screen gap-10 bg-sidebar p-6 text-sidebar-foreground">
      {[false, true].map((collapsed) => (
        <div className="flex flex-col gap-3" key={String(collapsed)} style={{ width }}>
          <p className="ps-4 text-muted-foreground text-xs">{collapsed ? "folded" : "open"}</p>
          {RUNGS.map((rung) => (
            <div className="flex flex-col" key={rung.label}>
              <p className="ps-4 text-muted-foreground text-xs">{rung.label}</p>
              <RungHeading collapsed={collapsed} rung={rung} />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
