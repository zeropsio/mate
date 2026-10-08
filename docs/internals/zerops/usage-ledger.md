# Usage terms

**Usage** is consumption reported by completed native turns of agents launched through Mate,
including their child work. The [provider runtime SPI](spi.md) owns that evidence. Transcript size,
context estimates and unrelated terminal activity are not consumption.

A **turn count** counts completed billing turns. **Model participation** counts turns using a
particular model; participation across models overlaps and is not additive.

**Native cost** is the provider's reported charge. **API-equivalent price** is a calculation under
a named pricing policy. A headline charge and model charges are separate views of evidence; never
add them or allocate a charge to a model without source evidence. Missing evidence stays unknown.
