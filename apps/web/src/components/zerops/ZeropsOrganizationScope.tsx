import { Building2Icon, ChevronRightIcon } from "lucide-react";

import {
  zeropsOrganizationRoleLabel,
  type ZeropsOrganization,
} from "@t3tools/client-runtime/zerops";
import type { ZeropsOrganizationStatus } from "~/zerops/ZeropsSessionProvider";

import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Spinner } from "../ui/spinner";
import { FlatCard, MicroLabel } from "./primitives";

export function ZeropsOrganizationScope({
  activeOrganization,
  organizations,
  status,
  onSelect,
}: {
  readonly activeOrganization: ZeropsOrganization | null;
  readonly organizations: ReadonlyArray<ZeropsOrganization>;
  readonly status: ZeropsOrganizationStatus;
  readonly onSelect: (membershipId: string) => void;
}) {
  if (status === "loading") {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Spinner className="size-4" />
        Restoring your Zerops organization…
      </div>
    );
  }

  if (organizations.length === 0) {
    return (
      <FlatCard className="p-4">
        <p className="text-sm text-foreground">No active Zerops organizations.</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Ask an organization owner to invite this account, then refresh the page.
        </p>
      </FlatCard>
    );
  }

  if (!activeOrganization) {
    return (
      <section className="space-y-3" aria-labelledby="zerops-organization-heading">
        <div>
          <h2 id="zerops-organization-heading" className="text-sm font-semibold text-foreground">
            Choose an organization
          </h2>
          <p className="text-xs text-muted-foreground">
            Project access and permissions are evaluated inside one Zerops organization at a time.
          </p>
        </div>
        <ul className="grid max-w-3xl grid-cols-1 gap-3 sm:grid-cols-2">
          {organizations.map((organization) => (
            <li key={organization.membershipId}>
              <button
                className="group flex min-h-20 w-full cursor-pointer items-center gap-3 rounded-xl border border-border/55 bg-card/30 px-4 py-3 text-left outline-none transition-colors hover:border-border hover:bg-accent/45 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
                data-zerops-organization-card
                data-zerops-organization-choice
                type="button"
                onClick={() => {
                  onSelect(organization.membershipId);
                }}
              >
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted/70 text-muted-foreground transition-colors group-hover:text-foreground">
                  <Building2Icon className="size-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm leading-5 font-semibold text-foreground">
                    {organization.name}
                  </span>
                  <span className="mt-0.5 block text-xs leading-4 font-normal text-muted-foreground">
                    {zeropsOrganizationRoleLabel(organization)}
                  </span>
                </span>
                <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
              </button>
            </li>
          ))}
        </ul>
      </section>
    );
  }

  return (
    <div className="flex flex-wrap items-end justify-between gap-3 rounded-xl border border-border/55 bg-card/20 px-4 py-3">
      <div className="min-w-0">
        <MicroLabel className="text-muted-foreground">Organization</MicroLabel>
        <p className="mt-1 text-xs text-muted-foreground">
          Projects and permissions are scoped to the active membership.
        </p>
      </div>
      <Select
        value={activeOrganization.membershipId}
        onValueChange={(membershipId) => {
          if (membershipId) onSelect(membershipId);
        }}
      >
        <SelectTrigger
          aria-label="Active Zerops organization"
          className="w-full min-w-56 sm:w-auto"
          size="sm"
        >
          <Building2Icon className="size-4 text-muted-foreground" />
          <SelectValue>
            <span className="flex min-w-0 items-baseline gap-2">
              <span className="truncate">{activeOrganization.name}</span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {zeropsOrganizationRoleLabel(activeOrganization)}
              </span>
            </span>
          </SelectValue>
        </SelectTrigger>
        <SelectPopup align="end" alignItemWithTrigger={false}>
          {organizations.map((organization) => (
            <SelectItem key={organization.membershipId} value={organization.membershipId}>
              <span className="flex min-w-0 items-baseline justify-between gap-4">
                <span className="truncate">{organization.name}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {zeropsOrganizationRoleLabel(organization)}
                </span>
              </span>
            </SelectItem>
          ))}
        </SelectPopup>
      </Select>
    </div>
  );
}
