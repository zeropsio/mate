import * as Effect from "effect/Effect";
import * as Clock from "effect/Clock";
import * as Schema from "effect/Schema";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as Duration from "effect/Duration";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { usageDigest } from "@t3tools/shared/agentUsage";
import { Leader } from "./leader.ts";
const json = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
export const USAGE_AUTOMATIC_RATES_URL =
  "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json";
const Price = Schema.Number.check(Schema.isFinite(), Schema.isGreaterThanOrEqualTo(0));
const Rate = Schema.Struct({
  input_cost_per_token: Schema.optionalKey(Price),
  output_cost_per_token: Schema.optionalKey(Price),
  cache_read_input_token_cost: Schema.optionalKey(Price),
  cache_creation_input_token_cost: Schema.optionalKey(Price),
  cache_creation_input_token_cost_above_1hr: Schema.optionalKey(Price),
  provider_specific_entry: Schema.optionalKey(Schema.Struct({ fast: Schema.optionalKey(Price) })),
});
const decodeRate = Schema.decodeUnknownOption(Rate);
import * as Option from "effect/Option";
export interface AutomaticUsageRate {
  readonly model: string;
  readonly pricingBand: string;
  readonly rates: Readonly<Record<string, string | null>>;
}
/** Preserve the published decimal arithmetic until the report's wire/display boundary. */
const decimalParts = (value: number) => {
  const [coefficient, exponent = "0"] = String(value).split("e");
  const [whole, fraction = ""] = coefficient!.split(".");
  let scale = fraction.length - Number(exponent);
  let units = BigInt(whole! + fraction);
  if (scale < 0) {
    units *= 10n ** BigInt(-scale);
    scale = 0;
  }
  return { units, scale };
};
const priceNanos = (rate: number, multiplier: number) => {
  const a = decimalParts(rate),
    b = decimalParts(multiplier);
  const units = String(a.units * b.units * 1000000000n).padStart(a.scale + b.scale + 1, "0");
  const scale = a.scale + b.scale;
  return scale === 0
    ? units
    : `${units.slice(0, -scale)}.${units.slice(-scale)}`.replace(/0+$/u, "").replace(/\.$/u, "");
};
/** Exact published model IDs only. Unsupported modifiers remain unpriced. */
export const automaticUsageRates = (
  document: Readonly<Record<string, unknown>>,
): ReadonlyArray<AutomaticUsageRate> =>
  Object.entries(document).flatMap(([model, value]) => {
    const read = decodeRate(value);
    if (
      Option.isNone(read) ||
      read.value.input_cost_per_token === undefined ||
      read.value.output_cost_per_token === undefined
    )
      return [];
    const rate = read.value;
    const bands: [string, number, number | undefined][] = [
      ["standard", 1, undefined],
      ["cache-5m", 1, rate.cache_creation_input_token_cost],
      ["cache-1h", 1, rate.cache_creation_input_token_cost_above_1hr],
    ];
    if (rate.provider_specific_entry?.fast !== undefined && rate.provider_specific_entry.fast > 0) {
      const fast = rate.provider_specific_entry.fast;
      bands.push(
        ["fast", fast, undefined],
        ["fast-cache-5m", fast, rate.cache_creation_input_token_cost],
        ["fast-cache-1h", fast, rate.cache_creation_input_token_cost_above_1hr],
      );
    }
    return bands.map(([pricingBand, multiple, cacheWrite]) => ({
      model,
      pricingBand,
      rates: {
        uncachedInput: priceNanos(rate.input_cost_per_token!, multiple),
        output: priceNanos(rate.output_cost_per_token!, multiple),
        cachedInput:
          rate.cache_read_input_token_cost === undefined
            ? null
            : priceNanos(rate.cache_read_input_token_cost, multiple),
        cacheCreation: cacheWrite === undefined ? null : priceNanos(cacheWrite, multiple),
      },
    }));
  });
export const installAutomaticUsageRates = Effect.fnUntraced(function* (
  sql: SqlClient.SqlClient,
  leader: Leader["Service"],
  document: Readonly<Record<string, unknown>>,
) {
  const rates = automaticUsageRates(document).toSorted(
    (a, b) => a.model.localeCompare(b.model) || a.pricingBand.localeCompare(b.pricingBand),
  );
  if (rates.length === 0) return false;
  const revision = `automatic-base-v1:${usageDigest(rates)}`;
  return yield* leader.write(
    Effect.gen(function* () {
      yield* sql`SELECT id FROM hq_usage_state WHERE id=1 FOR UPDATE`;
      const [policy] = yield* sql<{
        readonly revision: string;
      }>`SELECT revision FROM hq_usage_price_policy WHERE id=1`;
      if (policy?.revision === revision) return false;
      yield* sql`INSERT INTO hq_usage_price(revision,model,pricing_band,rates,provenance)
      SELECT ${revision},row.model,row."pricingBand",row.rates,${USAGE_AUTOMATIC_RATES_URL} FROM jsonb_to_recordset(${json(rates)}::jsonb) AS row(model text,"pricingBand" text,rates jsonb) ON CONFLICT DO NOTHING`;
      yield* sql`UPDATE hq_usage_price_policy SET revision=${revision} WHERE id=1`;
      yield* sql`UPDATE hq_usage_state SET revision=revision+1 WHERE id=1`;
      return true;
    }),
  );
});
/** One sampled policy per HQ process; a fetch failure retains the last usable PostgreSQL policy. */
export const makeUsagePriceReader = Effect.fnUntraced(function* (
  sql: SqlClient.SqlClient,
  leader: Leader["Service"],
) {
  const http = yield* HttpClient.HttpClient;
  let checked: number | undefined;
  const decode = Schema.decodeUnknownEffect(Schema.Record(Schema.String, Schema.Unknown));
  const ensure = Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    if (checked !== undefined && now - checked < Duration.toMillis(Duration.days(1))) return false;
    checked = now;
    const document = yield* http.get(USAGE_AUTOMATIC_RATES_URL).pipe(
      Effect.flatMap((response) => response.json),
      Effect.flatMap(decode),
      Effect.timeout(Duration.seconds(10)),
    );
    return yield* installAutomaticUsageRates(sql, leader, document);
  }).pipe(Effect.catch(() => Effect.succeed(false)));
  return ensure;
});
