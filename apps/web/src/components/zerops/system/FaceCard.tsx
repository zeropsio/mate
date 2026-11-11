/**
 * A card that leads with a face: the one drawing of a person on Settings › Team and of a Mate on
 * its project's page, so the two read as one family. Centred, top to bottom: a 64 px figure, a
 * title, chips, quiet lines; under them a foot for a press of the card's own. The card's body is one
 * press (the person's page, the Mate's conversation); what stands in the foot is outside it.
 *
 * Its classes are the Team page's (`tm-card…`, `index.css`): the look has one home.
 */
import { cloneElement, type ComponentProps, type ReactElement, type ReactNode } from "react";

/**
 * The grid the cards stand in: as many equal columns as fit a card 208 px wide, 14 px apart. Its
 * children are the caller's `<li className="grid">`, one per card, so every card in a row is as
 * tall as the tallest.
 */
export function FaceCards({
  label,
  children,
  ...rest
}: { readonly label: string; readonly children: ReactNode } & Omit<
  ComponentProps<"ul">,
  "className" | "aria-label"
>) {
  return (
    <ul {...rest} aria-label={label} className="tm-cards">
      {children}
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
  const said = (
    <>
      {stamp === undefined || stamp === null ? null : (
        <span className="tm-card-stamp">{stamp}</span>
      )}
      <span className="tm-card-face">{figure}</span>
      <span className="tm-card-name" data-part="name">
        {title}
      </span>
      {chips === undefined || chips === null ? null : (
        <span className="tm-card-badges">{chips}</span>
      )}
      {children}
    </>
  );
  const body =
    press === undefined ? (
      <div className="tm-card-body">{said}</div>
    ) : (
      cloneElement(press, { className: "tm-card-body" }, said)
    );
  const footed = foot !== undefined && foot !== null && foot !== false;
  return (
    <div
      {...data}
      className="tm-card"
      data-pending={faded || undefined}
      data-rest={rest === "middle" ? "middle" : undefined}
    >
      {body}
      {footed || footHeld ? (
        <span
          className="tm-card-foot"
          data-held={footHeld || undefined}
          data-ruled={ruled || undefined}
        >
          {footed ? foot : null}
        </span>
      ) : null}
    </div>
  );
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
      className="tm-card-mail"
      data-lines={lines === 2 ? "2" : undefined}
      data-tone={tone === "muted" ? undefined : tone}
    >
      {children}
    </span>
  );
}
