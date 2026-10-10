/**
 * A place's panel, opened from its line at a card's foot: what runs there and since when, what
 * that version brought, what went wrong and who would fix it, the stages behind production, its
 * address and what it runs on — and its actions (Ask <Mate> to fix it, Open logs, Roll back,
 * History), which are the page's.
 */
import { ArrowUpRightIcon, GlobeIcon } from "lucide-react";
import type { ReactNode } from "react";

import { PlaceDot } from "./ProjectCards";
import type { PlaceLine } from "./projectCard.logic";

export interface PlacePanelStage {
  readonly projectId: string;
  readonly name: string;
  readonly dot: PlaceLine["dot"];
  readonly version: string | undefined;
  /** Changes on it production lacks. */
  readonly ahead: number | undefined;
  /** Its state in a word, or what it says of itself. */
  readonly note: string | undefined;
}

export interface PlacePanelModel {
  readonly line: PlaceLine;
  readonly version: string | undefined;
  /** "released Tue", under its name. */
  readonly sub: string | undefined;
  /** What went wrong, in sentences. */
  readonly note: { readonly text: string; readonly tone: "attention" | "failed" } | undefined;
  /** What its version brought: the changes it carried. */
  readonly brought: ReadonlyArray<{
    readonly key: string;
    readonly title: string;
    readonly by?: string | undefined;
  }>;
  readonly stages: ReadonlyArray<PlacePanelStage>;
  /** Its public address. */
  readonly route: string | undefined;
  /** What it runs on: "Node.js 22 · PostgreSQL 16". */
  readonly runs: string | undefined;
}

export function PlacePanel({
  model,
  actions,
}: {
  readonly model: PlacePanelModel;
  /** The page's buttons for it (`ov-btn`). */
  readonly actions: ReactNode;
}) {
  const { line } = model;
  const host = model.route?.replace(/^[a-z]+:\/\//iu, "").replace(/\/+$/u, "");
  return (
    <div aria-label={`${line.name}`} className="ov-panel" data-zerops-surface="place-panel">
      <div className="ov-panel-head">
        <PlaceDot dot={line.dot} />
        <b>{line.name}</b>
        {model.version === undefined ? null : <span className="tabular-nums">{model.version}</span>}
      </div>
      {model.sub === undefined ? null : <p className="ov-panel-sub">{model.sub}</p>}
      {model.note === undefined ? null : (
        <div className="ov-panel-sec">
          <p className="ov-panel-note" data-tone={model.note.tone}>
            {model.note.text}
          </p>
        </div>
      )}
      {model.brought.length === 0 || model.version === undefined ? null : (
        <div className="ov-panel-sec">
          <div className="ov-panel-k">What {model.version} brought</div>
          {model.brought.map((change) => (
            <div className="ov-panel-li" key={change.key}>
              <span />
              <span className="ov-panel-lt">{change.title}</span>
              <span className="ov-panel-w">{change.by}</span>
            </div>
          ))}
        </div>
      )}
      {model.stages.length === 0 ? null : (
        <div className="ov-panel-sec">
          <div className="ov-panel-k">Stages</div>
          {model.stages.map((stage) => (
            <div className="ov-panel-li" key={stage.projectId}>
              <PlaceDot dot={stage.dot} />
              <span className="ov-panel-lt">
                <b className="font-semibold">{stage.name}</b>{" "}
                <span className="tabular-nums">{stage.version}</span>
                {stage.ahead === undefined || stage.ahead === 0
                  ? null
                  : ` · ${String(stage.ahead)} ahead`}
              </span>
              <span className="ov-panel-w">{stage.note}</span>
            </div>
          ))}
        </div>
      )}
      {host === undefined && model.runs === undefined ? null : (
        <div className="ov-panel-sec grid gap-1">
          {host === undefined || model.route === undefined ? null : (
            <a className="ov-panel-host" href={model.route} rel="noreferrer" target="_blank">
              <GlobeIcon aria-hidden="true" className="size-3.5 text-muted-foreground" />
              <span>{host}</span>
              <ArrowUpRightIcon aria-hidden="true" className="size-3.5" />
            </a>
          )}
          {model.runs === undefined ? null : <p className="ov-panel-runs">{model.runs}</p>}
        </div>
      )}
      <div className="ov-panel-acts">{actions}</div>
    </div>
  );
}
