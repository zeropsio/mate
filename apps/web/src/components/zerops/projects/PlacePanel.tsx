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
import { useProjectRoleOffers } from "~/zerops/usePlatformCapabilities";
import { useAccountOrgId, useDetailDemand, useProjection } from "~/zerops/ZeropsAccountData";

import { PlaceDot, PlaceWords, ServicesHeld } from "./ProjectCards";
import {
  panelAddresses,
  placeLabel,
  type PlaceLine,
  type PlacePanelService,
} from "./projectCard.logic";
import { Button } from "~/components/ui/button";

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
  nothingDeployed: false,
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

export type { PlacePanelService } from "./projectCard.logic";

/** What a service that is not up says to a screen reader beside its name. */
const SERVICE_STATE_WORDS: Record<Exclude<PlacePanelService["state"], "up">, string> = {
  idle: " nothing deployed",
  stopped: " stopped",
  down: " failed",
};

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

export function PlacePanel(props: PlacePanelProps) {
  // Nothing deployed there: its name and its line alone — no services shown as up, no address
  // doors, no actions on what it does not run.
  if (props.model.line.nothingDeployed === true) return <EmptyPlacePanel line={props.model.line} />;
  return <ServingPlacePanel {...props} />;
}

function EmptyPlacePanel({ line }: { readonly line: PlaceLine }) {
  const label = placeLabel(line);
  return (
    <div aria-label={label} className="ov-panel" data-zerops-surface="place-panel">
      <div className="ov-panel-head">
        <b className="ov-panel-name">{label}</b>
      </div>
      <p className="ov-panel-state">
        <PlaceDot dot={line.dot} />
        <PlaceWords line={line} />
      </p>
      {/* A stage keeps its services line's room, unread: set up, empty and running, its card's
          Mates never move (the run's new stage pushed them three times). */}
      {line.kind === "stage" ? <ServicesHeld /> : null}
    </div>
  );
}

interface PlacePanelProps {
  readonly model: PlacePanelModel;
  /** Its application, whose places the addresses sheet's switch offers. */
  readonly groupId: string;
  /** The page's buttons for it: sm secondary Buttons. */
  readonly actions: ReactNode;
  /**
   * What its line opens, where it says something under way that has a review — production's
   * "Releasing v0.1.0" opens that release's (`releaseLineOpens`). The line keeps its words and
   * its place: it only becomes a door.
   */
  readonly onOpenLine?: ((from: HTMLElement) => void) | undefined;
  /**
   * Drawn at a project page's width: both doors into the sheet. On a card one door is enough, and
   * only production's — *Put it on your domain* while it has none of its own (the sheet it opens
   * manages the rest), *Manage addresses* otherwise — once it runs something at an address
   * (`panelAddresses`); a stage's address heads its panel, and its page manages it. One name for
   * one door: the run's card said "Put it on your domain" for production and "Manage addresses"
   * for a stage with no address yet. Neither stands until something serves there.
   */
  readonly roomy?: boolean;
}

function ServingPlacePanel({
  model,
  groupId,
  actions,
  onOpenLine,
  roomy = false,
}: PlacePanelProps) {
  const { line } = model;
  const label = placeLabel(line);
  const orgId = useAccountOrgId();
  const { projectId } = line;
  const runs = model.version !== undefined || line.dot === "running";
  const said = panelAddresses({
    kind: line.kind,
    listed: line.addresses,
    place: usePlaceAddresses(orgId, projectId),
    runs,
  });
  const { head, doors } = said;
  const cardDoor = line.kind === "production" && said.door;
  // The sheet on this place, as the globe's popover opens it; none outside an account, and none
  // where the viewer's role there changes no address (`projectRoleOffers`).
  const { manageAddresses } = useProjectRoleOffers(projectId);
  const manage =
    orgId === null || projectId === undefined || !manageAddresses
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
      {onOpenLine === undefined ? (
        <p className="ov-panel-state">
          <PlaceDot dot={line.dot} />
          <PlaceWords line={line} />
        </p>
      ) : (
        <button
          aria-haspopup="dialog"
          className="ov-panel-state"
          data-zerops-place-door=""
          onClick={(event) => {
            onOpenLine(event.currentTarget);
          }}
          type="button"
        >
          <PlaceDot dot={line.dot} />
          <PlaceWords line={line} />
        </button>
      )}
      {model.services.length === 0 ? (
        // A stage always has services: their line is held while they are read, so it does not
        // grow the card when they come (the run's new stage pushed the card 24 px a minute in).
        line.kind === "stage" ? (
          <ServicesHeld />
        ) : null
      ) : (
        <p className="ov-panel-services">
          {model.services.map((service) => (
            <span className="ov-service" data-state={service.state} key={service.hostname}>
              <i aria-hidden="true" className="ov-service-dot" />
              {service.hostname}
              {service.state === "up" ? null : (
                <span className="sr-only">{SERVICE_STATE_WORDS[service.state]}</span>
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
          <Button
            onClick={() => {
              manage("add-domain");
            }}
            size="sm"
            variant="secondary"
          >
            Put it on your domain
          </Button>
        )}
        {manage === undefined || !runs || !(roomy || (cardDoor && !said.offerDomain)) ? null : (
          <Button
            onClick={() => {
              manage();
            }}
            size="sm"
            variant="secondary"
          >
            Manage addresses
          </Button>
        )}
      </div>
    </div>
  );
}
