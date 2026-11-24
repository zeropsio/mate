"use client";

import { Input as InputPrimitive } from "@base-ui/react/input";
import type * as React from "react";

import { cn } from "~/lib/utils";

type InputProps = Omit<InputPrimitive.Props & React.RefAttributes<HTMLInputElement>, "size"> & {
  /**
   * `inline`: the field is its line — the line's own type and height, no padding, as wide as its
   * words — drawn as a hairline ring; `unstyled` leaves the typed words alone, the caret the only sign.
   */
  size?: "sm" | "compact" | "default" | "lg" | "xl" | "hero" | "inline" | number;
  /** Monospace with tabular digits, for paths, commands, colors and numbers. */
  font?: "default" | "mono";
  unstyled?: boolean;
  nativeInput?: boolean;
};

/**
 * A password field here always holds a key or a token, never an account's password (sign-in is
 * Zerops'): it is drawn as dots in a text field, so no browser or password manager offers to save it.
 */
const SECRET_FIELD = {
  type: "text",
  autoComplete: "off",
  autoCapitalize: "off",
  autoCorrect: "off",
  spellCheck: false,
  "data-1p-ignore": "",
  "data-lpignore": "true",
  "data-bwignore": "",
  "data-form-type": "other",
  /** Drawn as dots: what a test or a style asks of a hidden secret. */
  "data-secret": "",
} as const;

function Input({
  className,
  size = "default",
  font = "default",
  unstyled = false,
  nativeInput = false,
  ...given
}: InputProps) {
  const secret = given.type === "password";
  const props = secret ? { ...given, ...SECRET_FIELD } : given;
  const inputClassName = cn(
    secret && "[-webkit-text-security:disc]",
    "h-8.5 w-full min-w-0 rounded-[inherit] px-[calc(--spacing(3)-1px)] leading-8.5 outline-none placeholder:text-placeholder sm:h-7.5 sm:leading-7.5 [transition:background-color_5000000s_ease-in-out_0s]",
    // Below 640 even the compact field types at 16 px: a smaller one makes iOS zoom the page.
    size === "compact" &&
      "h-7 px-[calc(--spacing(2.5)-1px)] text-base leading-7 sm:h-7 sm:text-caption sm:leading-7",
    size === "sm" && "h-7.5 px-[calc(--spacing(2.5)-1px)] leading-7.5 sm:h-6.5 sm:leading-6.5",
    size === "lg" && "h-9.5 leading-9.5 sm:h-8.5 sm:leading-8.5",
    // A form that is the page's hero: a large button's height, typed at prose size.
    size === "xl" && "h-10 leading-10 sm:h-10 sm:text-prose sm:leading-10",
    // A page that is this one field: 46 px tall, typed at the emphasis step.
    size === "hero" &&
      "h-11.5 px-[calc(--spacing(4)-1px)] text-emphasis leading-11.5 sm:h-11.5 sm:text-emphasis sm:leading-11.5",
    size === "inline" &&
      "field-sizing-content h-auto min-w-[1ch] px-0 leading-[inherit] [text-align:inherit] sm:h-auto sm:leading-[inherit]",
    props.type === "search" &&
      "[&::-webkit-search-cancel-button]:appearance-none [&::-webkit-search-decoration]:appearance-none [&::-webkit-search-results-button]:appearance-none [&::-webkit-search-results-decoration]:appearance-none",
    // Number fields are typed into; browser spin buttons crowd narrow fields and step by 1.
    props.type === "number" &&
      "[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none",
    props.type === "file" &&
      "text-muted-foreground file:me-3 file:bg-transparent file:font-medium file:text-foreground file:text-body",
  );
  let inputElement: React.ReactElement;

  if (nativeInput) {
    const { style, onValueChange: _onValueChange, ...nativeInputProps } = props;
    const nativeStyle = typeof style === "function" ? undefined : style;

    inputElement = (
      <input
        className={inputClassName}
        data-slot="input"
        size={typeof size === "number" ? size : undefined}
        style={nativeStyle}
        {...(nativeInputProps as React.ComponentProps<"input">)}
      />
    );
  } else {
    inputElement = (
      <InputPrimitive
        className={inputClassName}
        data-slot="input"
        size={typeof size === "number" ? size : undefined}
        {...props}
      />
    );
  }

  return (
    <span
      className={
        cn(
          size === "inline" && "inline-flex max-w-full min-w-0",
          !unstyled &&
            size === "inline" &&
            "rounded-mark bg-background px-0.5 ring-1 ring-ring has-aria-invalid:ring-destructive",
          !unstyled &&
            size !== "inline" &&
            "relative inline-flex w-full rounded-control border border-input bg-field bg-clip-ground text-base text-foreground shadow-xs/5 ring-ring/24 transition-shadow before:pointer-events-none before:absolute before:inset-0 before:rounded-[calc(var(--radius-control)-1px)] not-has-disabled:not-has-focus-visible:not-has-aria-invalid:before:shadow-edge has-focus-visible:has-aria-invalid:border-destructive/64 has-focus-visible:has-aria-invalid:ring-field-invalid has-aria-invalid:border-destructive/36 has-focus-visible:border-ring has-autofill:bg-field-autofill has-disabled:opacity-64 has-[:disabled,:focus-visible,[aria-invalid]]:shadow-none has-focus-visible:ring-[3px] sm:text-sm",
          !unstyled && size === "compact" && "rounded-control",
          font === "mono" && "font-mono tabular-nums",
          className,
        ) || undefined
      }
      data-size={size}
      data-slot="input-control"
    >
      {inputElement}
    </span>
  );
}

export { Input, type InputProps };
