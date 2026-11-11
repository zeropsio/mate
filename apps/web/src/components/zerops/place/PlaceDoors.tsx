/**
 * A place's two doors, the same two wherever a place is named — at the end of its line on an
 * overview card and the project page, in its own page's header, and at the foot of a Mate's card
 * on its project's page (a Mate's workspace is a place too): **Sites** (the menu's Sites panel,
 * narrowed to this place or this Mate) and **Vault** (the page's one vault drawer).
 *
 * On a line (`look="line"`) they are quiet and say their word where the line has the room, their
 * icon alone where it has not: the line's box is named `@container/place` by whoever draws it, and
 * a line 576 px wide holds its name, version, since-when and address beside both words. Beside
 * another verb at the line's end (`look="beside-verb"`: *Ask Juno to fix it*) the words need a line
 * 768 px wide, and under 448 px the doors give the verb their room: the place's page has them. In a
 * page's header (`look="page"`) they are the header's own buttons, always worded. At a card's foot
 * (`look="card"`) they are quiet and always worded: the narrowest card holds both words.
 */
import { ChevronDownIcon, GlobeIcon, KeyRound } from "lucide-react";
import type { ReactNode } from "react";

import { useProjectSitesOfGroup } from "~/zerops/projectPartsShown";

import { Button } from "../../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../../ui/tooltip";
import { MateSites, PageSites, PlaceSites } from "../SidebarProjectSites";
import type { MateSitesDoor, PlaceSitesDoor } from "./placeDoors.logic";

type Look = "line" | "beside-verb" | "page" | "card";

/** A door's word: there where the line is wide enough for both, always on a page's header. */
const WORD: Record<Look, string> = {
  line: "hidden text-line @xl/place:inline",
  "beside-verb": "hidden text-line @3xl/place:inline",
  page: "",
  card: "text-line",
};
/** What only a worded door carries: the mark that it opens a list under it. */
const MARK: Record<Look, string> = {
  line: "hidden size-3 shrink-0 opacity-70 @xl/place:inline",
  "beside-verb": "hidden size-3 shrink-0 opacity-70 @3xl/place:inline",
  page: "size-3 shrink-0 opacity-70",
  card: "size-3 shrink-0 opacity-70",
};
const VARIANT = {
  line: "ghost",
  "beside-verb": "ghost",
  page: "secondary",
  card: "ghost",
} as const;
/** On a line its row's height is the line's: the buttons' extra height overhangs it. */
const BOX: Record<Look, string> = {
  line: "-my-1 flex shrink-0 items-center",
  "beside-verb": "-my-1 hidden shrink-0 items-center @md/place:flex",
  page: "flex items-center gap-2",
  card: "flex items-center justify-center gap-1",
};

/**
 * Props: `name` (the place as it is named there: `Production`, or the Mate's name); `sites`
 * (`placeSitesOf(line, groupId)`, or a Mate's `{ groupId, mateProjectId }`: none where it serves
 * at no address); `vault` (opens the page's drawer on this
 * place; `open` where the caller knows it, for the page's own toggle); `look` (default `line`;
 * `beside-verb` where another verb stands at the line's end). Draws nothing where the place has
 * neither.
 */
export function PlaceDoors({
  name,
  sites,
  vault,
  look = "line",
}: {
  readonly name: string;
  readonly sites?: PlaceSitesDoor | MateSitesDoor | undefined;
  readonly vault?: { readonly onOpen: () => void; readonly open?: boolean } | undefined;
  readonly look?: Look;
}) {
  const drawn = useProjectSitesOfGroup(sites?.groupId);
  const sitesDoor =
    sites === undefined || drawn === undefined ? null : (
      <Door label={`Sites · ${name}`} look={look}>
        {(button) => {
          const said = (
            <>
              <GlobeIcon aria-hidden="true" />
              <span className={WORD[look]}>Sites</span>
              <ChevronDownIcon aria-hidden="true" className={MARK[look]} />
            </>
          );
          return "mateProjectId" in sites ? (
            <MateSites
              mateProjectId={sites.mateProjectId}
              name={name}
              sites={drawn}
              trigger={button}
            >
              {said}
            </MateSites>
          ) : (
            <PlaceSites name={name} place={sites} sites={drawn} trigger={button}>
              {said}
            </PlaceSites>
          );
        }}
      </Door>
    );
  const vaultDoor =
    vault === undefined ? null : (
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              aria-expanded={vault.open}
              aria-haspopup="dialog"
              aria-label={`Vault · ${name}`}
              data-zerops-place-door="vault"
              onClick={vault.onOpen}
              size="sm"
              variant={VARIANT[look]}
            />
          }
        >
          <KeyRound aria-hidden="true" />
          <span className={WORD[look]}>Vault</span>
        </TooltipTrigger>
        <TooltipPopup side="top">{`Vault · ${name}`}</TooltipPopup>
      </Tooltip>
    );
  if (sitesDoor === null && vaultDoor === null) return null;
  return (
    <span className={BOX[look]} data-zerops-place-doors="">
      {sitesDoor}
      {vaultDoor}
    </span>
  );
}

/**
 * Whether a place line's Sites door is drawn (`PlaceDoors` with `sites`): the line then leaves its
 * address to the door. Where the menu has not drawn the project there is no door, and the line
 * keeps its address: it is the only way there.
 */
export function usePlaceSitesDrawn(groupId: string): boolean {
  return useProjectSitesOfGroup(groupId) !== undefined;
}

/**
 * The whole project's Sites, in its page's header: the worded door a place's page has, opening
 * every address of the project grouped by where it runs (`PageSites`). It says **All sites**: the
 * page has a Sites door on every place and every Mate, each opening only its own (the owner,
 * 2026-11-11: "now we have ten sites button which each do something diff"). Draws nothing where
 * the project answers nowhere (`answers`), or where the menu has not drawn it.
 *
 * Props: `groupId`; `name` (the project's); `answers` (it has an address or a Mate's preview:
 * `projectAnswers(…)`).
 */
export function ProjectSitesDoor({
  groupId,
  name,
  answers,
}: {
  readonly groupId: string;
  readonly name: string;
  readonly answers: boolean;
}) {
  const drawn = useProjectSitesOfGroup(answers ? groupId : undefined);
  if (drawn === undefined) return null;
  return (
    <Door label={`All sites · ${name}`} look="page">
      {(button) => (
        <PageSites sites={drawn} trigger={button}>
          <GlobeIcon aria-hidden="true" />
          <span>All sites</span>
          <ChevronDownIcon aria-hidden="true" className={MARK.page} />
        </PageSites>
      )}
    </Door>
  );
}

/** A door that opens a popover under it, named in a tooltip: the button is both things' trigger. */
function Door({
  label,
  look,
  children,
}: {
  readonly label: string;
  readonly look: Look;
  readonly children: (button: React.ReactElement) => ReactNode;
}) {
  return (
    <Tooltip>
      {children(
        <TooltipTrigger
          render={
            <Button
              aria-label={label}
              data-zerops-place-door="sites"
              size="sm"
              variant={VARIANT[look]}
            />
          }
        />,
      )}
      <TooltipPopup side="top">{label}</TooltipPopup>
    </Tooltip>
  );
}
