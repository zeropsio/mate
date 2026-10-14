/**
 * Settings → Team, as legacy Zerops draws it: everyone in the organization — never an integration
 * token — as a card, by name, invitations last: their face, name, role and e-mail, a developer's or
 * guest's projects under it, an invitation not joined yet saying so. A card opens that person's own
 * page. The heading carries the count, a search by name or e-mail and, for an organization owner or
 * admin, *Invite*.
 */
import { Link } from "@tanstack/react-router";
import { PlusIcon, SearchIcon } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "../ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "../ui/input-group";
import { Avatar } from "../zerops/primitives";
import { SettingsPageContainer, SettingsSection } from "./settingsLayout";
import { reachWords, shownTeam, type TeamPerson, type TeamView } from "./teamSettings.logic";
import { useTeam } from "./useTeam";

/** Settings → Team. */
export function TeamSettings() {
  const { view } = useTeam();
  return (
    <SettingsPageContainer width="wide">
      <TeamList view={view} />
    </SettingsPageContainer>
  );
}

/** The team as drawn from what is known of it. */
export function TeamList({
  view,
  initialQuery = "",
}: {
  readonly view: TeamView;
  /** What the search starts with; a harness shows a search under way. */
  readonly initialQuery?: string;
}) {
  const [query, setQuery] = useState(initialQuery);
  const shown = useMemo(
    () => (view.kind === "people" ? shownTeam(view.people, query) : []),
    [query, view],
  );
  return (
    <SettingsSection
      headerAction={
        view.kind === "people" ? (
          <div className="tm-team-bar">
            <span className="tm-team-count">{view.count}</span>
            <div className="tm-team-search">
              <InputGroup>
                <InputGroupAddon>
                  <SearchIcon aria-hidden="true" />
                </InputGroupAddon>
                <InputGroupInput
                  aria-label="Search the team"
                  onChange={(event) => setQuery(event.currentTarget.value)}
                  placeholder="Search by name or e-mail"
                  size="sm"
                  type="search"
                  value={query}
                />
              </InputGroup>
            </div>
            {view.invite.length > 0 ? (
              <Button
                data-zerops-surface="invite-team"
                render={<Link to="/settings/team/invite" />}
                size="sm"
              >
                <PlusIcon aria-hidden="true" />
                Invite
              </Button>
            ) : null}
          </div>
        ) : null
      }
      id="team"
      title="Team"
    >
      <div className="tm-team px-3 sm:px-4">
        {view.kind === "reading" ? (
          <p className="tm-empty">Reading who is on the team…</p>
        ) : view.kind === "unreadable" ? (
          <p className="tm-empty">{view.line}</p>
        ) : shown.length === 0 ? (
          <p className="tm-empty">Nobody matches “{query.trim()}”.</p>
        ) : (
          <ul aria-label="People" className="tm-cards">
            {shown.map((person) => (
              <li className="grid" key={person.key}>
                <PersonCard person={person} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </SettingsSection>
  );
}

/** One person: their face, name, role, e-mail — and what a developer or guest reaches. */
function PersonCard({ person }: { readonly person: TeamPerson }) {
  const reach =
    person.reach === null || person.reach.kind === "everything" ? null : reachWords(person.reach);
  return (
    <Link
      className="tm-card"
      data-pending={person.pending || undefined}
      params={{ clientUserId: person.key }}
      to="/settings/team/$clientUserId"
    >
      <span className="tm-card-face">
        <Avatar initials={person.initials} size="xl" src={person.avatarUrl} />
      </span>
      <span className="tm-card-name" data-part="name">
        {person.name}
      </span>
      <span className="tm-card-badges">
        <span className="tm-badge" data-part="role">
          {person.badge}
        </span>
        {person.pending ? (
          <span className="tm-badge" data-part="pending" data-tone="muted">
            Invited
          </span>
        ) : null}
        {person.you ? (
          <span className="tm-badge" data-part="you" data-tone="muted">
            You
          </span>
        ) : null}
      </span>
      {person.email === null || person.email === person.name ? null : (
        <span className="tm-card-mail" data-part="email">
          {person.email}
        </span>
      )}
      {reach === null ? null : (
        <span className="tm-card-mail" data-part="reach">
          {reach.charAt(0).toUpperCase() + reach.slice(1)}
        </span>
      )}
    </Link>
  );
}
