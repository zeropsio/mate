/**
 * Settings → Team, as legacy Zerops draws it: everyone in the organization — never an integration
 * token — as a card, by name, invitations last: their face, name, role and e-mail, a developer's or
 * guest's projects under it, an invitation not joined yet saying it waits for them to join — by
 * the name its inviter typed where Zerops knows only the address. A card opens that person's own
 * page. The heading carries the count, a search by name or e-mail and, for an organization owner or
 * admin, *Invite*.
 */
import { Link } from "@tanstack/react-router";
import { PlusIcon, SearchIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "../ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "../ui/input-group";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { PersonAvatar } from "../zerops/primitives";
import { SettingsPageContainer, SettingsSection } from "./settingsLayout";
import { forgetInvitationSent, invitationSentTo } from "./invitationSent";
import {
  arrivingRow,
  INVITED_LINE,
  reachWords,
  sentInvitation,
  shownTeam,
  teamSearchShown,
  type TeamPerson,
  type TeamView,
} from "./teamSettings.logic";
import { Loading } from "../ui/loading";
import { useTeam } from "./useTeam";

/** Settings → Team. */
export function TeamSettings() {
  const { view } = useTeam();
  // Taken once on arrival: the visit keeps it, nothing after it sees it again.
  const [sent] = useState(invitationSentTo);
  useEffect(forgetInvitationSent, []);
  return (
    <SettingsPageContainer width="wide">
      <TeamList sent={sent} view={view} />
    </SettingsPageContainer>
  );
}

/** The team as drawn from what is known of it. */
export function TeamList({
  view,
  initialQuery = "",
  sent = null,
}: {
  readonly view: TeamView;
  /** What the search starts with; a harness shows a search under way. */
  readonly initialQuery?: string;
  /** The address an invitation was just sent to, on the way back from Invite. */
  readonly sent?: string | null;
}) {
  const [query, setQuery] = useState(initialQuery);
  const shown = useMemo(
    () => (view.kind === "people" ? shownTeam(view.people, query) : []),
    [query, view],
  );
  const confirmed =
    sent === null ? null : sentInvitation(view.kind === "people" ? view.people : [], sent);
  const invite = useRef<HTMLElement | null>(null);
  // The new row grows in on its first insertion only (`arrivingRow`).
  const [arrivalPlayed, setArrivalPlayed] = useState(false);
  const arriving = arrivingRow({
    arrivedKey: confirmed?.arrivedKey ?? null,
    played: arrivalPlayed,
  });
  // Focus goes back to Invite once, as soon as it is drawn: the team may still be reading.
  const inviteShown = view.kind === "people" && view.invite.length > 0;
  const focused = useRef(false);
  useEffect(() => {
    if (sent === null || !inviteShown || focused.current || invite.current === null) return;
    focused.current = true;
    invite.current.focus();
  }, [sent, inviteShown]);
  // The live region stands empty from the page's first paint and is filled a tick later, once
  // focus has moved, so a screen reader hears the change rather than a region born full.
  const status = useRef<HTMLParagraphElement>(null);
  const announce = confirmed?.announce ?? null;
  useEffect(() => {
    if (announce === null) return;
    const tick = window.setTimeout(() => {
      if (status.current !== null) status.current.textContent = announce;
    }, 0);
    return () => window.clearTimeout(tick);
  }, [announce]);
  return (
    <SettingsSection
      count={view.kind === "people" ? view.count : undefined}
      headerAction={
        view.kind === "people" ? (
          <>
            {teamSearchShown(view.people.length, query) ? (
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
            ) : null}
            {view.invite.length > 0 ? (
              <Button
                data-zerops-surface="invite-team"
                ref={(node: HTMLElement | null) => {
                  invite.current = node;
                }}
                render={<Link to="/settings/team/invite" />}
                size="sm"
              >
                <PlusIcon aria-hidden="true" />
                Invite
              </Button>
            ) : null}
          </>
        ) : null
      }
      id="team"
      title="Team"
    >
      <div className="tm-team px-3 sm:px-4">
        <p className="sr-only" ref={status} role="status" />
        {confirmed === null ? null : (
          <p className="tm-sent" data-part="sent">
            {confirmed.line}
          </p>
        )}
        {view.kind === "reading" ? (
          <Loading count={4} label="Who is on the team" shape="rows" />
        ) : view.kind === "unreadable" ? (
          <p className="tm-empty">{view.line}</p>
        ) : shown.length === 0 ? (
          <p className="tm-empty">Nobody matches “{query.trim()}”.</p>
        ) : (
          <>
            <ul aria-label="People" className="tm-cards">
              {shown.map((person) => (
                <li
                  className="grid"
                  data-arrived={person.key === arriving || undefined}
                  key={person.key}
                  onAnimationEnd={
                    person.key === arriving
                      ? () => {
                          setArrivalPlayed(true);
                        }
                      : undefined
                  }
                >
                  <PersonCard person={person} />
                </li>
              ))}
            </ul>
            {view.kind === "people" && view.people.length === 1 && view.invite.length > 0 ? (
              <p className="tm-empty" data-part="alone">
                Only you so far. People you invite sign in with their own Zerops account.
              </p>
            ) : null}
          </>
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
        <PersonAvatar name={person.name} picture={person.avatarUrl} size={64} />
      </span>
      <span className="tm-card-name" data-part="name">
        {person.name === person.email ? <Address address={person.name} /> : person.name}
      </span>
      <span className="tm-card-badges">
        {person.badgeHint === null ? (
          <span className="tm-badge" data-part="role">
            {person.badge}
          </span>
        ) : (
          <Tooltip>
            <TooltipTrigger
              render={
                <span className="tm-badge" data-part="role">
                  {person.badge}
                </span>
              }
            />
            <TooltipPopup>{person.badgeHint}</TooltipPopup>
          </Tooltip>
        )}
        {person.you ? (
          <span className="tm-badge" data-part="you" data-tone="muted">
            You
          </span>
        ) : null}
      </span>
      {person.pending ? (
        <span className="tm-card-mail" data-part="pending">
          {INVITED_LINE}
        </span>
      ) : null}
      {person.email === null || person.email === person.name ? null : (
        <span className="tm-card-mail" data-part="email">
          <Address address={person.email} />
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

/**
 * An e-mail address cut in its middle where it does not fit — "nova.store…@example.com" — so the
 * domain, which tells a colleague from an outsider, always shows; the whole address on hover.
 */
function Address({ address }: { readonly address: string }) {
  const at = address.lastIndexOf("@");
  if (at <= 0) return address;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span className="tm-address">
            <span className="tm-address-local">{address.slice(0, at)}</span>
            <span className="tm-address-domain">{address.slice(at)}</span>
          </span>
        }
      />
      <TooltipPopup>{address}</TooltipPopup>
    </Tooltip>
  );
}
