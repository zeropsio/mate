/**
 * Settings → Team, as legacy Zerops draws it: everyone in the organization — never an integration
 * token — as a card, by name, invitations last: their face, name, role and e-mail, a developer's or
 * guest's projects under it, an invitation not joined yet saying it waits for them to join — by
 * the name its inviter typed where Zerops knows only the address. A card opens that person's own
 * page. The heading carries the count, a search by name or e-mail and, for an organization owner or
 * admin, *Invite* — and on each invitation they may change, *Send again*.
 */
import { Link, useRouter } from "@tanstack/react-router";
import { PlusIcon, SearchIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Button, InlineButton } from "../ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "../ui/input-group";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { PersonAvatar } from "../zerops/primitives";
import { SettingsPageContainer, SettingsSection } from "./settingsLayout";
import { forgetInvitationSent, invitationSentTo } from "./invitationSent";
import type { ResentInvitation } from "@t3tools/client-runtime/data";
import {
  arrivingRow,
  reachWords,
  resendCards,
  sentInvitation,
  shownTeam,
  teamSearchShown,
  type TeamPerson,
  type TeamResend,
  type TeamResendCard,
  type TeamView,
} from "./teamSettings.logic";
import { Loading } from "../ui/loading";
import { useTeam } from "./useTeam";

/** The name an invitation was typed with, as Zerops takes it: first word, then the rest. */
const typedNames = (person: TeamPerson) => {
  if (person.name === person.email) return undefined;
  const [firstName = "", ...rest] = person.name.trim().split(/\s+/u);
  return { firstName, lastName: rest.join(" ") };
};

/** Settings → Team. */
export function TeamSettings() {
  const { view, resend } = useTeam();
  // Each Send again by the address it went to, while the page is open.
  const [resends, setResends] = useState<Readonly<Record<string, TeamResend>>>({});
  const sendAgain = (person: TeamPerson, invitation?: ResentInvitation) => {
    const address = person.email?.toLocaleLowerCase();
    if (address === undefined) return;
    const names = typedNames(person);
    setResends((held) => ({ ...held, [address]: { person, state: "sending" } }));
    void resend({
      clientUserId: person.key,
      ...(names === undefined ? {} : { names }),
      ...(invitation === undefined ? {} : { invitation }),
    }).then((answer) =>
      setResends((held) => ({
        ...held,
        [address]: answer.sent
          ? { person, state: "sent" }
          : {
              person,
              state: "failed",
              trouble: answer.trouble,
              ...(answer.invitation === undefined ? {} : { invitation: answer.invitation }),
            },
      })),
    );
  };
  // Taken once on arrival: the visit keeps it, nothing after it sees it again.
  const [sent] = useState(invitationSentTo);
  useEffect(forgetInvitationSent, []);
  // Invite is this page's way on: its code is fetched ahead, so the form paints at once.
  const router = useRouter();
  useEffect(() => {
    void router.preloadRoute({ to: "/settings/team/invite" }).catch(() => undefined);
  }, [router]);
  return (
    <SettingsPageContainer width="wide">
      <TeamList onSendAgain={sendAgain} resends={resends} sent={sent} view={view} />
    </SettingsPageContainer>
  );
}

const NOTHING_SENT: ReadonlyArray<string> = [];
const NO_RESENDS: Readonly<Record<string, TeamResend>> = {};

/** The team as drawn from what is known of it. */
export function TeamList({
  view,
  initialQuery = "",
  sent = NOTHING_SENT,
  resends = NO_RESENDS,
  onSendAgain,
}: {
  readonly view: TeamView;
  /** What the search starts with; a harness shows a search under way. */
  readonly initialQuery?: string;
  /** The addresses invitations were just sent to, on the way back from Invite. */
  readonly sent?: ReadonlyArray<string>;
  /** Each Send again, by the address it went to. */
  readonly resends?: Readonly<Record<string, TeamResend>>;
  /** Sends an invitation again; with what a failed one handed back, only invites. Absent: none. */
  readonly onSendAgain?: (person: TeamPerson, invitation?: ResentInvitation) => void;
}) {
  const [query, setQuery] = useState(initialQuery);
  const cards = useMemo(
    () =>
      new Map(
        resendCards(view.kind === "people" ? view.people : [], resends).map((card) => [
          card.person.key,
          card,
        ]),
      ),
    [resends, view],
  );
  const shown = useMemo(
    () =>
      shownTeam(
        [...cards.values()].map(({ person }) => person),
        query,
      ).flatMap((person) => {
        const card = cards.get(person.key);
        return card === undefined ? [] : [card];
      }),
    [cards, query],
  );
  const confirmed =
    sent.length === 0 ? null : sentInvitation(view.kind === "people" ? view.people : [], sent);
  const invite = useRef<HTMLElement | null>(null);
  // The new rows grow in on their first insertion only (`arrivingRow`).
  const [arrivalPlayed, setArrivalPlayed] = useState(false);
  const arriving = arrivingRow({
    arrivedKeys: confirmed?.arrivedKeys ?? [],
    played: arrivalPlayed,
  });
  // Focus goes back to Invite once, as soon as it is drawn: the team may still be reading.
  const inviteShown = view.kind === "people" && view.invite.length > 0;
  const focused = useRef(false);
  useEffect(() => {
    if (sent.length === 0 || !inviteShown || focused.current || invite.current === null) return;
    focused.current = true;
    invite.current.focus();
  }, [sent.length, inviteShown]);
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
        {view.kind === "reading" ? (
          <Loading count={4} label="Who is on the team" shape="rows" />
        ) : view.kind === "unreadable" ? (
          <p className="tm-empty">{view.line}</p>
        ) : shown.length === 0 ? (
          <p className="tm-empty">Nobody matches “{query.trim()}”.</p>
        ) : (
          <>
            <ul aria-label="People" className="tm-cards">
              {shown.map((card) => (
                <li
                  className="grid"
                  data-arrived={arriving.includes(card.person.key) || undefined}
                  key={card.person.key}
                  onAnimationEnd={
                    arriving.includes(card.person.key)
                      ? () => {
                          setArrivalPlayed(true);
                        }
                      : undefined
                  }
                >
                  <PersonCard
                    card={card}
                    {...(onSendAgain === undefined ? {} : { onSendAgain })}
                    resend={resends[card.person.email?.toLocaleLowerCase() ?? ""]}
                  />
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

/**
 * One person: their face, name, role, e-mail — and what a developer or guest reaches. The card
 * opens their page; an invitation's *Send again* sits under it, outside that link.
 */
function PersonCard({
  card,
  resend,
  onSendAgain,
}: {
  readonly card: TeamResendCard;
  readonly resend: TeamResend | undefined;
  readonly onSendAgain?: (person: TeamPerson, invitation?: ResentInvitation) => void;
}) {
  const { person } = card;
  const reach =
    person.reach === null || person.reach.kind === "everything" ? null : reachWords(person.reach);
  const offer = onSendAgain === undefined ? null : card.offer;
  const content = (
    <>
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
      {card.invited === null ? null : (
        <span className="tm-card-mail" data-part="pending">
          {card.invited}
        </span>
      )}
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
    </>
  );
  const foot =
    offer === null && card.trouble === null && !card.busy ? null : (
      <span className="tm-card-foot">
        {card.trouble === null ? null : (
          <span className="tm-card-trouble" role="alert">
            {card.trouble}
          </span>
        )}
        {offer === null && !card.busy ? null : (
          <InlineButton
            aria-busy={card.busy || undefined}
            disabled={card.busy}
            onClick={() =>
              onSendAgain?.(person, offer === "invite-again" ? resend?.invitation : undefined)
            }
          >
            {card.busy
              ? "Sending again…"
              : offer === "invite-again"
                ? "Invite again"
                : "Send again"}
          </InlineButton>
        )}
      </span>
    );
  return (
    <div className="tm-card" data-pending={person.pending || undefined}>
      {card.listed ? (
        <Link
          className="tm-card-body"
          params={{ clientUserId: person.key }}
          to="/settings/team/$clientUserId"
        >
          {content}
        </Link>
      ) : (
        <div className="tm-card-body">{content}</div>
      )}
      {foot}
    </div>
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
