/**
 * Where a person takes a chat account link HQ said to their Slack or Discord account
 * (`/chat-link#<code>`): taken once in the organization open here as soon as its HQ answers, and
 * again only on a press, after a refusal.
 */
import { canonicalHqNavigation } from "@t3tools/client-runtime/data";
import type { HqChatLink } from "@t3tools/shared/hqChatLinks";
import { Atom } from "effect/reactivity";
import { useCallback, useEffect, useRef, useState } from "react";

import { useAccountOperationsOptional } from "~/zerops/accountOperations";
import { takeChatLinkCode } from "~/zerops/chatLinkCode";
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

export function ChatLinkPage() {
  const [code] = useState(takeChatLinkCode);
  const orgId = useAccountOrgId();
  const organization = useZeropsSession().activeOrganization;
  const live = useProjection(canonicalHqNavigation, orgId, NONE)?.link.kind === "live";
  const operations = useAccountOperationsOptional();
  const [taking, setTaking] = useState<Taking>({ kind: "waiting" });
  const sent = useRef(false);

  const take = useCallback(async () => {
    if (code === null || orgId === null || operations === null) return;
    setTaking({ kind: "waiting" });
    const { progress, link } = await operations.takeChatLink(orgId, code);
    if (link !== undefined) setTaking({ kind: "linked", link });
    else if (progress.stage === "uncertain") setTaking({ kind: "uncertain" });
    else
      setTaking({
        kind: "refused",
        words:
          ("reason" in progress ? progress.reason : undefined) ?? "HQ did not link your account.",
      });
  }, [code, operations, orgId]);

  useEffect(() => {
    if (sent.current || !live) return;
    sent.current = true;
    void take();
  }, [live, take]);

  if (code === null)
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
          actions={<Button onClick={() => void take()}>Try again</Button>}
          data-chat-link="refused"
          title="Your chat account isn't linked"
        >
          <p>{taking.words}</p>
          <p>You are signed in to {organization?.name ?? "no organization"}.</p>
        </StatusPage>
      );
  }
}
