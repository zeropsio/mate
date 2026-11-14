/**
 * Where a person takes a chat account link HQ said to their Slack or Discord account
 * (`/chat-link#<code>`): taken once in the organization open here as soon as its HQ answers, or
 * once HQ's away budget has passed (the data layer then says why it was not sent), and again only on
 * a press, after a refusal. One take per document: the page opened again shows its answer.
 */
import { canonicalHqNavigation, HQ_AWAY_BUDGET_MS } from "@t3tools/client-runtime/data";
import { HQ_NOT_OPEN } from "@t3tools/client-runtime/zerops/hq";
import type { HqChatLink } from "@t3tools/shared/hqChatLinks";
import { Atom } from "effect/reactivity";
import { useCallback, useEffect, useState } from "react";

import { useAccountOperationsOptional } from "~/zerops/accountOperations";
import { spendChatLinkCode, takeChatLinkCode } from "~/zerops/chatLinkCode";
import { useAccountOrgId, useProjection } from "~/zerops/ZeropsAccountData";
import { useZeropsSession } from "~/zerops/ZeropsSessionProvider";

import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";
import { StatusPage } from "../ui/status-page";

type Taking =
  | { readonly kind: "waiting" }
  | { readonly kind: "linked"; readonly link: HqChatLink }
  | { readonly kind: "refused"; readonly words: string }
  | { readonly kind: "uncertain" };

const NONE = Atom.make(null);

const PLATFORM: Record<HqChatLink["provider"], { readonly name: string; readonly ask: string }> = {
  discord: { name: "Discord", ask: "Ask Mate with /mate in Discord." },
  slack: { name: "Slack", ask: "Ask Mate by mentioning @Mate in Slack." },
};

/** This document's take: whether it was sent, and its last answer, for every mount of the page. */
let sent = false;
let answer: Taking = { kind: "waiting" };

export function ChatLinkPage() {
  const [code] = useState(takeChatLinkCode);
  const orgId = useAccountOrgId();
  const organization = useZeropsSession().activeOrganization;
  const live = useProjection(canonicalHqNavigation, orgId, NONE)?.link.kind === "live";
  const operations = useAccountOperationsOptional();
  const [taking, setTaking] = useState<Taking>(answer);
  const [waited, setWaited] = useState(false);

  const said = useCallback((next: Taking) => {
    answer = next;
    if (next.kind === "linked" || next.kind === "uncertain") spendChatLinkCode();
    setTaking(next);
  }, []);

  const take = useCallback(async () => {
    if (code === null) return;
    sent = true;
    if (orgId === null || operations === null) return said({ kind: "refused", words: HQ_NOT_OPEN });
    said({ kind: "waiting" });
    const { progress, link } = await operations.takeChatLink(orgId, code);
    if (link !== undefined) said({ kind: "linked", link });
    else if (progress.stage === "uncertain") said({ kind: "uncertain" });
    else
      said({
        kind: "refused",
        words:
          ("reason" in progress ? progress.reason : undefined) ?? "HQ did not link your account.",
      });
  }, [code, operations, orgId, said]);

  // HQ's link opens after sign-in; past its away budget the take goes all the same.
  useEffect(() => {
    const timer = window.setTimeout(() => setWaited(true), HQ_AWAY_BUDGET_MS.unreachable);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (sent || !(live || waited)) return;
    void take();
  }, [live, take, waited]);

  if (code === null && taking.kind === "waiting")
    return (
      <StatusPage data-chat-link="no-code" title="This page needs a link from Mate">
        <p>Open the link Mate sent you in Slack or Discord again.</p>
      </StatusPage>
    );
  switch (taking.kind) {
    case "waiting":
      return (
        <StatusPage
          data-chat-link="waiting"
          mark={<Spinner size="md" />}
          title="Linking your chat account…"
        />
      );
    case "linked": {
      const platform = PLATFORM[taking.link.provider];
      return (
        <StatusPage data-chat-link="linked" title={`Your ${platform.name} account is linked`}>
          <p>
            It speaks for you in {organization?.name ?? "this organization"}. {platform.ask}
          </p>
        </StatusPage>
      );
    }
    case "uncertain":
      return (
        <StatusPage data-chat-link="uncertain" title="HQ's answer was lost">
          <p>
            Your account may be linked. Ask Mate in Slack or Discord again: if it is not linked,
            Mate answers with a new link.
          </p>
        </StatusPage>
      );
    case "refused":
      return (
        <StatusPage
          actions={code === null ? null : <Button onClick={() => void take()}>Try again</Button>}
          data-chat-link="refused"
          title="Your chat account isn't linked"
        >
          <p>{taking.words}</p>
          <p>You are signed in to {organization?.name ?? "no organization"}.</p>
        </StatusPage>
      );
  }
}
