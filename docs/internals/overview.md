# Execution boundaries

The environment owns execution: provider processes, terminals, Git and filesystem access.
Clients express intent and render projected facts.

Remote facts follow the [client data layer](zerops/data-layer.md).
Provider boundaries follow the [runtime SPI](zerops/spi.md).
Server capabilities follow the [service rules](effect-services.md).
