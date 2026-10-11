/**
 * A place on its project's card — production, or a stage — said in full where the card stands, not
 * behind a click (the owner, 2026-10-11: "why not like have actual state of prod, why not have like
 * link"): what runs there and since when, each service up or down, what went wrong and who would
 * fix it, what the running release brought, its address — and its actions (Ask <Mate> to fix it,
 * Open logs, Roll back, History), which are the page's.
 */
import { ArrowUpRightIcon } from "lucide-react";
import type { ReactNode } from "react";

import { PlaceDot, PlaceWords } from "./ProjectCards";
import { placeLabel, type PlaceLine } from "./projectCard.logic";

/** One service of a place, as the platform reads it. */
export interface PlacePanelService {
  readonly hostname: string;
  /** Running; stopped; or failed, as the place's serving says it. */
  readonly state: "up" | "stopped" | "down";
}

export interface PlacePanelModel {
  readonly line: PlaceLine;
  readonly version: string | undefined;
  /** What went wrong, in sentences. */
  readonly note: { readonly text: string; readonly tone: "attention" | "failed" } | undefined;
  /** What its version brought: the changes it carried. */
  readonly brought: ReadonlyArray<{
    readonly key: string;
    readonly title: string;
    readonly by?: string | undefined;
  }>;
  /** Its public address. */
  readonly route: string | undefined;
  /** Its services, each up, stopped or down. */
  readonly services: ReadonlyArray<PlacePanelService>;
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
  const label = placeLabel(line);
  const host = model.route?.replace(/^[a-z]+:\/\//iu, "").replace(/\/+$/u, "");
  return (
    <div aria-label={label} className="ov-panel" data-zerops-surface="place-panel">
      <div className="ov-panel-head">
        <b className="ov-panel-name">{label}</b>
        {host === undefined || host.length === 0 || model.route === undefined ? null : (
          <a
            aria-label={`Open ${label}`}
            className="ov-panel-host"
            href={model.route}
            rel="noreferrer"
            target="_blank"
          >
            <span className="truncate">{host}</span>
            <ArrowUpRightIcon aria-hidden="true" className="size-3.5 shrink-0" />
          </a>
        )}
      </div>
      <p className="ov-panel-state">
        <PlaceDot dot={line.dot} />
        <PlaceWords line={line} />
      </p>
      {model.services.length === 0 ? null : (
        <p className="ov-panel-services">
          {model.services.map((service) => (
            <span className="ov-service" data-state={service.state} key={service.hostname}>
              <i aria-hidden="true" className="ov-service-dot" />
              {service.hostname}
              {service.state === "up" ? null : (
                <span className="sr-only">{service.state === "down" ? " failed" : " stopped"}</span>
              )}
            </span>
          ))}
        </p>
      )}
      {model.note === undefined ? null : (
        <p className="ov-panel-note" data-tone={model.note.tone}>
          {model.note.text}
        </p>
      )}
      {model.brought.length === 0 || model.version === undefined ? null : (
        <div className="ov-panel-sec">
          <div className="ov-panel-k">What {model.version} brought</div>
          {model.brought.map((change) => (
            <div className="ov-panel-li" key={change.key}>
              <span className="ov-panel-lt">{change.title}</span>
              <span className="ov-panel-w">{change.by}</span>
            </div>
          ))}
        </div>
      )}
      <div className="ov-panel-acts">{actions}</div>
    </div>
  );
}
