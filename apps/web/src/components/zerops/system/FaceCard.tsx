/**
 * A card that leads with a face: the one drawing of a person on Settings › Team and of a Mate on
 * its project's page, so the two read as one family. Centred, top to bottom: a 64 px figure, a
 * title, chips, quiet lines; under them a foot for a press of the card's own. The card's body is one
 * press (the person's page, the Mate's conversation); what stands in the foot is outside it.
 *
 * On a phone the cards either stay cards, become the team's rows (`phone="rows"`: a 40 px face, the
 * name with its chips beside it, the lines under them), or lie down (`phone="lying"`: a project's
 * Mates, a card a third as tall, its face at the left and its words beside it).
 */
import {
  cloneElement,
  createContext,
  use,
  type ComponentProps,
  type ReactElement,
  type ReactNode,
} from "react";

import { cn } from "~/lib/utils";

/** How the cards of one grid stand on a phone (`FaceCards phone`). */
type FacePhone = "cards" | "rows" | "lying";

const FacePhoneContext = createContext<FacePhone>("cards");

/**
 * The grid the cards stand in: as many equal columns as fit a card 208 px wide, 14 px apart. Its
 * children are the caller's `<li className="grid">`, one per card, so every card in a row is as
 * tall as the tallest. `phone`: how they stand on a phone (one column, but for `cards`).
 */
export function FaceCards({
  label,
  children,
  phone = "cards",
  ...rest
}: {
  readonly label: string;
  readonly children: ReactNode;
  readonly phone?: FacePhone;
} & Omit<ComponentProps<"ul">, "className" | "aria-label">) {
  return (
    <ul
      {...rest}
      aria-label={label}
      className={cn(
        "grid grid-cols-[repeat(auto-fill,minmax(208px,1fr))] gap-3.5",
        phone === "rows" && "max-sm:-mx-3 max-sm:grid-cols-1 max-sm:gap-0",
        phone === "lying" && "max-sm:auto-rows-fr max-sm:grid-cols-1 max-sm:gap-2",
      )}
    >
      <FacePhoneContext value={phone}>{children}</FacePhoneContext>
    </ul>
  );
}

/**
 * Props: `figure` (a 64 px face); `title`; `chips` (pills under the title); `children` (its
 * lines: `FaceCardLine`s, or anything a line long); `foot` (presses of the card's own, under what
 * it says; with `footHeld` its seat keeps its height while empty, so a verb arriving moves
 * nothing); `press` (the element the body is — a `<Link>`, a `<button>` — where the card opens
 * something; a plain block where absent); `stamp` (a few quiet characters in the body's top
 * corner: when it last moved); `ruled`
 * (its foot under a hairline, a row of the card's own doors); `faded` (its figure paler: an invitation not accepted yet); `rest` (`"top"`, the lines
 * hanging from the figure so faces line up along a row; `"middle"`, what it says centred in a card
 * its row made taller).
 */
export function FaceCard({
  figure,
  title,
  chips,
  children,
  foot,
  footHeld = false,
  press,
  stamp,
  ruled = false,
  faded = false,
  rest = "top",
  ...data
}: {
  readonly figure: ReactNode;
  readonly title: ReactNode;
  readonly chips?: ReactNode;
  readonly children?: ReactNode;
  readonly foot?: ReactNode;
  readonly footHeld?: boolean;
  readonly press?: ReactElement<{ className?: string; children?: ReactNode }> | undefined;
  readonly stamp?: ReactNode;
  readonly ruled?: boolean;
  readonly faded?: boolean;
  readonly rest?: "top" | "middle";
} & { readonly [key: `data-${string}`]: string | undefined }) {
  const phone = use(FacePhoneContext);
  const said = (
    <>
      {stamp === undefined || stamp === null ? null : (
        // A few quiet characters in the body's top corner: when it last moved.
        <span className="absolute top-3 right-3.5 inline-flex items-center gap-1.5 text-caption leading-4 whitespace-nowrap text-muted-foreground tabular-nums">
          {stamp}
        </span>
      )}
      <span
        className={cn(
          "relative mb-3 flex",
          faded && "opacity-55",
          phone === "rows" &&
            "max-sm:row-span-2 max-sm:mb-0 max-sm:self-start max-sm:*:size-10 max-sm:*:text-emphasis",
          phone === "lying" &&
            "max-sm:col-start-1 max-sm:row-span-3 max-sm:mb-0 max-sm:self-start max-sm:*:data-[zerops-primitive=mate-face]:size-12",
        )}
        data-face=""
      >
        {figure}
      </span>
      <span
        className={cn(
          "max-w-full truncate text-emphasis leading-5 font-medium text-foreground",
          phone === "rows" && "max-sm:col-start-2",
        )}
        data-part="name"
      >
        {title}
      </span>
      {chips === undefined || chips === null ? null : (
        <span
          className={cn(
            "mt-1 mb-0.5 flex flex-wrap justify-center gap-1",
            phone === "rows" && "max-sm:col-start-3 max-sm:m-0 max-sm:-ms-1 max-sm:flex-nowrap",
          )}
        >
          {chips}
        </span>
      )}
      {children}
    </>
  );
  const pressed = press !== undefined;
  // The card's own page opens from all of it but its foot, whose press is its own: a body that
  // opens something reaches under the foot, whose presses stand over it.
  const bodyClass = cn(
    "grid min-w-0 flex-1 content-start justify-items-center gap-1 rounded-card px-4 pt-6.5 pb-5.5 outline-none",
    pressable(pressed),
    rest === "middle" && "content-center",
    ruled && "pb-4",
    phone === "rows" &&
      "max-sm:min-h-14 max-sm:grid-cols-[40px_minmax(0,auto)_minmax(0,1fr)] max-sm:content-center max-sm:items-center max-sm:justify-items-start max-sm:gap-x-3 max-sm:gap-y-0 max-sm:px-3 max-sm:py-2 max-sm:text-left",
    phone === "lying" && (ruled ? "max-sm:pb-4" : "max-sm:pb-0"),
    phone === "lying" &&
      "max-sm:grid-cols-[48px_minmax(0,1fr)] max-sm:content-start max-sm:justify-items-start max-sm:gap-x-3 max-sm:gap-y-0 max-sm:pt-3 max-sm:pe-9 max-sm:ps-3 max-sm:text-start max-sm:[&>:not([data-face])]:col-start-2",
  );
  const body = pressed ? (
    cloneElement(press, { className: bodyClass, "data-face-card-press": "" } as object, said)
  ) : (
    <div className={bodyClass}>{said}</div>
  );
  const footed = foot !== undefined && foot !== null && foot !== false;
  return (
    <div
      {...data}
      className={cn(
        // A person or a Mate lifted off the page; its ground lit under the pointer adds to the
        // lift. The lift's own accent, a step under it, is what a quiet press lights on it.
        "relative flex min-w-0 flex-col rounded-card bg-muted text-center transition-[background-color,box-shadow] duration-150 ease-out-strong [--accent:color-mix(in_oklab,var(--foreground)_6%,var(--muted))]",
        "has-[>[data-face-card-press]:hover]:bg-foreground/9 has-[>[data-face-card-press]:hover]:inset-ring has-[>[data-face-card-press]:hover]:inset-ring-border",
        "has-[>[data-face-card-press]:focus-visible]:ring-2 has-[>[data-face-card-press]:focus-visible]:ring-ring has-[>[data-face-card-press]:focus-visible]:ring-offset-2 has-[>[data-face-card-press]:focus-visible]:ring-offset-background",
        phone === "rows" && "max-sm:bg-transparent max-sm:text-left",
        phone === "lying" && "max-sm:text-start",
      )}
    >
      {body}
      {footed || footHeld ? (
        <span
          className={cn(
            "grid justify-items-center gap-1 px-4 text-body leading-4.5 *:relative *:z-1",
            ruled ? "min-h-11.25 border-t border-border px-3 py-1.5" : "-mt-3.5 pb-4.5",
            // A foot that keeps its seat while it holds nothing, so a verb arriving moves nothing;
            // a ruled one is one height whatever stands in it.
            footHeld && !ruled && "min-h-12.5 content-center",
            footHeld && ruled && "content-center",
            phone === "rows" &&
              "max-sm:-mt-1 max-sm:justify-items-start max-sm:pt-0 max-sm:pe-3 max-sm:pb-2.5 max-sm:ps-16",
            phone === "lying" && "max-sm:mt-0 max-sm:justify-items-start",
            phone === "lying" && !ruled && "max-sm:pt-0 max-sm:pe-3 max-sm:pb-2 max-sm:ps-18",
            phone === "lying" &&
              footHeld &&
              "max-sm:min-h-10 max-sm:empty:min-h-3 max-sm:empty:py-0",
          )}
        >
          {footed ? foot : null}
        </span>
      ) : null}
    </div>
  );
}

/** A body that opens something is the whole card's press, its hit area the card's. */
function pressable(pressed: boolean): string | false {
  return pressed && "cursor-pointer after:absolute after:inset-0 after:rounded-card";
}

/**
 * One quiet line of a face card: a single line cut at the card's edge, or (`lines={2}`) two lines
 * that keep their height whatever they hold. `tone`: `ink` for what is asked of the person,
 * `failed` and `attention` for what is not calm; muted where absent.
 */
export function FaceCardLine({
  children,
  lines = 1,
  tone,
  ...rest
}: {
  readonly children: ReactNode;
  readonly lines?: 1 | 2;
  readonly tone?: "muted" | "ink" | "failed" | "attention" | undefined;
} & Omit<ComponentProps<"span">, "className" | "children">) {
  return (
    <span
      {...rest}
      className={cn(
        "max-w-full text-body leading-4.5",
        // Two lines tall whatever it holds, cut after them: a card's height never follows its words.
        lines === 2 ? "line-clamp-2 h-9 text-pretty" : "truncate",
        tone === "ink"
          ? "text-foreground"
          : tone === "failed"
            ? "text-status-failed-text"
            : tone === "attention"
              ? "text-status-attention-text"
              : "text-muted-foreground",
        use(FacePhoneContext) === "rows" && "max-sm:col-[2/-1]",
      )}
    >
      {children}
    </span>
  );
}
