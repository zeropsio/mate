/**
 * Where the project takes tasks from, at the foot of the Board's page, on its rows' edges: each
 * source its mark, what it is, and under it where or when and how many of its tasks wait. For an
 * Owner or Admin a row opens its form — its Stop and its Delete live there — and *Add* offers every
 * kind; with none set yet, the kinds stand in the group that will hold them.
 */
import {
  CalendarClockIcon,
  ChevronRightIcon,
  HashIcon,
  MessagesSquareIcon,
  WebhookIcon,
} from "lucide-react";

import { cn } from "~/lib/utils";

import { GitHubIcon } from "../../Icons";
import { Button } from "../../ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../../ui/menu";
import { Row } from "../../ui/row";
import { Text } from "../../ui/text";
import { WaitLine } from "../WaitLine";
import { BOARD_ROW, LaneHeading } from "./BoardList";
import type { SourceControls } from "./boardView";
import { SOURCE_KINDS, type SourceKind, type SourceRow } from "./projectAutomation.logic";

/** A source's mark: GitHub's, a channel's, a webhook, a schedule, as a task's card has them. */
function SourceMark({ kind }: { readonly kind: SourceKind }) {
  const Icon =
    kind === "github"
      ? GitHubIcon
      : kind === "slack"
        ? HashIcon
        : kind === "discord"
          ? MessagesSquareIcon
          : kind === "webhook"
            ? WebhookIcon
            : CalendarClockIcon;
  return <Icon aria-hidden="true" className="size-4 text-muted-foreground" />;
}

export function BoardSources({
  sources,
  admin,
}: {
  readonly sources: {
    readonly rows: ReadonlyArray<SourceRow>;
    readonly reading: boolean;
    /** Some sources are refused to the reader: what is shown is not every source. */
    readonly withheld: boolean;
  };
  readonly admin: SourceControls | undefined;
}) {
  const { rows } = sources;
  const none = rows.length === 0;
  // Nothing to read and nothing the reader could add: the group is not drawn.
  if (none && !sources.reading && !sources.withheld && admin === undefined) return null;
  const count = rows.filter((row) => row.kind !== "failed").length;
  return (
    <div
      className={cn(BOARD_ROW.lane, "mt-6")}
      data-zerops-board="Takes tasks from"
      data-zerops-surface="project-automation-sources"
    >
      <LaneHeading
        action={
          admin === undefined || none ? undefined : (
            <Menu>
              <MenuTrigger render={<Button size="sm" variant="link" />}>+ Add</MenuTrigger>
              <MenuPopup align="end">
                {SOURCE_KINDS.map((entry) => (
                  <MenuItem
                    key={entry.kind}
                    onClick={() => {
                      admin.onTakeFrom(entry.kind);
                    }}
                  >
                    {entry.label}
                  </MenuItem>
                ))}
              </MenuPopup>
            </Menu>
          )
        }
        count={count === 0 ? undefined : count}
        name="Takes tasks from"
      />
      {!none ? (
        <ul className={BOARD_ROW.rows}>
          {rows.map((row) => (
            <SourceRowView admin={admin} key={row.key} row={row} />
          ))}
        </ul>
      ) : sources.reading ? (
        <div className={BOARD_ROW.line}>
          <WaitLine text="Reading…" />
        </div>
      ) : admin === undefined ? null : (
        // No source yet: the kinds stand in the group that will hold them.
        <div className="flex flex-wrap gap-2 px-2.5 pt-1 pb-2">
          {SOURCE_KINDS.map((entry) => (
            <Button
              key={entry.kind}
              onClick={() => {
                admin.onTakeFrom(entry.kind);
              }}
              size="sm"
              variant="secondary"
            >
              {entry.label}
            </Button>
          ))}
        </div>
      )}
      {sources.withheld ? (
        <Text className="m-0 px-2.5 pt-1.5 pb-0.5" render={<p />} variant="note">
          Owners and admins see every source.
        </Text>
      ) : null}
    </div>
  );
}

function SourceRowView({
  row,
  admin,
}: {
  readonly row: SourceRow;
  readonly admin: SourceControls | undefined;
}) {
  const failed = row.kind === "failed";
  const disconnected = (row.kind === "slack" || row.kind === "discord") && row.disconnected;
  const line = [row.detail, row.meta].filter((said) => said !== null).join(" · ");
  const cells = (
    <>
      <span className={BOARD_ROW.lead}>
        <SourceMark kind={failed ? row.source : row.kind} />
      </span>
      <span className={BOARD_ROW.text}>
        <span
          className={cn(BOARD_ROW.title, failed && "text-status-failed-text")}
          role={failed ? "alert" : undefined}
        >
          {row.title}
          {row.kind === "github" ? ` ${row.label}` : null}
        </span>
        {disconnected ? (
          <span className={cn(BOARD_ROW.meta, "text-status-attention-text")}>Not connected</span>
        ) : line === "" ? null : (
          <span className={BOARD_ROW.meta}>{line}</span>
        )}
      </span>
      {admin === undefined || failed || disconnected ? null : (
        <ChevronRightIcon
          aria-hidden="true"
          className="col-start-3 row-start-1 ms-3 size-4 self-center text-muted-foreground"
        />
      )}
    </>
  );
  return (
    <li className={BOARD_ROW.row} data-zerops-source={row.kind}>
      {admin === undefined ? (
        <Row className="row-start-1 items-center" columns>
          {cells}
        </Row>
      ) : (
        <Row
          className="row-start-1 items-center"
          columns
          data-press=""
          onClick={() => {
            admin.onEdit(row);
          }}
          pressable
          render={<button type="button" />}
        >
          {cells}
        </Row>
      )}
      {admin === undefined ? null : failed ? (
        <span className={BOARD_ROW.seat}>
          <Button
            onClick={() => {
              admin.onReadAgain(row.source);
            }}
            size="sm"
            variant="ghost"
          >
            Try again
          </Button>
        </span>
      ) : disconnected ? (
        <span className={BOARD_ROW.seat}>
          <Button onClick={admin.onOpenSettings} size="sm" variant="secondary">
            Connect
          </Button>
        </span>
      ) : null}
    </li>
  );
}
