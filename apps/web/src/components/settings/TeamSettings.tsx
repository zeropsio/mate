/**
 * Settings → Team, as legacy Zerops draws it: everyone in the organization — never an integration
 * token — as a card, by name, invitations last: their face, name, role and e-mail, a developer's or
 * guest's projects under it, an invitation not joined yet saying it waits for them to join — by
 * the name its inviter typed where Zerops knows only the address. A card opens that person's own
 * page. The heading carries the count, a search by name or e-mail and, for an organization owner or
 * admin, *Invite* — and on each invitation they may change, *Send again*, which has the viewer
 * confirm it's them in Zerops where their session needs it, as an invitation does. A person with an
 * access change the viewer started at HQ shows it on their card (`AccessOperationRow`); one whose
 * person the team does not list stands above the cards.
 */
import { Link, useRouter } from "@tanstack/react-router";
import { PlusIcon, SearchIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Badge } from "../ui/badge";
import { EmptyState } from "../ui/empty";
import { Button, InlineButton } from "../ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "../ui/input-group";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { PersonAvatar } from "../zerops/primitives";
import { FaceCard, FaceCardLine, FaceCards } from "../zerops/system/FaceCard";
import { SettingsPageContainer, SettingsSection } from "./settingsLayout";
import { forgetInvitationSent, invitationSentTo } from "./invitationSent";
import type { AccessOperationRow as AccessOperation } from "@t3tools/client-runtime/data";
import { AccessOperationRow } from "./AccessOperationRow";
import {
  arrivingRow,
  reachWords,
  sentInvitationKeys,
  shownTeam,
  teamCards,
  teamSearchShown,
  type TeamCard,
  type TeamPerson,
  type TeamSendAgain,
  type TeamView,
} from "./teamSettings.logic";
import { Loading } from "../ui/loading";
import { INVITE_UNCONFIRMED } from "./teamMember.logic";
import { useTeam } from "./useTeam";
import { Failure } from "../ui/failure";
import { cn } from "~/lib/utils";

/** The name an invitation was typed with, as Zerops takes it: first word, then the rest. */
const typedNames = (person: TeamPerson) => {
  if (person.name === person.email) return undefined;
  const [firstName = "", ...rest] = person.name.trim().split(/\s+/u);
  return { firstName, lastName: rest.join(" ") };
};

/** Settings → Team. */
export function TeamSettings() {
  const {
    view,
    startAccessChange,
    sudoAhead,
    operations,
    continueAccessChange,
    deleteAccessChange,
  } = useTeam();
  // Each Send again while HQ answers its start, and HQ's refusal of it, by membership id.
  const [presses, setPresses] = useState<Readonly<Record<string, TeamSendAgain>>>({});
  const sendAgain = (person: TeamPerson) => {
    if (person.userId === undefined) return;
    const names = typedNames(person);
    const held = (press: TeamSendAgain | null) =>
      setPresses(({ [person.key]: _left, ...rest }) =>
        press === null ? rest : { ...rest, [person.key]: press },
      );
    const userId = person.userId;
    held({ state: "sending" });
    // Zerops' confirmation first, from the press, as an invitation needs it.
    sudoAhead()
      .then((answer) => {
        if (answer === "cancelled") throw new Error(INVITE_UNCONFIRMED);
        return startAccessChange({
          kind: "resend",
          userId,
          ...(names === undefined ? {} : { names }),
        });
      })
      .then(
        () => held(null),
        (cause: unknown) =>
          held({
            state: "refused",
            trouble: cause instanceof Error ? cause.message : "HQ didn't take it.",
          }),
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
      <TeamList
        onContinue={continueAccessChange}
        onDelete={deleteAccessChange}
        onSendAgain={sendAgain}
        operations={operations}
        presses={presses}
        sent={sent}
        view={view}
      />
    </SettingsPageContainer>
  );
}

const NOTHING_SENT: ReadonlyArray<string> = [];
const NO_PRESSES: Readonly<Record<string, TeamSendAgain>> = {};
const NO_OPERATIONS: ReadonlyArray<AccessOperation> = [];

/** Continue and Delete on an access change's row. */
interface OperationPresses {
  readonly onContinue: (id: string) => Promise<void>;
  readonly onDelete: (id: string) => Promise<void>;
}

/** The team as drawn from what is known of it. */
export function TeamList({
  view,
  initialQuery = "",
  sent = NOTHING_SENT,
  presses = NO_PRESSES,
  operations = NO_OPERATIONS,
  onSendAgain,
  onContinue,
  onDelete,
}: {
  readonly view: TeamView;
  /** What the search starts with; a harness shows a search under way. */
  readonly initialQuery?: string;
  /** The addresses invitations were just sent to, on the way back from Invite. */
  readonly sent?: ReadonlyArray<string>;
  /** Each Send again while HQ answers it, by membership id. */
  readonly presses?: Readonly<Record<string, TeamSendAgain>>;
  /** The viewer's access changes, as HQ shows them. */
  readonly operations?: ReadonlyArray<AccessOperation>;
  /** Sends an invitation again. Absent: none. */
  readonly onSendAgain?: (person: TeamPerson) => void;
  /** Absent: an access change's row offers nothing. */
  readonly onContinue?: OperationPresses["onContinue"];
  readonly onDelete?: OperationPresses["onDelete"];
}) {
  const [query, setQuery] = useState(initialQuery);
  const placed = useMemo(
    () => teamCards(view.kind === "people" ? view.people : [], presses, operations),
    [operations, presses, view],
  );
  const cards = useMemo(
    () => new Map(placed.cards.map((card) => [card.person.key, card])),
    [placed],
  );
  const rowPresses: OperationPresses | undefined =
    onContinue === undefined || onDelete === undefined ? undefined : { onContinue, onDelete };
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
  const arrivedKeys =
    sent.length === 0 ? [] : sentInvitationKeys(view.kind === "people" ? view.people : [], sent);
  const invite = useRef<HTMLElement | null>(null);
  // The new rows grow in on their first insertion only (`arrivingRow`).
  const [arrivalPlayed, setArrivalPlayed] = useState(false);
  const arriving = arrivingRow({
    arrivedKeys,
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
  return (
    <SettingsSection
      count={view.kind === "people" ? view.count : undefined}
      headerAction={
        view.kind === "people" ? (
          <>
            {teamSearchShown(view.people.length, query) ? (
              <div className="w-60 max-sm:w-auto max-sm:min-w-0 max-sm:flex-1">
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
      headerActionWraps
      id="team"
      title="Team"
    >
      <div className="grid gap-5 px-3 sm:px-4">
        {view.kind === "reading" ? (
          <Loading count={4} label="Who is on the team" shape="rows" />
        ) : view.kind === "unreadable" ? (
          <Failure cause={view.line} />
        ) : shown.length === 0 ? (
          <EmptyState mark={<SearchIcon aria-hidden="true" />}>
            Nobody matches “{query.trim()}”.
          </EmptyState>
        ) : (
          <>
            {placed.unplaced.length === 0 ? null : (
              <ul aria-label="Access changes" className="grid gap-2 pb-3">
                {placed.unplaced.map((operation) => (
                  <li key={operation.id}>
                    <AccessOperationRow operation={operation} {...rowPresses} />
                  </li>
                ))}
              </ul>
            )}
            <FaceCards label="People" phone="rows">
              {shown.map((card) => (
                <li
                  className={cn(
                    "grid",
                    // An invitation just sent grows in once, top first; the only row that animates.
                    arriving.includes(card.person.key) &&
                      "motion-safe:animate-card-arrive motion-safe:overflow-clip motion-safe:[overflow-clip-margin:4px] motion-safe:*:min-h-0",
                  )}
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
                    {...(rowPresses === undefined ? {} : { rowPresses })}
                  />
                </li>
              ))}
            </FaceCards>
            {view.kind === "people" && view.people.length === 1 && view.invite.length > 0 ? (
              <EmptyState size="row">
                Only you so far. People you invite sign in with their own Zerops account.
              </EmptyState>
            ) : null}
          </>
        )}
      </div>
    </SettingsSection>
  );
}

/**
 * One person: their face, name, role, e-mail — and what a developer or guest reaches, on the
 * face card a project's Mates share (`FaceCard`). The card opens their page; an invitation's *Send
 * again* sits under it, outside that link.
 */
function PersonCard({
  card,
  onSendAgain,
  rowPresses,
}: {
  readonly card: TeamCard;
  readonly onSendAgain?: (person: TeamPerson) => void;
  readonly rowPresses?: OperationPresses;
}) {
  const { person } = card;
  const reach =
    person.reach === null || person.reach.kind === "everything" ? null : reachWords(person.reach);
  const offer = onSendAgain === undefined ? null : card.offer;
  const foot =
    card.operations.length > 0 ? (
      <span className="flex flex-col gap-1">
        {card.operations.map((operation) => (
          <AccessOperationRow
            address={person.email}
            key={operation.id}
            operation={operation}
            {...rowPresses}
          />
        ))}
      </span>
    ) : offer === null && card.trouble === null && !card.busy ? null : (
      <>
        {card.trouble === null ? null : <Failure cause={card.trouble} role="alert" size="line" />}
        {offer === null && !card.busy ? null : (
          <InlineButton
            aria-busy={card.busy || undefined}
            disabled={card.busy || person.userId === undefined}
            onClick={() => onSendAgain?.(person)}
          >
            {card.busy ? "Sending again…" : "Send again"}
          </InlineButton>
        )}
      </>
    );
  return (
    <FaceCard
      chips={
        <>
          <Badge data-part="role" tone="info">
            {person.role}
          </Badge>
          {person.you ? <Badge data-part="you">You</Badge> : null}
        </>
      }
      faded={person.pending}
      figure={<PersonAvatar name={person.name} picture={person.avatarUrl} size={64} />}
      foot={foot}
      press={<Link params={{ clientUserId: person.key }} to="/settings/team/$clientUserId" />}
      title={person.name === person.email ? <Address address={person.name} /> : person.name}
    >
      {card.invited === null ? null : (
        <FaceCardLine data-part="pending">{card.invited}</FaceCardLine>
      )}
      {person.email === null || person.email === person.name ? null : (
        <FaceCardLine data-part="email">
          <Address address={person.email} />
        </FaceCardLine>
      )}
      {reach === null ? null : (
        <FaceCardLine data-part="reach">
          {reach.charAt(0).toUpperCase() + reach.slice(1)}
        </FaceCardLine>
      )}
    </FaceCard>
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
          <span className="inline-flex max-w-full min-w-0 align-top">
            <span className="min-w-0 flex-[0_1000_auto] truncate">{address.slice(0, at)}</span>
            {/* A domain too long for the card gives way last. */}
            <span className="min-w-0 flex-[0_1_auto] truncate">{address.slice(at)}</span>
          </span>
        }
      />
      <TooltipPopup>{address}</TooltipPopup>
    </Tooltip>
  );
}
