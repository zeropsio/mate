/**
 * A conversation's notices where there is no conversation to hold them — a fresh draft's hero, an
 * empty conversation (`noticesHome`): just above the composer, in their rows' own look
 * (`NoticeLine`), on the composer's text edge, so the empty state stays drawn around them.
 */
import { NoticeAnnouncer, NoticeLine, type ConversationNotice } from "./ConversationRows";

export function NoticesOverComposer({
  notices,
}: {
  readonly notices: ReadonlyArray<ConversationNotice>;
}) {
  return (
    <>
      {/* Always there, so a failure that comes is said, not a region mounted with it. */}
      <NoticeAnnouncer notices={notices} />
      {notices.length === 0 ? null : (
        <div
          className="mx-auto w-full min-w-0 max-w-3xl px-4.25 pb-2"
          data-notices-over-composer=""
        >
          {notices.map((notice) => (
            <NoticeLine key={notice.id} notice={notice} />
          ))}
        </div>
      )}
    </>
  );
}
