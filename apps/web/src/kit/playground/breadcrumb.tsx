import { Fragment } from "react";

import { InlineButton } from "~/components/ui/button";
import {
  WorkspaceBreadcrumb,
  WorkspaceBreadcrumbItem,
  WorkspaceBreadcrumbSeparator,
} from "~/components/WorkspaceBreadcrumb";

import { definePlayground, jsxElement } from "../kitPlayground";

/** The places above the current one, as each surface that wears a breadcrumb has them. */
const TRAILS = {
  settings: ["Settings", "Team"],
  data: ["db"],
  files: ["storefront", "src", "components"],
} as const;
const TRAIL_IDS = Object.keys(TRAILS) as (keyof typeof TRAILS)[];

export default definePlayground({
  section: "breadcrumb",
  name: "WorkspaceBreadcrumb",
  imports:
    'import { WorkspaceBreadcrumb, WorkspaceBreadcrumbItem, WorkspaceBreadcrumbSeparator } from "~/components/WorkspaceBreadcrumb";',
  controls: {
    trail: {
      kind: "enum",
      options: TRAIL_IDS,
      note: "the places above, as a page or panel has them",
    },
    current: { kind: "text", note: "where the person is: in the foreground" },
    pressable: { kind: "boolean", note: "each place above is a way back" },
    narrow: { kind: "boolean", note: "in 16rem: the current one truncates, the others hold" },
  },
  initial: { trail: "settings", current: "Petra Malá", pressable: true, narrow: false },
  render: ({ trail, current, pressable, narrow }) => (
    <div className={narrow ? "flex w-64" : "flex"}>
      <WorkspaceBreadcrumb ariaLabel="Breadcrumb">
        {TRAILS[trail].map((place) => (
          <Fragment key={place}>
            <WorkspaceBreadcrumbItem>
              {pressable ? <InlineButton tone="muted">{place}</InlineButton> : place}
            </WorkspaceBreadcrumbItem>
            <WorkspaceBreadcrumbSeparator />
          </Fragment>
        ))}
        {narrow ? (
          <WorkspaceBreadcrumbItem className="truncate" current>
            {current}
          </WorkspaceBreadcrumbItem>
        ) : (
          <WorkspaceBreadcrumbItem current>{current}</WorkspaceBreadcrumbItem>
        )}
      </WorkspaceBreadcrumb>
    </div>
  ),
  jsx: ({ trail, current, pressable, narrow }) =>
    jsxElement(
      "WorkspaceBreadcrumb",
      { ariaLabel: "Breadcrumb" },
      [
        ...TRAILS[trail].flatMap((place) => [
          jsxElement(
            "WorkspaceBreadcrumbItem",
            {},
            pressable ? `<InlineButton tone="muted">${place}</InlineButton>` : place,
          ),
          "<WorkspaceBreadcrumbSeparator />",
        ]),
        jsxElement(
          "WorkspaceBreadcrumbItem",
          { className: narrow ? "truncate" : undefined, current: true },
          current,
        ),
      ].join("\n"),
    ),
  usage: {
    do: [
      "Head a page or a panel's view that sits under another: Settings / Team / the member.",
      "Make each place above a muted InlineButton that goes back to it.",
      "Let the current place truncate in a narrow panel; the places above keep their width.",
    ],
    dont: [
      "Make the current place pressable: the person is already there.",
      "Use it as a page's title: the page still has its PageHeader.",
      "Draw a chevron or an arrow between places: the separator is a slash.",
    ],
  },
});
