import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

/** Decode each independent fact; an unreadable sibling cannot discard a record. */
export function navigationRecord<F extends Schema.Struct.Fields>(fields: F) {
  const unknownable = <S extends Schema.Constraint>(field: S) =>
    Schema.optionalKey(
      Schema.Union([field, Schema.Undefined]).pipe(
        Schema.catchDecoding(() => Effect.succeedSome(undefined)),
      ),
    );
  const tolerant = Object.fromEntries(
    Object.entries(fields).map(([key, field]) => [key, unknownable(field)]),
  ) as { readonly [K in keyof F]: ReturnType<typeof unknownable<F[K]>> };
  return Schema.Struct(tolerant);
}
