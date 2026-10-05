/**
 * Recorded Zerops realtime traffic for one organization's running work: the owner PAT's frames
 * and registration answers of the probe run `20261005T184903Z` (`klient/probe-org3`), in arrival
 * order. A project was created (one create, one service create, one deploy) and deleted.
 *
 * Process rows are cut to the fields the process family reads. The probe recorded rows without `_version`;
 * each row here carries a synthesized `_version` that counts that process's observations in arrival
 * order, as the platform's rising `_version` would.
 */
export type RecordedProcessEvent =
  | {
      readonly at: string;
      readonly frame: "membership";
      readonly data: {
        readonly add: ReadonlyArray<string>;
        readonly delete: ReadonlyArray<string>;
      };
    }
  | {
      readonly at: string;
      readonly frame: "updates";
      readonly data: { readonly update: ReadonlyArray<Readonly<Record<string, unknown>>> };
    }
  | {
      readonly at: string;
      readonly baseline: string;
      readonly items: ReadonlyArray<Readonly<Record<string, unknown>>>;
    };

export const ORGANIZATION_ID = "BkC8AGjFQMyFrLbzjHoE9g";
export const PROBE_PROJECT_ID = "x7DxkVcBR4Wnb1Cc9rnSHw";

export const RECORDED_PROCESS_TRAFFIC: ReadonlyArray<RecordedProcessEvent> = [
  {
    at: "2026-10-05T18:49:04.737Z",
    baseline: "initial",
    items: [],
  },
  {
    at: "2026-10-05T18:49:09.428Z",
    frame: "updates",
    data: {
      update: [
        {
          id: "J3TU3gE0SvCFrPDutSacqw",
          clientId: "BkC8AGjFQMyFrLbzjHoE9g",
          projectId: "x7DxkVcBR4Wnb1Cc9rnSHw",
          status: "RUNNING",
          actionName: "project.create",
          created: "2026-10-05T18:49:08.065Z",
          started: "2026-10-05T18:49:08.143Z",
          finished: null,
          _version: 1,
        },
        {
          id: "8OBjlA8pQbuaDGH7nYvggg",
          clientId: "BkC8AGjFQMyFrLbzjHoE9g",
          projectId: "x7DxkVcBR4Wnb1Cc9rnSHw",
          status: "PENDING",
          actionName: "stack.create",
          created: "2026-10-05T18:49:08.097Z",
          started: null,
          finished: null,
          _version: 1,
        },
        {
          id: "K1bQIB8AQBeQGHaAe8mneg",
          clientId: "BkC8AGjFQMyFrLbzjHoE9g",
          projectId: "x7DxkVcBR4Wnb1Cc9rnSHw",
          status: "PENDING",
          actionName: "stack.deploy",
          created: "2026-10-05T18:49:08.118Z",
          started: null,
          finished: null,
          _version: 1,
        },
      ],
    },
  },
  {
    at: "2026-10-05T18:49:09.484Z",
    baseline: "during-running",
    items: [
      {
        id: "J3TU3gE0SvCFrPDutSacqw",
        clientId: "BkC8AGjFQMyFrLbzjHoE9g",
        projectId: "x7DxkVcBR4Wnb1Cc9rnSHw",
        status: "RUNNING",
        actionName: "project.create",
        created: "2026-10-05T18:49:08.065Z",
        started: "2026-10-05T18:49:08.143Z",
        finished: null,
        _version: 2,
      },
      {
        id: "8OBjlA8pQbuaDGH7nYvggg",
        clientId: "BkC8AGjFQMyFrLbzjHoE9g",
        projectId: "x7DxkVcBR4Wnb1Cc9rnSHw",
        status: "PENDING",
        actionName: "stack.create",
        created: "2026-10-05T18:49:08.097Z",
        started: null,
        finished: null,
        _version: 2,
      },
      {
        id: "K1bQIB8AQBeQGHaAe8mneg",
        clientId: "BkC8AGjFQMyFrLbzjHoE9g",
        projectId: "x7DxkVcBR4Wnb1Cc9rnSHw",
        status: "PENDING",
        actionName: "stack.deploy",
        created: "2026-10-05T18:49:08.118Z",
        started: null,
        finished: null,
        _version: 2,
      },
    ],
  },
  {
    at: "2026-10-05T18:49:09.570Z",
    frame: "membership",
    data: {
      add: ["J3TU3gE0SvCFrPDutSacqw", "8OBjlA8pQbuaDGH7nYvggg", "K1bQIB8AQBeQGHaAe8mneg"],
      delete: [],
    },
  },
  {
    at: "2026-10-05T18:49:10.948Z",
    frame: "updates",
    data: {
      update: [
        {
          id: "J3TU3gE0SvCFrPDutSacqw",
          clientId: "BkC8AGjFQMyFrLbzjHoE9g",
          projectId: "x7DxkVcBR4Wnb1Cc9rnSHw",
          status: "RUNNING",
          actionName: "project.create",
          created: "2026-10-05T18:49:08.065Z",
          started: "2026-10-05T18:49:08.143Z",
          finished: null,
          _version: 3,
        },
      ],
    },
  },
  {
    at: "2026-10-05T18:49:11.795Z",
    frame: "updates",
    data: {
      update: [
        {
          id: "J3TU3gE0SvCFrPDutSacqw",
          clientId: "BkC8AGjFQMyFrLbzjHoE9g",
          projectId: "x7DxkVcBR4Wnb1Cc9rnSHw",
          status: "RUNNING",
          actionName: "project.create",
          created: "2026-10-05T18:49:08.065Z",
          started: "2026-10-05T18:49:08.143Z",
          finished: null,
          _version: 4,
        },
      ],
    },
  },
  {
    at: "2026-10-05T18:49:15.632Z",
    frame: "updates",
    data: {
      update: [
        {
          id: "J3TU3gE0SvCFrPDutSacqw",
          clientId: "BkC8AGjFQMyFrLbzjHoE9g",
          projectId: "x7DxkVcBR4Wnb1Cc9rnSHw",
          status: "RUNNING",
          actionName: "project.create",
          created: "2026-10-05T18:49:08.065Z",
          started: "2026-10-05T18:49:08.143Z",
          finished: null,
          _version: 5,
        },
      ],
    },
  },
  {
    at: "2026-10-05T18:49:17.589Z",
    frame: "updates",
    data: {
      update: [
        {
          id: "J3TU3gE0SvCFrPDutSacqw",
          clientId: "BkC8AGjFQMyFrLbzjHoE9g",
          projectId: "x7DxkVcBR4Wnb1Cc9rnSHw",
          status: "RUNNING",
          actionName: "project.create",
          created: "2026-10-05T18:49:08.065Z",
          started: "2026-10-05T18:49:08.143Z",
          finished: null,
          _version: 6,
        },
      ],
    },
  },
  {
    at: "2026-10-05T18:49:20.632Z",
    frame: "updates",
    data: {
      update: [
        {
          id: "J3TU3gE0SvCFrPDutSacqw",
          clientId: "BkC8AGjFQMyFrLbzjHoE9g",
          projectId: "x7DxkVcBR4Wnb1Cc9rnSHw",
          status: "RUNNING",
          actionName: "project.create",
          created: "2026-10-05T18:49:08.065Z",
          started: "2026-10-05T18:49:08.143Z",
          finished: null,
          _version: 7,
        },
      ],
    },
  },
  {
    at: "2026-10-05T18:49:35.637Z",
    frame: "updates",
    data: {
      update: [
        {
          id: "J3TU3gE0SvCFrPDutSacqw",
          clientId: "BkC8AGjFQMyFrLbzjHoE9g",
          projectId: "x7DxkVcBR4Wnb1Cc9rnSHw",
          status: "RUNNING",
          actionName: "project.create",
          created: "2026-10-05T18:49:08.065Z",
          started: "2026-10-05T18:49:08.143Z",
          finished: null,
          _version: 8,
        },
      ],
    },
  },
  {
    at: "2026-10-05T18:49:36.777Z",
    frame: "updates",
    data: {
      update: [
        {
          id: "J3TU3gE0SvCFrPDutSacqw",
          clientId: "BkC8AGjFQMyFrLbzjHoE9g",
          projectId: "x7DxkVcBR4Wnb1Cc9rnSHw",
          status: "FINISHED",
          actionName: "project.create",
          created: "2026-10-05T18:49:08.065Z",
          started: "2026-10-05T18:49:08.143Z",
          finished: "2026-10-05T18:49:35.706Z",
          _version: 9,
        },
        {
          id: "8OBjlA8pQbuaDGH7nYvggg",
          clientId: "BkC8AGjFQMyFrLbzjHoE9g",
          projectId: "x7DxkVcBR4Wnb1Cc9rnSHw",
          status: "FINISHED",
          actionName: "stack.create",
          created: "2026-10-05T18:49:08.097Z",
          started: "2026-10-05T18:49:35.73Z",
          finished: "2026-10-05T18:49:35.842Z",
          _version: 3,
        },
        {
          id: "K1bQIB8AQBeQGHaAe8mneg",
          clientId: "BkC8AGjFQMyFrLbzjHoE9g",
          projectId: "x7DxkVcBR4Wnb1Cc9rnSHw",
          status: "RUNNING",
          actionName: "stack.deploy",
          created: "2026-10-05T18:49:08.118Z",
          started: "2026-10-05T18:49:35.865Z",
          finished: null,
          _version: 3,
        },
      ],
    },
  },
  {
    at: "2026-10-05T18:49:36.845Z",
    frame: "membership",
    data: {
      add: [],
      delete: ["8OBjlA8pQbuaDGH7nYvggg", "J3TU3gE0SvCFrPDutSacqw"],
    },
  },
  {
    at: "2026-10-05T18:49:47.666Z",
    frame: "membership",
    data: {
      add: [],
      delete: ["K1bQIB8AQBeQGHaAe8mneg"],
    },
  },
  {
    at: "2026-10-05T18:49:47.948Z",
    frame: "updates",
    data: {
      update: [
        {
          id: "K1bQIB8AQBeQGHaAe8mneg",
          clientId: "BkC8AGjFQMyFrLbzjHoE9g",
          projectId: "x7DxkVcBR4Wnb1Cc9rnSHw",
          status: "FINISHED",
          actionName: "stack.deploy",
          created: "2026-10-05T18:49:08.118Z",
          started: "2026-10-05T18:49:35.865Z",
          finished: "2026-10-05T18:49:46.642Z",
          _version: 4,
        },
      ],
    },
  },
  {
    at: "2026-10-05T18:49:48.011Z",
    baseline: "after-finish",
    items: [],
  },
  {
    at: "2026-10-05T18:49:50.649Z",
    frame: "membership",
    data: {
      add: ["OOlnYMslSg6Hjbgt9ZKlFQ"],
      delete: [],
    },
  },
  {
    at: "2026-10-05T18:49:53.574Z",
    frame: "updates",
    data: {
      update: [
        {
          id: "OOlnYMslSg6Hjbgt9ZKlFQ",
          clientId: "BkC8AGjFQMyFrLbzjHoE9g",
          projectId: "x7DxkVcBR4Wnb1Cc9rnSHw",
          status: "RUNNING",
          actionName: "project.delete",
          created: "2026-10-05T18:49:49.66Z",
          started: "2026-10-05T18:49:49.683Z",
          finished: null,
          _version: 1,
        },
      ],
    },
  },
  {
    at: "2026-10-05T18:50:03.869Z",
    frame: "membership",
    data: {
      add: [],
      delete: ["OOlnYMslSg6Hjbgt9ZKlFQ"],
    },
  },
  {
    at: "2026-10-05T18:50:03.910Z",
    frame: "updates",
    data: {
      update: [
        {
          id: "OOlnYMslSg6Hjbgt9ZKlFQ",
          clientId: "BkC8AGjFQMyFrLbzjHoE9g",
          projectId: "x7DxkVcBR4Wnb1Cc9rnSHw",
          status: "FINISHED",
          actionName: "project.delete",
          created: "2026-10-05T18:49:49.66Z",
          started: "2026-10-05T18:49:49.683Z",
          finished: "2026-10-05T18:50:03.073Z",
          _version: 2,
        },
      ],
    },
  },
];
