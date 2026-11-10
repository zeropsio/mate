/**
 * A place's two doors, the same two wherever a place is named — at the end of its line on an
 * overview card and the project page, and in its own page's header: **Sites** (the menu's Sites
 * panel, narrowed to this place) and **Vault** (the page's one vault drawer).
 *
 * On a line (`look="line"`) they are quiet and say their word where the line has the room, their
 * icon alone where it has not: the line's box is named `@container/place` by whoever draws it, and
 * a line 576 px wide holds its name, version, since-when and address beside both words. Beside
 * another verb at the line's end (`look="beside-verb"`: *Ask Juno to fix it*) the words need a line
 * 768 px wide, and under 448 px the doors give the verb their room: the place's page has them. In a
 * page's header (`look="page"`) they are the header's own buttons, always worded.
 */
import { ChevronDownIcon, GlobeIcon, KeyRound } from "lucide-react";
import type { ReactNode } from "react";

import { useProjectSitesOfGroup } from "~/zerops/projectPartsShown";

import { Button } from "../../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../../ui/tooltip";
import { PlaceSites } from "../SidebarProjectSites";
import type { PlaceSitesDoor } from "./placeDoors.logic";

type Look = "line" | "beside-verb" | "page";

/** A door's word: there where the line is wide enough for both, always on a page's header. */
const WORD: Record<Look, string> = {
  line: "hidden text-line @xl/place:inline",
  "beside-verb": "hidden text-line @3xl/place:inline",
  page: "",
};
/** What only a worded door carries: the mark that it opens a list under it. */
const MARK: Record<Look, string> = {
  line: "hidden size-3 shrink-0 opacity-70 @xl/place:inline",
  "beside-verb": "hidden size-3 shrink-0 opacity-70 @3xl/place:inline",
  page: "size-3 shrink-0 opacity-70",
};
const VARIANT = { line: "ghost", "beside-verb": "ghost", page: "secondary" } as const;
/** On a line its row's height is the line's: the buttons' extra height overhangs it. */
const BOX: Record<Look, string> = {
  line: "-my-1 flex shrink-0 items-center",
  "beside-verb": "-my-1 hidden shrink-0 items-center @md/place:flex",
  page: "flex items-center gap-2",
};

/**
 * Props: `name` (the place as it is named there: `Production`); `sites` (`placeSitesOf(line,
 * groupId)`: none where the place serves at no address); `vault` (opens the page's drawer on this
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
  readonly sites?: PlaceSitesDoor | undefined;
  readonly vault?: { readonly onOpen: () => void; readonly open?: boolean } | undefined;
  readonly look?: Look;
}) {
  const drawn = useProjectSitesOfGroup(sites?.groupId);
  const sitesDoor =
    sites === undefined || drawn === undefined ? null : (
      <Door label={`Sites · ${name}`} look={look}>
        {(button) => (
          <PlaceSites name={name} place={sites} sites={drawn} trigger={button}>
            <GlobeIcon aria-hidden="true" />
            <span className={WORD[look]}>Sites</span>
            <ChevronDownIcon aria-hidden="true" className={MARK[look]} />
          </PlaceSites>
        )}
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
