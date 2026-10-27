export async function sampleImageLayout() {
  const scroll = document.querySelector<HTMLElement>(".timeline-legend-list")!;
  const table = scroll.querySelector("table")!;
  const readings: number[][] = [];
  const deliveries: { frame: number; size: number[] }[] = [];
  const observer = new ResizeObserver((entries) => {
    for (const entry of entries)
      if (entry.target === table)
        deliveries.push({
          frame: readings.length,
          size: [entry.contentRect.width, entry.contentRect.height],
        });
  });
  observer.observe(table);
  for (let frame = 0; frame < 120; frame += 1) {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    readings.push([
      scroll.scrollTop,
      scroll.scrollHeight,
      scroll.clientHeight,
      table.getBoundingClientRect().height,
      table.getBoundingClientRect().width,
      table.parentElement!.clientWidth,
      ...[...table.querySelectorAll("td")].map((cell) => cell.getBoundingClientRect().width),
    ]);
  }
  observer.disconnect();
  // Resize deliveries are sparse events. Placement and decode transitions do not belong
  // to the final thirty-frame stability window, even if there were only two deliveries.
  const settledFrom = readings.length - 30;
  return {
    readings: readings.slice(settledFrom),
    deliveries: deliveries
      .filter((delivery) => delivery.frame > settledFrom)
      .map((delivery) => delivery.size),
  };
}
