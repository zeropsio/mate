/**
 * The chosen state patterns, each in every state it has, at the top of its census: what the app
 * draws from now on, above what is left of the home-made looks it replaces.
 */
import { BoxIcon, InboxIcon } from "lucide-react";
import { useState, type ReactNode } from "react";

import { Button } from "~/components/ui/button";
import { EmptyState } from "~/components/ui/empty";
import { Failure } from "~/components/ui/failure";
import { Loading, type LoadingShape } from "~/components/ui/loading";
import { Progress, type ProgressView } from "~/components/ui/progress";
import { StatusPage } from "~/components/ui/status-page";

import { Specimen, SpecimenBlock, SpecimenGrid } from "../Specimen";
import { StateFrame, useKitNowMs } from "./Census";

const MIN = 60_000;
const STEPS = [
  "Creating its project",
  "Starting its services",
  "Deploying it",
  "Giving it an address",
];

/** A block headed "Chosen": the pattern the app draws, before the census of what it replaced. */
export function Chosen({ children }: { readonly children: ReactNode }) {
  return (
    <SpecimenBlock title="Chosen">
      <SpecimenGrid>{children}</SpecimenGrid>
    </SpecimenBlock>
  );
}

const SHAPES: ReadonlyArray<{ readonly shape: LoadingShape; readonly count: number }> = [
  { shape: "rows", count: 3 },
  { shape: "lines", count: 3 },
  { shape: "cards", count: 2 },
  { shape: "page", count: 3 },
  { shape: "line", count: 1 },
  { shape: "room", count: 1 },
];

export function ChosenLoading() {
  return (
    <Chosen>
      {SHAPES.map(({ shape, count }) => (
        <Specimen
          key={shape}
          label={`<Loading label="…" shape="${shape}"${shape === "room" ? "" : ` count={${count}}`} />`}
          source="apps/web/src/components/ui/loading.tsx"
        >
          <div className="w-[440px] rounded-xl border p-4">
            <Loading count={count} label="Your projects" shape={shape} />
          </div>
        </Specimen>
      ))}
    </Chosen>
  );
}

export function ChosenEmpty() {
  return (
    <Chosen>
      <Specimen label='<EmptyState size="row">' source="apps/web/src/components/ui/empty.tsx">
        <div className="w-[440px] rounded-xl border">
          <EmptyState mark={<InboxIcon />} size="row">
            No open ports on this service.
          </EmptyState>
        </div>
      </Specimen>
      <Specimen label='<EmptyState size="row" action={…}>'>
        <div className="w-[440px] rounded-xl border">
          <EmptyState
            action={
              <Button size="sm" variant="outline">
                Set up an environment
              </Button>
            }
            size="row"
          >
            No repository is declared for this project's services yet.
          </EmptyState>
        </div>
      </Specimen>
      <Specimen label='<EmptyState size="section" mark={…} action={…}>'>
        <div className="flex w-[440px] rounded-xl border">
          <EmptyState
            action={
              <Button size="sm" variant="link">
                Show all projects
              </Button>
            }
            mark={<BoxIcon className="size-8 text-muted-foreground" />}
          >
            No Mate of yours yet. The projects where you have a Mate show up here.
          </EmptyState>
        </div>
      </Specimen>
      <Specimen label='<EmptyState size="page">'>
        <StateFrame size="page">
          <EmptyState mark={<BoxIcon className="size-10 text-muted-foreground" />} size="page">
            Nothing waits on you. A question from one of your Mates shows up here.
          </EmptyState>
        </StateFrame>
      </Specimen>
    </Chosen>
  );
}

/** A specimen that runs: its steps go by every few seconds, then it ends and starts again. */
function LiveProgress({ ending }: { readonly ending: "done" | "failed" }) {
  const nowMs = useKitNowMs();
  const [mountedAt] = useState(nowMs);
  // Each run: its steps three seconds apart, then its end held for four.
  const period = STEPS.length * 3000 + 4000;
  const startedAtMs = mountedAt + Math.floor((nowMs - mountedAt) / period) * period;
  const elapsed = nowMs - startedAtMs;
  const at = Math.min(STEPS.length - 1, Math.floor(elapsed / 3000));
  const over = elapsed >= STEPS.length * 3000;
  const view: ProgressView | undefined = !over
    ? undefined
    : ending === "done"
      ? { state: "done", result: "Recipe Box is set up", action: <Button size="sm">Open</Button> }
      : {
          state: "failed",
          cause: "Giving it an address didn't finish. Zerops answered that the domain is taken.",
          action: <Button size="sm">Try again</Button>,
          details: "domainAlreadyInUse",
        };
  return (
    <Progress
      at={at}
      endedAtMs={over ? startedAtMs + STEPS.length * 3000 : null}
      estimateMs={15_000}
      identity={String(startedAtMs)}
      label="Setting up Recipe Box"
      nowMs={nowMs}
      startedAtMs={startedAtMs}
      steps={STEPS}
      view={view}
    />
  );
}

function FixedProgress({
  at,
  seconds,
  estimateMs,
  view,
}: {
  readonly at: number;
  readonly seconds: number;
  readonly estimateMs: number | null;
  readonly view?: ProgressView;
}) {
  const nowMs = useKitNowMs();
  const [mountedAt] = useState(nowMs);
  const startedAtMs = mountedAt - seconds * 1000;
  return (
    <Progress
      at={at}
      endedAtMs={view === undefined ? null : mountedAt}
      estimateMs={estimateMs}
      label="Setting up Recipe Box"
      nowMs={view === undefined ? nowMs : mountedAt}
      startedAtMs={startedAtMs}
      steps={STEPS}
      view={view}
    />
  );
}

export function ChosenProgress() {
  return (
    <Chosen>
      <Specimen
        label="<Progress /> · live: steps go by, then it is done"
        source="apps/web/src/components/ui/progress.tsx"
      >
        <div className="w-[480px]">
          <LiveProgress ending="done" />
        </div>
      </Specimen>
      <Specimen label="<Progress /> · live: steps go by, then it stops">
        <div className="w-[480px]">
          <LiveProgress ending="failed" />
        </div>
      </Specimen>
      <Specimen label="<Progress /> · inside its estimate">
        <div className="w-[480px]">
          <FixedProgress at={1} estimateMs={5 * MIN} seconds={80} />
        </div>
      </Specimen>
      <Specimen label="<Progress /> · past its estimate">
        <div className="w-[480px]">
          <FixedProgress at={2} estimateMs={2 * MIN} seconds={4 * 60 + 44} />
        </div>
      </Specimen>
      <Specimen label="<Progress /> · no measured estimate">
        <div className="w-[480px]">
          <FixedProgress at={0} estimateMs={null} seconds={5} />
        </div>
      </Specimen>
      <Specimen label='<Progress view={{ state: "done" }} />'>
        <div className="w-[480px]">
          <FixedProgress
            at={3}
            estimateMs={5 * MIN}
            seconds={262}
            view={{ state: "done", result: "Mate is ready for Acme" }}
          />
        </div>
      </Specimen>
      <Specimen label='<Progress view={{ state: "failed" }} />'>
        <div className="w-[480px]">
          <FixedProgress
            at={2}
            estimateMs={5 * MIN}
            seconds={151}
            view={{
              state: "failed",
              cause: "Deploying it stopped. Its build log in Zerops says why.",
              action: <Button size="sm">Try again</Button>,
              details: "Process 4f2a… ended FAILED: build step exited 1",
            }}
          />
        </div>
      </Specimen>
      <Specimen
        label="<StatusPage> + <Progress /> · a whole page waiting"
        source="apps/web/src/components/ui/status-page.tsx"
      >
        <StateFrame size="page">
          <StatusPage title="Setting up Mate for Acme">
            <p className="m-0">It takes about 5 minutes. Keep this tab open while it runs.</p>
            <div className="mt-3 w-full text-left">
              <FixedProgress at={2} estimateMs={5 * MIN} seconds={130} />
            </div>
          </StatusPage>
        </StateFrame>
      </Specimen>
    </Chosen>
  );
}

/** A page failure whose Details open in place: the title above them never moves. */
export function ChosenFailure() {
  return (
    <Chosen>
      <Specimen
        label="<Failure cause action details />"
        source="apps/web/src/components/ui/failure.tsx"
      >
        <div className="w-[480px]">
          <Failure
            action={
              <Button size="sm" variant="outline">
                Read again
              </Button>
            }
            cause="Couldn't read the project's people."
            details="HQ answered 502 Bad Gateway."
          />
        </div>
      </Specimen>
      <Specimen label="<Failure cause /> · nothing here can fix it">
        <div className="w-[480px]">
          <Failure cause="Zerops didn't let you read their project access." />
        </div>
      </Specimen>
      <Specimen label='<Failure size="page" …> · open Details: nothing above moves'>
        <StateFrame size="page">
          <Failure
            action={
              <>
                <Button>Add credit</Button>
                <Button variant="ghost">Remove</Button>
              </>
            }
            cause="Recipe Box needs credit first."
            details="projectLimitReached: the organization has used its one free project."
            mark={<BoxIcon className="size-12 text-muted-foreground" />}
            size="page"
          >
            Zerops gives each organization one project for free. Add credit and it picks up from
            here. Nothing was charged.
          </Failure>
        </StateFrame>
      </Specimen>
    </Chosen>
  );
}
