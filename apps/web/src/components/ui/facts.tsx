import type { ComponentProps, ReactNode } from "react";

import { cn } from "~/lib/utils";

/**
 * Facts about one thing, each label beside its value: what a change sets (a service's type, where
 * it connects), what a picture carries, what a failure's source said. The labels in one column as
 * wide as the widest, in the muted ink; the values in the foreground, wrapping anywhere. `mono`
 * sets the values in the code face, for literals (an address, a key, a type); the labels stay
 * words. A value that changes says so with `was`: the old one struck through, an arrow, the new.
 *
 * Facts set into a card are a `Card variant="inset"` around them; text read whole (a config, an
 * import) is a `CodeBlock`.
 */
function Facts({
  mono = false,
  className,
  children,
  ...props
}: ComponentProps<"dl"> & {
  /** The values are literals, in the code face. */
  readonly mono?: boolean;
}) {
  return (
    <dl
      className={cn(
        "m-0 grid min-w-0 grid-cols-[max-content_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-caption leading-5",
        className,
      )}
      data-mono={mono ? "" : undefined}
      data-slot="facts"
      {...props}
    >
      {children}
    </dl>
  );
}

/** One fact: its label, its value (the children), and what it was where it changes. */
function Fact({
  label,
  was,
  children,
}: {
  readonly label: ReactNode;
  /** The value before the change: struck through before the new one. */
  readonly was?: ReactNode | undefined;
  readonly children: ReactNode;
}) {
  return (
    <div className="contents" data-slot="fact">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="m-0 min-w-0 wrap-anywhere text-foreground in-data-mono:font-mono">
        {was === undefined ? (
          children
        ) : (
          <>
            <del className="text-muted-foreground">{was}</del> →{" "}
            <ins className="font-medium no-underline">{children}</ins>
          </>
        )}
      </dd>
    </div>
  );
}

export { Fact, Facts };
