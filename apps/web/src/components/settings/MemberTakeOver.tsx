/**
 * Settings → Team → one person → *Before removing*: the Mate keys and deploy tokens the member
 * minted, which keep Zerops refusing their removal. Each is replaced with one the viewer mints and
 * then deleted; one HQ no longer uses is only deleted. A Mate whose owner is the member, or no
 * active member, needs the viewer to pick who gets it.
 */
import type { HqTakeOverItem } from "@t3tools/shared/hqTakeOver";
import type { MemberTakeOverRead } from "@t3tools/client-runtime/data";
import { useState } from "react";

import { Button } from "../ui/button";
import { Failure } from "../ui/failure";
import { Loading } from "../ui/loading";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";

export interface TakeOverPerson {
  readonly userId: string;
  readonly name: string;
}

/** Whom a Mate's key goes to without a pick: its owner, when an active member other than the leaver. */
export function keyGoesTo(
  item: HqTakeOverItem,
  member: string,
  people: ReadonlyArray<TakeOverPerson>,
): TakeOverPerson | null {
  if (item.kind !== "mate-key" || item.ownerUserId === undefined || item.ownerUserId === member)
    return null;
  return people.find(({ userId }) => userId === item.ownerUserId) ?? null;
}

const kindWords = { "mate-key": "Mate key", "deploy-token": "Deploy token" } as const;

function TakeOverRow({
  item,
  member,
  people,
  busy,
  onReplace,
}: {
  readonly item: HqTakeOverItem;
  readonly member: string;
  readonly people: ReadonlyArray<TakeOverPerson>;
  readonly busy: boolean;
  readonly onReplace: (ownerUserId?: string) => void;
}) {
  const owner = keyGoesTo(item, member, people);
  const picks = item.kind === "mate-key" && item.inUse && owner === null;
  const [picked, setPicked] = useState<string | null>(null);
  const candidates = people.filter(({ userId }) => userId !== member);
  const line = !item.inUse
    ? "HQ no longer uses it: it is only deleted."
    : item.kind === "deploy-token"
      ? "Replaced by one you mint; the environment deploys with yours."
      : owner !== null
        ? `Replaced by one you mint; the Mate stays with ${owner.name}.`
        : "Its owner is leaving: pick who gets the Mate.";
  return (
    <li className="tm-block-head" data-token={item.tokenId}>
      <span className="tm-block-text">
        <span className="tm-block-title">
          {kindWords[item.kind]} · {item.label}
        </span>
        <span className="tm-block-desc">{line}</span>
      </span>
      {picks ? (
        <Select value={picked ?? ""} onValueChange={(value) => setPicked(value || null)}>
          <SelectTrigger
            size="sm"
            className="w-full sm:w-48"
            aria-label={`New owner of ${item.label}`}
          >
            <SelectValue>
              {candidates.find(({ userId }) => userId === picked)?.name ?? "New owner"}
            </SelectValue>
          </SelectTrigger>
          <SelectPopup align="end" alignItemWithTrigger={false}>
            {candidates.map(({ userId, name }) => (
              <SelectItem key={userId} hideIndicator value={userId}>
                {name}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      ) : null}
      <Button
        aria-busy={busy || undefined}
        disabled={busy || (picks && picked === null)}
        onClick={() => onReplace(picks && picked !== null ? picked : undefined)}
        size="sm"
        variant="secondary"
      >
        {item.inUse ? "Replace" : "Delete"}
      </Button>
    </li>
  );
}

export function MemberTakeOverView({
  read,
  member,
  memberName,
  people,
  onReplace,
  onAgain,
}: {
  readonly read: MemberTakeOverRead;
  /** The leaving member's Zerops user id. */
  readonly member: string;
  readonly memberName: string;
  /** The team's active members, who may get a Mate. */
  readonly people: ReadonlyArray<TakeOverPerson>;
  readonly onReplace: (tokenId: string, ownerUserId?: string) => void;
  readonly onAgain: () => void;
}) {
  const { list, action, last } = read;
  if (list.state === "unsupported" || list.state === "withheld") return null;
  const working = action.kind === "working";
  return (
    <section aria-label="Before removing" className="tm-section">
      <span className="tm-block-text">
        <h2 className="tm-block-title">Before removing</h2>
        <span className="tm-block-desc">
          Zerops refuses to remove {memberName} while a token they made exists. Replace each one
          here: HQ makes its successor with your sign-in and deletes theirs.
        </span>
      </span>
      {list.state === "known" ? (
        <>
          {list.list.items.length === 0 ? (
            <p className="tm-empty">Nothing of theirs is in use by HQ.</p>
          ) : (
            <ul className="tm-section">
              {list.list.items.map((item) => (
                <TakeOverRow
                  busy={working}
                  item={item}
                  key={item.tokenId}
                  member={member}
                  onReplace={(ownerUserId) => onReplace(item.tokenId, ownerUserId)}
                  people={people}
                />
              ))}
            </ul>
          )}
          {list.list.otherTokens > 0 ? (
            <p className="tm-trouble" role="status">
              {list.list.otherTokens === 1
                ? "They made 1 other token HQ does not use"
                : `They made ${list.list.otherTokens} other tokens HQ does not use`}
              ; Zerops refuses the removal until it is deleted in Zerops.
            </p>
          ) : null}
        </>
      ) : list.state === "failed" ? (
        <Failure
          action={
            <Button onClick={onAgain} size="sm" variant="secondary">
              Try again
            </Button>
          }
          cause={list.words}
        />
      ) : (
        <Loading count={2} label="Their tokens" shape="rows" />
      )}
      {action.kind === "failed" || action.kind === "unresolved" ? (
        <p className="tm-trouble" role="alert">
          {action.words}
        </p>
      ) : last?.answer?.replaced === true && !last.answer.oldDeleted ? (
        <p className="tm-trouble" role="status">
          Replaced, but Zerops kept the old token ({last.answer.reason ?? "refused"}): it stays
          listed to delete.
        </p>
      ) : null}
    </section>
  );
}
