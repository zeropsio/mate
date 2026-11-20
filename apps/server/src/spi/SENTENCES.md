next: SP3

- SP1 — A tool item the bus recognizes reaches its subscribers with the tool call's name and result text added, and every other event reaches them unaltered, in the order the provider published them
- SP2 — A tool item whose data the bus cannot read still reaches its subscribers, without a tool call, and every occurrence is reported on the enrichment-failure stream with its event id, provider and item type
