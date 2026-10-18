/**
 * A project page's Access card: where the public reaches it — each address with the service and
 * port it lands on, production first — and, while production runs with no domain of its own, the
 * way to put it on one. Each place's addresses are the addresses sheet's (`usePlaceAddresses`),
 * and the sheet is where they are managed.
 */
import { ChevronRightIcon } from "lucide-react";

import { Button } from "~/components/ui/button";
import { useAddressesSheet } from "~/zerops/addressesSheet";
import { useProjectRoleOffers } from "~/zerops/usePlatformCapabilities";
import { useAccountOrgId } from "~/zerops/ZeropsAccountData";

import { usePlaceAddresses } from "./PlacePanel";
import { accessCard, type AccessCardModel, type AccessTier } from "./projectAccessCard.logic";
import { CardRowsHeld, ProjectPageCard } from "./ProjectPageCard";

const TIER_TAG: Readonly<Record<AccessTier, string>> = { production: "Prod", stage: "Stage" };

/** A place of the project the card reads: its tier, its Zerops project, whether it runs. */
export interface AccessPlace {
  readonly tier: AccessTier;
  readonly projectId: string;
  readonly runs: boolean;
}

/**
 * The card over the project's places, read here: production and up to two stages, each through
 * the addresses sheet's projection — a fixed number of reads, so a place arriving adds none.
 */
export function ProjectAccessCard({
  groupId,
  places,
}: {
  readonly groupId: string;
  readonly places: ReadonlyArray<AccessPlace>;
}) {
  const orgId = useAccountOrgId();
  const production = places.find((place) => place.tier === "production");
  const stages = places.filter((place) => place.tier === "stage");
  const [first, second] = stages;
  const read = [
    { place: production, addresses: usePlaceAddresses(orgId, production?.projectId) },
    { place: first, addresses: usePlaceAddresses(orgId, first?.projectId) },
    { place: second, addresses: usePlaceAddresses(orgId, second?.projectId) },
  ].flatMap(({ place, addresses }) =>
    place === undefined ? [] : [{ ...place, place: addresses }],
  );
  const model = accessCard(read);
  const managed = production ?? first;
  const { manageAddresses } = useProjectRoleOffers(managed?.projectId);
  const open =
    orgId === null || managed === undefined || !manageAddresses
      ? undefined
      : (intent?: "add-domain") => {
          useAddressesSheet.getState().open({
            orgId,
            projectId: managed.projectId,
            groupId,
            ...(intent === undefined ? {} : { intent }),
          });
        };
  if (places.length === 0) return null;
  return <ProjectAccessCardView model={model} onManage={open} />;
}

export function ProjectAccessCardView({
  model,
  onManage,
}: {
  readonly model: AccessCardModel;
  /** Opens the addresses sheet — on *Put it on your domain* for that; absent where the role may not. */
  readonly onManage?: ((intent?: "add-domain") => void) | undefined;
}) {
  return (
    <ProjectPageCard
      busy={model.state === "reading"}
      end={
        onManage === undefined || model.state !== "ready" ? undefined : (
          <Button
            onClick={() => {
              onManage();
            }}
            size="sm"
            variant="ghost"
          >
            Manage
          </Button>
        )
      }
      surface="project-access"
      title="Access"
    >
      {model.state === "reading" ? (
        <CardRowsHeld rows={2} />
      ) : model.rows.length === 0 ? (
        <p className="pp-cards-empty">
          {model.state === "failed"
            ? "Its addresses could not be read."
            : "Nothing is public yet: it gets an address once it runs."}
        </p>
      ) : (
        <ul className="grid">
          {model.rows.map((row) => (
            <li className="pp-cards-row" data-zerops-address={row.host} key={row.key}>
              <span
                aria-hidden="true"
                className={`size-1.5 shrink-0 rounded-full ${row.live ? "bg-status-ok" : "bg-status-off"}`}
              />
              {row.live ? (
                <a
                  className="min-w-0 flex-1 truncate text-line text-foreground underline decoration-border underline-offset-4 hover:decoration-current"
                  href={row.url}
                  rel="noreferrer"
                  target="_blank"
                >
                  {row.host}
                </a>
              ) : (
                <span className="min-w-0 flex-1 truncate text-line text-muted-foreground">
                  {row.host}
                  {row.word === undefined ? null : ` · ${row.word}`}
                </span>
              )}
              <span aria-hidden="true" className="shrink-0 text-caption text-muted-foreground">
                →
              </span>
              <span className="shrink-0 text-caption text-foreground tabular-nums">
                <span className="pp-cards-tag">{row.service}</span>
                <span className="text-muted-foreground">:{row.port}</span>
              </span>
              <span className="pp-cards-group-name w-11 shrink-0 text-end">
                {TIER_TAG[row.tier]}
              </span>
            </li>
          ))}
        </ul>
      )}
      {model.offerDomain && onManage !== undefined ? (
        <button
          className="pp-cards-dashed"
          data-zerops-surface="put-on-domain"
          onClick={() => {
            onManage("add-domain");
          }}
          type="button"
        >
          <span className="grid min-w-0 flex-1 text-start">
            <span className="text-line font-medium text-foreground">Put it on your domain</span>
            <span className="text-caption text-muted-foreground">
              The zerops.app address keeps working
            </span>
          </span>
          <ChevronRightIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
        </button>
      ) : null}
    </ProjectPageCard>
  );
}
