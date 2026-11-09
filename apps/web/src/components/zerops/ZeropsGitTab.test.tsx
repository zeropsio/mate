import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vite-plus/test";
import { DraftId } from "../../composerDraftStore";
import { ZeropsGitTab, type ZeropsGitTabProps } from "./ZeropsGitTab";

// The page's "What changed" reads git through hooks of its own: here it is its top and commits.
vi.mock("../CodeChanges", () => ({
  CodeChanges: (props: {
    readonly top?: import("react").ReactNode;
    readonly commitsFor?: (repository: string) => import("react").ReactNode;
    readonly className?: string;
  }) => (
    <div className={props.className}>
      {props.top}
      {props.commitsFor?.("")}
    </div>
  ),
}));
const source = vi.hoisted(() => ({ error: undefined as string | undefined, again: vi.fn() }));
vi.mock("../../zerops/useProjectTopology", () => ({
  useProjectTopology: () => ({ view: undefined, error: source.error, again: source.again }),
}));
const props: ZeropsGitTabProps = {
  threadRef: null,
  composerDraftTarget: DraftId.make("draft-tea"),
  appId: undefined,
  declarations: [],
  changes: undefined,
  mateProjectId: undefined,
  isOwner: false,
};
it.each([undefined, "Zerops refused the services list."])(
  "an unread or refused topology never says there are no repositories (%s)",
  (error) => {
    source.error = error;
    const markup = renderToStaticMarkup(<ZeropsGitTab {...props} />);
    expect(markup).toContain(error ?? "Reading repositories.");
    expect(markup).toContain("Read again");
    expect(markup).not.toContain("No repositories");
  },
);
