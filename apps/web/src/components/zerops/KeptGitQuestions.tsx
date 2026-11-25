import { Atom } from "effect/reactivity";
import { useNavigate } from "@tanstack/react-router";
import { hqKeptGitQuestions, type KeptGitQuestionView } from "@t3tools/client-runtime/data";
import { useAccountOrgId, useProjection } from "~/zerops/accountData";
import { appBasePath } from "~/basePath";
import { Button } from "../ui/button";
import { keptCodeLine } from "./KeptGitQuestions.logic";

const NO_QUESTIONS = Atom.make<ReadonlyArray<KeptGitQuestionView>>([]);

export function KeptCodeLine({
  count,
  href,
  onNavigate,
}: {
  readonly count: number;
  readonly href: string;
  readonly onNavigate?: (() => void) | undefined;
}) {
  const line = keptCodeLine(count);
  if (line === undefined) return null;
  return (
    <div className="px-4 py-1">
      <Button
        size="sm"
        variant="sidebar"
        render={<a href={href} />}
        onClick={(event) => {
          if (
            onNavigate === undefined ||
            event.button !== 0 ||
            event.ctrlKey ||
            event.metaKey ||
            event.altKey ||
            event.shiftKey
          )
            return;
          event.preventDefault();
          onNavigate();
        }}
      >
        {line}
      </Button>
    </div>
  );
}

/** Navigation only shows questions HQ admits to this reader. */
export function KeptGitQuestions() {
  const orgId = useAccountOrgId();
  const questions = useProjection(hqKeptGitQuestions, orgId, NO_QUESTIONS);
  const navigate = useNavigate();
  if (orgId === null || questions.length === 0) return null;
  const appId = questions.length === 1 ? questions[0]?.question.appId : undefined;
  const href = `${appBasePath()}/git${appId === undefined ? "" : `?${new URLSearchParams({ appId })}`}`;
  return (
    <KeptCodeLine
      count={questions.length}
      href={href}
      onNavigate={() => {
        void navigate({ to: "/git", search: appId === undefined ? {} : { appId } });
      }}
    />
  );
}
