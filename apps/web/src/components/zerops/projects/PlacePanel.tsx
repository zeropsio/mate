/**
 * A place on its project's card — production, or a stage — said in full where the card stands, not
 * behind a click (the owner, 2026-10-11: "why not like have actual state of prod, why not have like
 * link"): what runs there and since when, each service up or down, what went wrong and who would
 * fix it, what the running release brought, its addresses — and its actions (Ask <Mate> to fix it,
 * Open logs, Roll back, History), which are the page's.
 *
 * Its addresses are the place's as the addresses sheet and the globe's popover read them
 * (`panelAddresses`): its own domain heads it once it answers, one not answering yet says how far
 * it is, and its own doors open the sheet on it — Manage addresses, and production's Add your
 * domain while it has none.
 */
import {
  addresses as placeAddresses,
  PROJECT_ROUTINGS_LISTING,
  type PlaceAddresses,
} from "@t3tools/client-runtime/data";
import { Atom } from "effect/reactivity";
import { ArrowUpRightIcon } from "lucide-react";
import type { ReactNode } from "react";

import { useAddressesSheet } from "~/zerops/addressesSheet";
import { useAccountOrgId, useDetailDemand, useProjection } from "~/zerops/ZeropsAccountData";

import { PlaceDot, PlaceWords } from "./ProjectCards";
import { panelAddresses, placeLabel, type PlaceLine } from "./projectCard.logic";

/** Outside an account, or before its place is named: read as its listing says it. */
const NOT_READ = Atom.make<PlaceAddresses>({
  state: "reading",
  domains: [],
  zerops: [],
  ips: { zoneHasSharedV4: false },
  portsState: "reading",
  ports: [],
  webTargets: [],
  portTargets: [],
  waitingDomains: [],
  waitingPorts: [],
  readsProject: false,
});

/** A place's addresses as read, held while its panel is drawn. */
function usePlaceAddresses(orgId: string | null, projectId: string | undefined): PlaceAddresses {
  const place = useProjection(
    placeAddresses,
    orgId === null || projectId === undefined ? null : { orgId, projectId },
    NOT_READ,
  );
  useDetailDemand(
    "publicRouting",
    PROJECT_ROUTINGS_LISTING,
    place.readsProject && projectId !== undefined ? projectId : null,
  );
  return place;
}

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
  /** Its services, each up, stopped or down. */
  readonly services: ReadonlyArray<PlacePanelService>;
}

export function PlacePanel({
  model,
  groupId,
  actions,
  roomy = false,
}: {
  readonly model: PlacePanelModel;
  /** Its application, whose places the addresses sheet's switch offers. */
  readonly groupId: string;
  /** The page's buttons for it (`ov-btn`). */
  readonly actions: ReactNode;
  /**
   * Drawn at a project page's width: both doors into the sheet. On a card one door is enough —
   * *Add your domain* while production has none of its own (the sheet it opens manages the rest),
   * *Manage addresses* otherwise — and the actions keep to one row.
   */
  readonly roomy?: boolean;
}) {
  const { line } = model;
  const label = placeLabel(line);
  const orgId = useAccountOrgId();
  const { projectId } = line;
  const said = panelAddresses({
    kind: line.kind,
    listed: line.addresses,
    place: usePlaceAddresses(orgId, projectId),
  });
  const { head, doors } = said;
  // The sheet on this place, as the globe's popover opens it; none outside an account.
  const manage =
    orgId === null || projectId === undefined
      ? undefined
      : (intent?: "add-domain") => {
          useAddressesSheet
            .getState()
            .open({ orgId, projectId, groupId, ...(intent === undefined ? {} : { intent }) });
        };
  return (
    <div aria-label={label} className="ov-panel" data-zerops-surface="place-panel">
      <div className="ov-panel-head">
        <b className="ov-panel-name">{label}</b>
        {head === undefined ? null : (
          <a
            aria-label={`Open ${label}`}
            className="ov-panel-host"
            href={head.url}
            rel="noreferrer"
            target="_blank"
          >
            <span className="truncate">{head.host}</span>
            <ArrowUpRightIcon aria-hidden="true" className="size-3.5 shrink-0" />
          </a>
        )}
        {/* Several services serving: a door each, by its service. */}
        {doors.length === 0 ? null : (
          <span className="ov-panel-doors">
            {doors.map((address) => (
              <a
                aria-label={`Open ${address.service} on ${label}`}
                className="ov-panel-host"
                href={address.url}
                key={address.service}
                rel="noreferrer"
                target="_blank"
              >
                <span className="truncate">{address.service}</span>
                <ArrowUpRightIcon aria-hidden="true" className="size-3.5 shrink-0" />
              </a>
            ))}
          </span>
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
      {said.pending.map((domain) => (
        <p className="ov-panel-note" data-tone={domain.tone} key={domain.name}>
          {`${domain.name} · ${domain.word}`}
        </p>
      ))}
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
      <div className="ov-panel-acts">
        {actions}
        {manage === undefined || !said.offerDomain ? null : (
          <button
            className="ov-btn"
            onClick={() => {
              manage("add-domain");
            }}
            type="button"
          >
            Add your domain
          </button>
        )}
        {manage === undefined || (said.offerDomain && !roomy) ? null : (
          <button
            className="ov-btn"
            onClick={() => {
              manage();
            }}
            type="button"
          >
            Manage addresses
          </button>
        )}
      </div>
    </div>
  );
}
