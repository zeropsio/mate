/**
 * A derivation kept with the data it was derived from. Asked again for the same object and the
 * same other inputs, each by identity, it answers the very object it answered then; anything else
 * derives anew and replaces what that object kept.
 *
 * A component's memo holds one result. The conversation's view is one component for every
 * conversation, so a return to a conversation derived all of it again from data that had not
 * changed, and everything downstream took it for news. What is kept here is held weakly by the
 * source object alone: it lasts as long as the store keeps that data and never longer, so nothing
 * derived outlives its conversation and nothing is kept per conversation ever opened.
 */
export function keptWith<Source extends object, Rest extends ReadonlyArray<unknown>, Value>(
  derive: (source: Source, ...rest: Rest) => Value,
): (source: Source, ...rest: Rest) => Value {
  const kept = new WeakMap<Source, { readonly rest: Rest; readonly value: Value }>();
  return (source, ...rest) => {
    const held = kept.get(source);
    if (
      held !== undefined &&
      held.rest.length === rest.length &&
      held.rest.every((input, index) => Object.is(input, rest[index]))
    )
      return held.value;
    const value = derive(source, ...rest);
    kept.set(source, { rest, value });
    return value;
  };
}
