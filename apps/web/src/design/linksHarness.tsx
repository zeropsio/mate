/**
 * Links inside a Mate's answer: a service's address (opens in the side panel), a named link to
 * one, a pasted address on the web, a named link to the web, and a change of the person's group
 * in the Mate's words and as a bare address (opens its review) — in a sentence, before a full
 * stop, and on a line of their own.
 *
 * Served by the dev server at `/design-links.html` (`?theme=dark`). Open it at 1786 × 1000; the
 * column is the conversation's (max-w-3xl) beside the owner's 435 px menu.
 *
 * Fixtures only. Nothing here ships — `design-links.html` is not `index.html`, and no route
 * imports this module.
 */
import type { ZeropsTopologyService } from "@t3tools/client-runtime/zerops/topology";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import ChatMarkdown from "~/components/ChatMarkdown";
import { ServiceBrowserScope } from "~/components/ServiceBrowserLink";
import { applyThemePalette, ZEROPS_THEME_ID } from "~/themePalette";
import { ZeropsProjectFlowContext, type ZeropsProjectFlowValue } from "~/zerops/projectFlowContext";
import "../index.css";

const params = new URLSearchParams(location.search);
const appearance = params.get("theme") === "dark" ? "dark" : "light";

const host = "webdev-1a2b-3000.prg1.zerops.app";
const services: ZeropsTopologyService[] = [
  {
    hostname: "webdev",
    serviceId: "webdev",
    type: "nodejs@22",
    status: "ACTIVE",
    group: "runtimes",
    transient: false,
    ports: [],
    routes: [{ url: `https://${host}`, host, port: 3000 }],
  },
];

const GITEA = "https://forge-7c1d-3000.prg1.zerops.app";

/** The person's group, with change #7 open on its site repository. */
const FLOW = {
  giteaOrigin: GITEA,
  slugs: new Map([["group-1", "orchard"]]),
  askForOwner: () => {},
  flows: new Map([
    [
      "group-1",
      {
        pullRequests: [
          {
            repository: "site",
            number: 7,
            line: "Screenshots of the new landing page",
            merged: false,
            mergeability: "mergeable",
            checks: "passing",
          },
        ],
      },
    ],
  ]),
} as unknown as ZeropsProjectFlowValue;

/** A change opened in the app, as the conversation's own resolver would. */
const openChange = (href: string) =>
  href.startsWith(GITEA) ? () => console.info("open change", href) : null;

const ANSWER = [
  `The guestbook is live on the dev service: https://${host}/app. I added an entry through the form and it listed it at once.`,
  "",
  `Open [the guestbook on webdev](https://${host}/) to try it; the form posts to https://${host}/entries, which answers 201.`,
  "",
  "It follows the pattern in https://github.com/zeropsio/recipes/blob/main/nodejs.md, and the [Zerops docs](https://docs.zerops.io/nodejs/overview) explain the ports.",
  "",
  `The changes are in the [site pull request](${GITEA}/orchard/site/pulls/7), with screenshots in its description; the files are at ${GITEA}/orchard/site/pulls/7/files.`,
  "",
  `- dev: https://${host}/`,
  "- docs: https://docs.zerops.io/",
].join("\n");

function Harness() {
  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <div className="w-[435px] shrink-0 border-e border-border bg-sidebar" />
      <ServiceBrowserScope
        threadRef={{ environmentId: EnvironmentId.make("env-h"), threadId: ThreadId.make("t-h") }}
        services={services}
        resolveAppLink={openChange}
        className="min-w-0 flex-1 px-8 py-10"
      >
        <div className="mx-auto w-full max-w-3xl" data-links-harness="answer">
          <ChatMarkdown variant="answer" text={ANSWER} cwd={undefined} />
        </div>
      </ServiceBrowserScope>
    </div>
  );
}

document.documentElement.classList.toggle("dark", appearance === "dark");
applyThemePalette(ZEROPS_THEME_ID, appearance);
createRoot(document.getElementById("design")!).render(
  <StrictMode>
    <ZeropsProjectFlowContext.Provider value={FLOW}>
      <Harness />
    </ZeropsProjectFlowContext.Provider>
  </StrictMode>,
);
