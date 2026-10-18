import { expect, it } from "vite-plus/test";

import { serviceRowReading } from "./placeServices.logic";

it("production's services list scales: six services, no empty meters for storage", () => {
  const services = [
    { type: "nodejs@22", typeShort: "Node.js 22" },
    { type: "nodejs@22", typeShort: "Node.js 22" },
    { type: "postgresql@16", typeShort: "PostgreSQL 16" },
    { type: "valkey@7.2", typeShort: "Valkey 7" },
    { type: "objectstorage", typeShort: "Object storage" },
    { type: "sharedstorage", typeShort: undefined },
  ];
  expect(services.map(serviceRowReading)).toEqual([
    { kind: "meters" },
    { kind: "meters" },
    { kind: "meters" },
    { kind: "meters" },
    { kind: "storage", words: "Object storage" },
    { kind: "storage", words: "Storage" },
  ]);
});
