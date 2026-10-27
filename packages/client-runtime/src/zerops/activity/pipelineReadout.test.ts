// @effect-diagnostics globalDate:off -- fixture timestamps are offsets from a fixed instant, not wall-clock reads.
import { describe, expect, it } from "vite-plus/test";

import type { ActivityAppVersion } from "./dto.ts";
import {
  type PipelineReadout,
  type ReadPipelineOptions,
  displayVersionName,
  formatDuration,
  pipelineStepSentence,
  readPipeline,
} from "./pipelineReadout.ts";

const BASE_MS = Date.parse("2026-09-26T10:00:00.000Z");
/** The instant `seconds` after the fixtures' base, as the API writes it. */
const at = (seconds: number): string => new Date(BASE_MS + seconds * 1_000).toISOString();
const NAMED: Omit<ReadPipelineOptions, "nowMs"> = {
  serviceName: "appstage",
  serviceType: "Node.js",
};
const read = (
  appVersion: ActivityAppVersion,
  nowSeconds: number,
  options: Omit<ReadPipelineOptions, "nowMs"> = NAMED,
): PipelineReadout => readPipeline(appVersion, { ...options, nowMs: BASE_MS + nowSeconds * 1_000 });
/** A step as the readout lists it; the durations in seconds for legibility. */
const step = (
  id: string,
  state: string,
  sentence: string,
  timing: { readonly from?: number; readonly to?: number; readonly seconds?: number } = {},
) => ({
  id,
  state,
  sentence,
  ...(timing.from === undefined ? {} : { startedAt: at(timing.from) }),
  ...(timing.to === undefined ? {} : { endedAt: at(timing.to) }),
  ...(timing.seconds === undefined ? {} : { durationMs: timing.seconds * 1_000 }),
});
/** The readout without step labels, which `the short nouns` pins on its own. */
const shape = (readout: PipelineReadout) => ({
  ...readout,
  steps: readout.steps.map(({ label: _label, ...rest }) => rest),
});

const NAME = "3f2a9c1d8e7b6a5f4e3d2c1b0a9f8e7d6c5b4a39";
const BUILT = { pipelineStart: at(5), startDate: at(13), endDate: at(74) };

describe("readPipeline — every getPipelineState branch, as the Zerops GUI reads it", () => {
  it.each([
    {
      name: "waiting to build: the steps are still being calculated from zerops.yml",
      appVersion: { name: NAME, status: "WAITING_TO_BUILD", build: {} },
      now: 3,
      expected: {
        status: { tone: "waiting", word: "Waiting to run" },
        calculating: true,
        steps: [],
      },
    },
    {
      name: "the build container starting",
      appVersion: { name: NAME, status: "BUILDING", build: { pipelineStart: at(5) } },
      now: 35,
      expected: {
        status: { tone: "running", word: "Running" },
        calculating: false,
        overall: { label: "Running for", durationMs: 30_000 },
        currentStepId: "INIT_BUILD_CONTAINER",
        steps: [
          step("INIT_BUILD_CONTAINER", "running", "Initializing build container", {
            from: 5,
            seconds: 30,
          }),
          step("RUN_BUILD_COMMANDS", "waiting", "Run build commands from zerops.yml"),
          step(
            "DEPLOY",
            "waiting",
            "Create app version 3f2a9c1 and upgrade Node.js service appstage",
          ),
        ],
      },
    },
    {
      name: "a started pipeline still reading WAITING_TO_BUILD reads as the build container starting",
      appVersion: { name: NAME, status: "WAITING_TO_BUILD", build: { pipelineStart: at(5) } },
      now: 35,
      expected: {
        status: { tone: "running", word: "Running" },
        calculating: false,
        overall: { label: "Running for", durationMs: 30_000 },
        currentStepId: "INIT_BUILD_CONTAINER",
        steps: [
          step("INIT_BUILD_CONTAINER", "running", "Initializing build container", {
            from: 5,
            seconds: 30,
          }),
          step("RUN_BUILD_COMMANDS", "waiting", "Run build commands from zerops.yml"),
          step(
            "DEPLOY",
            "waiting",
            "Create app version 3f2a9c1 and upgrade Node.js service appstage",
          ),
        ],
      },
    },
    {
      name: "cancelled before the build commands started: every step cancelled",
      appVersion: {
        name: NAME,
        status: "CANCELLED",
        build: { pipelineStart: at(5), pipelineFailed: at(20) },
      },
      now: 600,
      expected: {
        status: { tone: "cancelled", word: "Cancelled" },
        calculating: false,
        overall: { label: "Cancelled after", durationMs: 15_000, endedAt: at(20) },
        steps: [
          step(
            "INIT_BUILD_CONTAINER",
            "cancelled",
            "Cancelled while creating build container, please try again",
            { from: 5, to: 20, seconds: 15 },
          ),
          step(
            "RUN_BUILD_COMMANDS",
            "cancelled",
            "Couldn't start build container, build step cancelled",
          ),
          step(
            "DEPLOY",
            "cancelled",
            "Cancelled app version 3f2a9c1 creation and deploy to appstage (Node.js)",
          ),
        ],
      },
    },
    {
      name: "the build commands running",
      appVersion: {
        name: NAME,
        status: "BUILDING",
        build: { pipelineStart: at(5), startDate: at(13) },
      },
      now: 74,
      expected: {
        status: { tone: "running", word: "Running" },
        calculating: false,
        overall: { label: "Running for", durationMs: 69_000 },
        currentStepId: "RUN_BUILD_COMMANDS",
        steps: [
          step("INIT_BUILD_CONTAINER", "finished", "Initialized build container", {
            from: 5,
            to: 13,
            seconds: 8,
          }),
          step("RUN_BUILD_COMMANDS", "running", "Running build commands from zerops.yml", {
            from: 13,
            seconds: 61,
          }),
          step(
            "DEPLOY",
            "waiting",
            "Create app version 3f2a9c1 and upgrade Node.js service appstage",
          ),
        ],
      },
    },
    {
      name: "the prepare container starting once the build ended",
      appVersion: { name: NAME, status: "BUILDING", build: BUILT, prepareCustomRuntime: {} },
      now: 80,
      expected: {
        status: { tone: "running", word: "Running" },
        calculating: false,
        overall: { label: "Running for", durationMs: 75_000 },
        currentStepId: "INIT_PREPARE_CONTAINER",
        steps: [
          step("INIT_BUILD_CONTAINER", "finished", "Initialized build container", {
            from: 5,
            to: 13,
            seconds: 8,
          }),
          step(
            "RUN_BUILD_COMMANDS",
            "finished",
            "Build commands from zerops.yml ran successfully",
            { from: 13, to: 74, seconds: 61 },
          ),
          step("INIT_PREPARE_CONTAINER", "running", "Initializing runtime prepare container", {
            from: 74,
            seconds: 6,
          }),
          step("RUN_PREPARE_COMMANDS", "waiting", "Run runtime prepare commands from zerops.yml"),
          step(
            "DEPLOY",
            "waiting",
            "Create app version 3f2a9c1 and upgrade Node.js service appstage",
          ),
        ],
      },
    },
    {
      name: "a build that ended without a prepare: the waiting deploy counts from the build's end",
      appVersion: { name: NAME, status: "BUILDING", build: BUILT },
      now: 80,
      expected: {
        status: { tone: "running", word: "Running" },
        calculating: false,
        overall: { label: "Running for", durationMs: 75_000 },
        steps: [
          step("INIT_BUILD_CONTAINER", "finished", "Initialized build container", {
            from: 5,
            to: 13,
            seconds: 8,
          }),
          step(
            "RUN_BUILD_COMMANDS",
            "finished",
            "Build commands from zerops.yml ran successfully",
            { from: 13, to: 74, seconds: 61 },
          ),
          step(
            "DEPLOY",
            "waiting",
            "Create app version 3f2a9c1 and upgrade Node.js service appstage",
            { from: 74, seconds: 6 },
          ),
        ],
      },
    },
    {
      name: "the prepare commands running (the GUI's word is Finished: it never counts them as running)",
      appVersion: {
        name: NAME,
        status: "PREPARING_RUNTIME",
        build: BUILT,
        prepareCustomRuntime: { startDate: at(90) },
      },
      now: 120,
      expected: {
        status: { tone: "finished", word: "Finished" },
        calculating: false,
        overall: { label: "Running for", durationMs: 115_000 },
        currentStepId: "RUN_PREPARE_COMMANDS",
        steps: [
          step("INIT_BUILD_CONTAINER", "finished", "Initialized build container", {
            from: 5,
            to: 13,
            seconds: 8,
          }),
          step(
            "RUN_BUILD_COMMANDS",
            "finished",
            "Build commands from zerops.yml ran successfully",
            { from: 13, to: 74, seconds: 61 },
          ),
          step("INIT_PREPARE_CONTAINER", "finished", "Initialized runtime prepare container", {
            from: 74,
            to: 90,
            seconds: 16,
          }),
          step(
            "RUN_PREPARE_COMMANDS",
            "running",
            "Running runtime prepare commands from zerops.yml",
            { from: 90, seconds: 30 },
          ),
          step(
            "DEPLOY",
            "waiting",
            "Create app version 3f2a9c1 and upgrade Node.js service appstage",
          ),
        ],
      },
    },
    {
      name: "the prepare commands done, the deploy not begun",
      appVersion: {
        name: NAME,
        status: "PREPARING_RUNTIME",
        build: BUILT,
        prepareCustomRuntime: { startDate: at(90), endDate: at(150) },
      },
      now: 155,
      expected: {
        status: { tone: "finished", word: "Finished" },
        calculating: false,
        overall: { label: "Running for", durationMs: 150_000 },
        steps: [
          step("INIT_BUILD_CONTAINER", "finished", "Initialized build container", {
            from: 5,
            to: 13,
            seconds: 8,
          }),
          step(
            "RUN_BUILD_COMMANDS",
            "finished",
            "Build commands from zerops.yml ran successfully",
            { from: 13, to: 74, seconds: 61 },
          ),
          step("INIT_PREPARE_CONTAINER", "finished", "Initialized runtime prepare container", {
            from: 74,
            to: 90,
            seconds: 16,
          }),
          step(
            "RUN_PREPARE_COMMANDS",
            "finished",
            "Runtime prepare commands from zerops.yml ran successfully",
            { from: 90, to: 150, seconds: 60 },
          ),
          step(
            "DEPLOY",
            "waiting",
            "Create app version 3f2a9c1 and upgrade Node.js service appstage",
            { from: 150, seconds: 5 },
          ),
        ],
      },
    },
    {
      name: "waiting to deploy after a build (the GUI's word is Finished)",
      appVersion: { name: NAME, status: "WAITING_TO_DEPLOY", build: BUILT },
      now: 80,
      expected: {
        status: { tone: "finished", word: "Finished" },
        calculating: false,
        overall: { label: "Running for", durationMs: 75_000 },
        steps: [
          step("INIT_BUILD_CONTAINER", "finished", "Initialized build container", {
            from: 5,
            to: 13,
            seconds: 8,
          }),
          step(
            "RUN_BUILD_COMMANDS",
            "finished",
            "Build commands from zerops.yml ran successfully",
            { from: 13, to: 74, seconds: 61 },
          ),
          step(
            "DEPLOY",
            "waiting",
            "Create app version 3f2a9c1 and upgrade Node.js service appstage",
            { from: 74, seconds: 6 },
          ),
        ],
      },
    },
    {
      name: "a deploy-only pipeline waiting to deploy: its one step counts from the action's start",
      appVersion: { name: NAME, status: "WAITING_TO_DEPLOY" },
      now: 10,
      options: { ...NAMED, actionStartedAt: at(2) },
      expected: {
        status: { tone: "waiting", word: "Waiting to run" },
        calculating: false,
        steps: [
          step(
            "DEPLOY",
            "waiting",
            "Create app version 3f2a9c1 and upgrade Node.js service appstage",
            { from: 2, seconds: 8 },
          ),
        ],
      },
    },
    {
      name: "deploying after a build",
      appVersion: { name: NAME, status: "DEPLOYING", build: BUILT },
      now: 90,
      expected: {
        status: { tone: "running", word: "Running" },
        calculating: false,
        overall: { label: "Running for", durationMs: 85_000 },
        currentStepId: "DEPLOY",
        steps: [
          step("INIT_BUILD_CONTAINER", "finished", "Initialized build container", {
            from: 5,
            to: 13,
            seconds: 8,
          }),
          step(
            "RUN_BUILD_COMMANDS",
            "finished",
            "Build commands from zerops.yml ran successfully",
            { from: 13, to: 74, seconds: 61 },
          ),
          step(
            "DEPLOY",
            "running",
            "Creating app version 3f2a9c1 and upgrading Node.js service appstage",
            { from: 74, seconds: 16 },
          ),
        ],
      },
    },
    {
      name: "deploying after a prepare: the deploy starts at the prepare's end",
      appVersion: {
        name: NAME,
        status: "DEPLOYING",
        build: BUILT,
        prepareCustomRuntime: { startDate: at(90), endDate: at(150) },
      },
      now: 160,
      expected: {
        status: { tone: "running", word: "Running" },
        calculating: false,
        overall: { label: "Running for", durationMs: 155_000 },
        currentStepId: "DEPLOY",
        steps: [
          step("INIT_BUILD_CONTAINER", "finished", "Initialized build container", {
            from: 5,
            to: 13,
            seconds: 8,
          }),
          step(
            "RUN_BUILD_COMMANDS",
            "finished",
            "Build commands from zerops.yml ran successfully",
            { from: 13, to: 74, seconds: 61 },
          ),
          step("INIT_PREPARE_CONTAINER", "finished", "Initialized runtime prepare container", {
            from: 74,
            to: 90,
            seconds: 16,
          }),
          step(
            "RUN_PREPARE_COMMANDS",
            "finished",
            "Runtime prepare commands from zerops.yml ran successfully",
            { from: 90, to: 150, seconds: 60 },
          ),
          step(
            "DEPLOY",
            "running",
            "Creating app version 3f2a9c1 and upgrading Node.js service appstage",
            { from: 150, seconds: 10 },
          ),
        ],
      },
    },
    {
      name: "a deploy-only pipeline deploying: no overall line, the step from the action's start",
      appVersion: { name: NAME, status: "DEPLOYING" },
      now: 30,
      options: { ...NAMED, actionStartedAt: at(2) },
      expected: {
        status: { tone: "running", word: "Running" },
        calculating: false,
        currentStepId: "DEPLOY",
        steps: [
          step(
            "DEPLOY",
            "running",
            "Creating app version 3f2a9c1 and upgrading Node.js service appstage",
            { from: 2, seconds: 28 },
          ),
        ],
      },
    },
    {
      name: "activating (the GUI has no sentence for it and reads Finished; the running sentence stands)",
      appVersion: { name: NAME, status: "DEPLOYING", build: BUILT, activationDate: at(95) },
      now: 100,
      expected: {
        status: { tone: "finished", word: "Finished" },
        calculating: false,
        overall: { label: "Running for", durationMs: 95_000 },
        currentStepId: "DEPLOY",
        steps: [
          step("INIT_BUILD_CONTAINER", "finished", "Initialized build container", {
            from: 5,
            to: 13,
            seconds: 8,
          }),
          step(
            "RUN_BUILD_COMMANDS",
            "finished",
            "Build commands from zerops.yml ran successfully",
            { from: 13, to: 74, seconds: 61 },
          ),
          step(
            "DEPLOY",
            "activating",
            "Creating app version 3f2a9c1 and upgrading Node.js service appstage",
            { from: 74, to: 95, seconds: 21 },
          ),
        ],
      },
    },
    {
      name: "the build container failed: every later step cancelled",
      appVersion: {
        name: NAME,
        status: "BUILD_FAILED",
        build: { pipelineStart: at(5), pipelineFailed: at(30) },
      },
      now: 600,
      expected: {
        status: { tone: "failed", word: "Failed" },
        calculating: false,
        overall: { label: "Failed after", durationMs: 25_000, endedAt: at(30) },
        currentStepId: "INIT_BUILD_CONTAINER",
        steps: [
          step(
            "INIT_BUILD_CONTAINER",
            "failed",
            "Failed while creating build container, please try again",
            { from: 5, to: 30, seconds: 25 },
          ),
          step(
            "RUN_BUILD_COMMANDS",
            "cancelled",
            "Couldn't start build container, build step cancelled",
          ),
          step(
            "DEPLOY",
            "cancelled",
            "Cancelled app version 3f2a9c1 creation and deploy to appstage (Node.js)",
          ),
        ],
      },
    },
    {
      name: "the build commands failed before a prepare: the prepare's init keeps no duration",
      appVersion: {
        name: NAME,
        status: "BUILD_FAILED",
        build: { pipelineStart: at(5), startDate: at(13), pipelineFailed: at(70) },
        prepareCustomRuntime: {},
      },
      now: 600,
      expected: {
        status: { tone: "failed", word: "Failed" },
        calculating: false,
        overall: { label: "Failed after", durationMs: 65_000, endedAt: at(70) },
        currentStepId: "RUN_BUILD_COMMANDS",
        steps: [
          step("INIT_BUILD_CONTAINER", "finished", "Initialized build container", {
            from: 5,
            to: 13,
            seconds: 8,
          }),
          step("RUN_BUILD_COMMANDS", "failed", "Build commands from zerops.yml failed", {
            from: 13,
            to: 70,
            seconds: 57,
          }),
          step(
            "INIT_PREPARE_CONTAINER",
            "cancelled",
            "Cancelled initialization of runtime prepare container",
          ),
          step(
            "RUN_PREPARE_COMMANDS",
            "cancelled",
            "Couldn't start runtime prepare container, prepare step cancelled",
          ),
          step(
            "DEPLOY",
            "cancelled",
            "Cancelled app version 3f2a9c1 creation and deploy to appstage (Node.js)",
          ),
        ],
      },
    },
    {
      name: "the prepare container failed (the GUI runs the build's duration to the failure)",
      appVersion: {
        name: NAME,
        status: "PREPARING_RUNTIME_FAILED",
        build: { ...BUILT, pipelineFailed: at(90) },
        prepareCustomRuntime: {},
      },
      now: 600,
      expected: {
        status: { tone: "failed", word: "Failed" },
        calculating: false,
        overall: { label: "Failed after", durationMs: 85_000, endedAt: at(90) },
        currentStepId: "INIT_PREPARE_CONTAINER",
        steps: [
          step("INIT_BUILD_CONTAINER", "finished", "Initialized build container", {
            from: 5,
            to: 13,
            seconds: 8,
          }),
          step(
            "RUN_BUILD_COMMANDS",
            "finished",
            "Build commands from zerops.yml ran successfully",
            { from: 13, to: 90, seconds: 77 },
          ),
          step(
            "INIT_PREPARE_CONTAINER",
            "failed",
            "Failed while creating runtime prepare container, please try again",
            { from: 74, to: 90, seconds: 16 },
          ),
          step(
            "RUN_PREPARE_COMMANDS",
            "cancelled",
            "Couldn't start runtime prepare container, prepare step cancelled",
          ),
          step(
            "DEPLOY",
            "cancelled",
            "Cancelled app version 3f2a9c1 creation and deploy to appstage (Node.js)",
          ),
        ],
      },
    },
    {
      name: "the prepare commands failed (the GUI runs the earlier durations to the failure)",
      appVersion: {
        name: NAME,
        status: "PREPARING_RUNTIME_FAILED",
        build: { ...BUILT, pipelineFailed: at(150) },
        prepareCustomRuntime: { startDate: at(90), endDate: at(150) },
      },
      now: 600,
      expected: {
        status: { tone: "failed", word: "Failed" },
        calculating: false,
        overall: { label: "Failed after", durationMs: 145_000, endedAt: at(150) },
        currentStepId: "RUN_PREPARE_COMMANDS",
        steps: [
          step("INIT_BUILD_CONTAINER", "finished", "Initialized build container", {
            from: 5,
            to: 13,
            seconds: 8,
          }),
          step(
            "RUN_BUILD_COMMANDS",
            "finished",
            "Build commands from zerops.yml ran successfully",
            { from: 13, to: 150, seconds: 137 },
          ),
          step("INIT_PREPARE_CONTAINER", "finished", "Initialized runtime prepare container", {
            from: 74,
            to: 150,
            seconds: 76,
          }),
          step(
            "RUN_PREPARE_COMMANDS",
            "failed",
            "Runtime prepare commands from zerops.yml failed",
            { from: 90, to: 150, seconds: 60 },
          ),
          step(
            "DEPLOY",
            "cancelled",
            "Cancelled app version 3f2a9c1 creation and deploy to appstage (Node.js)",
            { from: 150, to: 150, seconds: 0 },
          ),
        ],
      },
    },
    {
      name: "a build-less prepare failed: measured from the prepare container's creation start",
      appVersion: {
        name: NAME,
        status: "PREPARING_RUNTIME_FAILED",
        prepareCustomRuntime: {
          containerCreationStart: at(3),
          startDate: at(20),
          endDate: at(60),
        },
      },
      now: 600,
      expected: {
        status: { tone: "failed", word: "Failed" },
        calculating: false,
        overall: { label: "Failed after", durationMs: 57_000, endedAt: at(60) },
        currentStepId: "RUN_PREPARE_COMMANDS",
        steps: [
          step("INIT_PREPARE_CONTAINER", "finished", "Initialized runtime prepare container", {
            from: 3,
            to: 20,
            seconds: 17,
          }),
          step(
            "RUN_PREPARE_COMMANDS",
            "failed",
            "Runtime prepare commands from zerops.yml failed",
            { from: 20, to: 60, seconds: 40 },
          ),
          step(
            "DEPLOY",
            "cancelled",
            "Cancelled app version 3f2a9c1 creation and deploy to appstage (Node.js)",
            { from: 60, seconds: 540 },
          ),
        ],
      },
    },
    {
      name: "a build-less prepare container that failed before its commands: the failure still counts up",
      appVersion: {
        name: NAME,
        status: "PREPARING_RUNTIME_FAILED",
        prepareCustomRuntime: { containerCreationStart: at(3) },
      },
      now: 600,
      expected: {
        status: { tone: "failed", word: "Failed" },
        calculating: false,
        overall: { label: "Failed after", durationMs: 597_000 },
        currentStepId: "INIT_PREPARE_CONTAINER",
        steps: [
          step(
            "INIT_PREPARE_CONTAINER",
            "failed",
            "Failed while creating runtime prepare container, please try again",
            { from: 3, seconds: 597 },
          ),
          step(
            "RUN_PREPARE_COMMANDS",
            "cancelled",
            "Couldn't start runtime prepare container, prepare step cancelled",
          ),
          step(
            "DEPLOY",
            "cancelled",
            "Cancelled app version 3f2a9c1 creation and deploy to appstage (Node.js)",
          ),
        ],
      },
    },
    {
      name: "the deploy failed",
      appVersion: {
        name: NAME,
        status: "DEPLOY_FAILED",
        build: { ...BUILT, pipelineFailed: at(120) },
      },
      now: 600,
      expected: {
        status: { tone: "failed", word: "Failed" },
        calculating: false,
        overall: { label: "Failed after", durationMs: 115_000, endedAt: at(120) },
        currentStepId: "DEPLOY",
        steps: [
          step("INIT_BUILD_CONTAINER", "finished", "Initialized build container", {
            from: 5,
            to: 13,
            seconds: 8,
          }),
          step(
            "RUN_BUILD_COMMANDS",
            "finished",
            "Build commands from zerops.yml ran successfully",
            { from: 13, to: 120, seconds: 107 },
          ),
          step(
            "DEPLOY",
            "failed",
            "Failed while creating app version 3f2a9c1 or upgrading appstage (Node.js)",
            { from: 74, to: 120, seconds: 46 },
          ),
        ],
      },
    },
    {
      name: "a build-less prepare's deploy failed (the GUI's overall line keeps running)",
      appVersion: {
        name: NAME,
        status: "DEPLOY_FAILED",
        prepareCustomRuntime: {
          containerCreationStart: at(3),
          startDate: at(20),
          endDate: at(60),
        },
      },
      now: 600,
      expected: {
        status: { tone: "failed", word: "Failed" },
        calculating: false,
        overall: { label: "Running for", durationMs: 597_000 },
        currentStepId: "DEPLOY",
        steps: [
          step("INIT_PREPARE_CONTAINER", "finished", "Initialized runtime prepare container", {
            from: 3,
            to: 20,
            seconds: 17,
          }),
          step(
            "RUN_PREPARE_COMMANDS",
            "finished",
            "Runtime prepare commands from zerops.yml ran successfully",
            { from: 20, to: 60, seconds: 40 },
          ),
          step(
            "DEPLOY",
            "failed",
            "Failed while creating app version 3f2a9c1 or upgrading appstage (Node.js)",
            { from: 60, seconds: 540 },
          ),
        ],
      },
    },
    {
      name: "active after a build",
      appVersion: {
        name: NAME,
        status: "ACTIVE",
        build: { ...BUILT, pipelineFinish: at(100) },
        activationDate: at(100),
      },
      now: 600,
      expected: {
        status: { tone: "finished", word: "Finished" },
        calculating: false,
        overall: { label: "Finished in", durationMs: 95_000, endedAt: at(100) },
        steps: [
          step("INIT_BUILD_CONTAINER", "finished", "Initialized build container", {
            from: 5,
            to: 13,
            seconds: 8,
          }),
          step(
            "RUN_BUILD_COMMANDS",
            "finished",
            "Build commands from zerops.yml ran successfully",
            { from: 13, to: 74, seconds: 61 },
          ),
          step(
            "DEPLOY",
            "finished",
            "Created app version 3f2a9c1 and upgraded Node.js service appstage",
            { from: 74, to: 100, seconds: 26 },
          ),
        ],
      },
    },
    {
      name: "a build-less prepare active: finished at its activation",
      appVersion: {
        name: NAME,
        status: "ACTIVE",
        prepareCustomRuntime: {
          containerCreationStart: at(3),
          startDate: at(20),
          endDate: at(60),
        },
        activationDate: at(80),
      },
      now: 600,
      expected: {
        status: { tone: "finished", word: "Finished" },
        calculating: false,
        overall: { label: "Finished in", durationMs: 77_000, endedAt: at(80) },
        steps: [
          step("INIT_PREPARE_CONTAINER", "finished", "Initialized runtime prepare container", {
            from: 3,
            to: 20,
            seconds: 17,
          }),
          step(
            "RUN_PREPARE_COMMANDS",
            "finished",
            "Runtime prepare commands from zerops.yml ran successfully",
            { from: 20, to: 60, seconds: 40 },
          ),
          step(
            "DEPLOY",
            "finished",
            "Created app version 3f2a9c1 and upgraded Node.js service appstage",
            { from: 60, to: 80, seconds: 20 },
          ),
        ],
      },
    },
    {
      name: "an archived version brought back (BACKUP) reads as finished",
      appVersion: { name: NAME, status: "BACKUP", activationDate: at(30) },
      now: 600,
      options: { ...NAMED, actionStartedAt: at(2) },
      expected: {
        status: { tone: "finished", word: "Finished" },
        calculating: false,
        steps: [
          step(
            "DEPLOY",
            "finished",
            "Created app version 3f2a9c1 and upgraded Node.js service appstage",
            { from: 2, to: 30, seconds: 28 },
          ),
        ],
      },
    },
    {
      name: "a status the GUI does not read lists no step (and its word falls through to Finished)",
      appVersion: { name: NAME, status: "UPLOADING", build: {} },
      now: 10,
      expected: {
        status: { tone: "finished", word: "Finished" },
        calculating: false,
        steps: [],
      },
    },
    {
      name: "a zerops.yml that failed validation lists no step, and failed",
      appVersion: {
        name: NAME,
        status: "BUILD_VALIDATION_FAILED",
        build: { pipelineStart: at(5), pipelineFailed: at(8) },
      },
      now: 600,
      expected: {
        status: { tone: "failed", word: "Failed" },
        calculating: false,
        overall: { label: "Failed after", durationMs: 3_000, endedAt: at(8) },
        steps: [],
      },
    },
    {
      name: "cancelled once the build commands ran lists no step, and is cancelled",
      appVersion: {
        name: NAME,
        status: "CANCELLED",
        build: { pipelineStart: at(5), startDate: at(13), pipelineFailed: at(40) },
      },
      now: 600,
      expected: {
        status: { tone: "cancelled", word: "Cancelled" },
        calculating: false,
        overall: { label: "Cancelled after", durationMs: 35_000, endedAt: at(40) },
        steps: [],
      },
    },
  ])("$name", ({ appVersion, now, options, expected }) => {
    expect(shape(read(appVersion, now, options))).toEqual(expected);
  });
});

describe("readPipeline — the deploy step's words", () => {
  const deploying = { name: NAME, status: "DEPLOYING", build: BUILT } as const;
  const deploySentence = (
    appVersion: ActivityAppVersion,
    options: Omit<ReadPipelineOptions, "nowMs">,
  ) => read(appVersion, 90, options).steps.find((entry) => entry.id === "DEPLOY");

  it.each([
    {
      name: "the service and its type",
      appVersion: deploying,
      options: NAMED,
      sentence: "Creating app version 3f2a9c1 and upgrading Node.js service appstage",
    },
    {
      name: "the service without its type",
      appVersion: deploying,
      options: { serviceName: "appstage" },
      sentence: "Creating app version 3f2a9c1 and upgrading appstage",
    },
    {
      name: "no service named",
      appVersion: deploying,
      options: {},
      sentence: "Creating app version 3f2a9c1 and upgrading the service",
    },
    {
      name: "a version name that is not a full sha stays whole",
      appVersion: { ...deploying, name: "v1.4.0" },
      options: NAMED,
      sentence: "Creating app version v1.4.0 and upgrading Node.js service appstage",
    },
    {
      name: "a version with no name",
      appVersion: { status: "DEPLOYING", build: BUILT },
      options: NAMED,
      sentence: "Creating app version and upgrading Node.js service appstage",
    },
  ])("$name", ({ appVersion, options, sentence }) => {
    expect(deploySentence(appVersion, options)?.sentence).toBe(sentence);
  });

  it.each([
    { name: "a service that ran containers", hadContainers: true, note: "Preparing upgrade…" },
    {
      name: "a service with none yet",
      hadContainers: false,
      note: "Preparing to create first containers…",
    },
    { name: "a service whose containers are not known", hadContainers: undefined, note: undefined },
  ])("the running deploy of $name", ({ hadContainers, note }) => {
    const deploy = deploySentence(deploying, {
      ...NAMED,
      ...(hadContainers === undefined ? {} : { hadContainers }),
    });
    expect(deploy?.note).toBe(note);
  });

  it("only a running deploy prepares its containers", () => {
    const activating = deploySentence(
      { ...deploying, activationDate: at(85) },
      { ...NAMED, hadContainers: true },
    );
    expect(activating?.note).toBeUndefined();
  });
});

describe("readPipeline — the short nouns", () => {
  it("names every step with its label", () => {
    const readout = read(
      {
        name: NAME,
        status: "DEPLOYING",
        build: BUILT,
        prepareCustomRuntime: { startDate: at(90), endDate: at(150) },
      },
      160,
    );
    expect(readout.steps.map((entry) => [entry.id, entry.label])).toEqual([
      ["INIT_BUILD_CONTAINER", "Build container"],
      ["RUN_BUILD_COMMANDS", "Build"],
      ["INIT_PREPARE_CONTAINER", "Prepare container"],
      ["RUN_PREPARE_COMMANDS", "Prepare runtime"],
      ["DEPLOY", "Deploy"],
    ]);
  });
});

describe("readPipeline — durations are the clock's, never a read's", () => {
  it("a running step and the overall line move with the clock they are read against", () => {
    const building = {
      name: NAME,
      status: "BUILDING",
      build: { pipelineStart: at(5), startDate: at(13) },
    };
    const early = read(building, 20);
    const later = read(building, 200);
    const runningOf = (readout: PipelineReadout) =>
      readout.steps.find((entry) => entry.id === "RUN_BUILD_COMMANDS")?.durationMs;

    expect([runningOf(early), runningOf(later)]).toEqual([7_000, 187_000]);
    expect([early.overall?.durationMs, later.overall?.durationMs]).toEqual([15_000, 195_000]);
  });

  it("an unreadable timestamp measures nothing, and a clock behind the start reads zero", () => {
    const readout = read(
      { name: NAME, status: "BUILDING", build: { pipelineStart: "soon", startDate: at(13) } },
      10,
    );
    expect(readout.steps[0]).not.toHaveProperty("durationMs");
    expect(readout.overall).toBeUndefined();
    expect(readout.steps[1]?.durationMs).toBe(0);
  });
});

describe("pipelineStepSentence — one step's words, outside a readout", () => {
  it.each([
    {
      id: "RUN_BUILD_COMMANDS",
      names: { versionName: NAME, serviceName: "appstage", serviceType: undefined },
      sentence: "Build commands from zerops.yml failed",
    },
    {
      id: "RUN_PREPARE_COMMANDS",
      names: { versionName: undefined, serviceName: undefined, serviceType: undefined },
      sentence: "Runtime prepare commands from zerops.yml failed",
    },
    {
      id: "DEPLOY",
      names: { versionName: NAME, serviceName: "appstage", serviceType: undefined },
      sentence: "Failed while creating app version 3f2a9c1 or upgrading appstage",
    },
  ] as const)("$id, failed", ({ id, names, sentence }) => {
    expect(pipelineStepSentence(id, "failed", names)).toBe(sentence);
  });
});

describe("formatDuration — the one duration format a card speaks", () => {
  it.each([
    { ms: Number.NaN, text: undefined },
    { ms: -1_000, text: undefined },
    { ms: 0, text: undefined },
    { ms: 999, text: undefined },
    { ms: 1_000, text: "1s" },
    { ms: 42_900, text: "42s" },
    { ms: 60_000, text: "1m" },
    { ms: 72_000, text: "1m 12s" },
    { ms: 599_999, text: "9m 59s" },
    { ms: 600_000, text: "10m" },
    { ms: 13 * 60_000 + 59_000, text: "13m" },
    { ms: 3_600_000, text: "1h" },
    { ms: 2 * 3_600_000 + 6 * 60_000 + 59_000, text: "2h 6m" },
  ])("$ms ms reads $text", ({ ms, text }) => {
    expect(formatDuration(ms)).toBe(text);
  });
});

describe("displayVersionName — how a version is named in words", () => {
  it.each([
    { name: NAME, display: "3f2a9c1" },
    { name: `${NAME}-dirty`, display: `${NAME}-dirty` },
    { name: "v1.4.0", display: "v1.4.0" },
  ])("$name reads $display", ({ name, display }) => {
    expect(displayVersionName(name)).toBe(display);
  });
});
