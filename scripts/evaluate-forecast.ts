import { readFile } from "node:fs/promises";
import { basename } from "node:path";

import { loadEnvConfig } from "@next/env";

import {
  evaluateForecastBacktest,
  type CandidateForecaster,
  type CandidateRequestState,
  type ForecastDatasetKind,
} from "../src/evaluation/forecast-backtest";
import {
  DEMO_REFUND_HISTORY,
  assertForecastHistory,
  buildSeasonalFallback,
  type ForecastHistoryPoint,
} from "../src/features/risk/forecast";
import { createForecastProviderFromEnvironment } from "../src/features/risk/timesfm-adapter";

const MAX_INPUT_BYTES = 2 * 1024 * 1024;

interface CliOptions {
  inputPath?: string;
  maxOriginsPerHorizon: number | null;
  minTrainingPoints: number;
  originStride: number;
  evaluatedAt: string;
  requireTimesFm: boolean;
  help: boolean;
}

interface EvaluationDataset {
  history: ForecastHistoryPoint[];
  label: string;
  kind: ForecastDatasetKind;
}

function usage(): string {
  return [
    "ReturnSplit rolling-origin forecast evaluation",
    "",
    "Usage: pnpm eval:forecast -- [options]",
    "",
    "Options:",
    "  --input <json>          Daily aggregate series; defaults to the synthetic demo",
    "  --max-origins <n|all>   Latest eligible origins per horizon (default: 5)",
    "  --min-training <n>      Minimum training days (default: 14)",
    "  --origin-stride <n>     Days between rolling origins (default: 1)",
    "  --evaluated-at <iso>    Fixed report timestamp for reproducible artifacts",
    "  --require-timesfm       Exit 2 unless every origin used TimesFM output",
    "  --help                   Show this help",
    "",
    "Input is either an array of {date,valuePaise} or an object with a history",
    "array and optional datasetLabel. Output is JSON on stdout.",
  ].join("\n");
}

function optionValue(args: string[], index: number, option: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${option} requires a value`);
  }
  return value;
}

function positiveInteger(value: string, option: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${option} must be a positive integer`);
  }
  return parsed;
}

function parseArguments(args: string[]): CliOptions {
  const options: CliOptions = {
    maxOriginsPerHorizon: 5,
    minTrainingPoints: 14,
    originStride: 1,
    evaluatedAt: new Date().toISOString(),
    requireTimesFm: false,
    help: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--") {
      continue;
    } else if (argument === "--help") {
      options.help = true;
    } else if (argument === "--require-timesfm") {
      options.requireTimesFm = true;
    } else if (argument === "--input") {
      options.inputPath = optionValue(args, index, argument);
      index += 1;
    } else if (argument === "--max-origins") {
      const value = optionValue(args, index, argument);
      options.maxOriginsPerHorizon = value === "all"
        ? null
        : positiveInteger(value, argument);
      index += 1;
    } else if (argument === "--min-training") {
      options.minTrainingPoints = positiveInteger(
        optionValue(args, index, argument),
        argument,
      );
      index += 1;
    } else if (argument === "--origin-stride") {
      options.originStride = positiveInteger(
        optionValue(args, index, argument),
        argument,
      );
      index += 1;
    } else if (argument === "--evaluated-at") {
      const value = optionValue(args, index, argument);
      if (Number.isNaN(Date.parse(value))) {
        throw new Error("--evaluated-at must be an ISO timestamp");
      }
      options.evaluatedAt = new Date(value).toISOString();
      index += 1;
    } else {
      throw new Error(`Unknown option: ${argument}`);
    }
  }
  return options;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseHistory(value: unknown): ForecastHistoryPoint[] {
  if (!Array.isArray(value)) {
    throw new Error("Forecast input history must be an array");
  }
  const history = value.map((point, index) => {
    if (
      !isRecord(point) ||
      typeof point.date !== "string" ||
      !Number.isSafeInteger(point.valuePaise)
    ) {
      throw new Error(
        `History point ${index + 1} must contain date and integer valuePaise`,
      );
    }
    return { date: point.date, valuePaise: point.valuePaise as number };
  });
  assertForecastHistory(history);
  return history;
}

async function loadDataset(inputPath?: string): Promise<EvaluationDataset> {
  if (!inputPath) {
    return {
      history: DEMO_REFUND_HISTORY.map((point) => ({ ...point })),
      label: "creo-market-synthetic-demo-v1",
      kind: "synthetic_demo",
    };
  }

  const contents = await readFile(inputPath, "utf8");
  if (Buffer.byteLength(contents, "utf8") > MAX_INPUT_BYTES) {
    throw new Error("Forecast input exceeds the 2 MiB local evaluation limit");
  }
  const parsed: unknown = JSON.parse(contents);
  const historyValue = Array.isArray(parsed)
    ? parsed
    : isRecord(parsed)
      ? parsed.history
      : undefined;
  const configuredLabel = isRecord(parsed) && typeof parsed.datasetLabel === "string"
    ? parsed.datasetLabel.trim()
    : "";
  return {
    history: parseHistory(historyValue),
    label: configuredLabel || `user-supplied:${basename(inputPath)}`,
    kind: "user_supplied_aggregate",
  };
}

function createCandidate(): {
  requestState: CandidateRequestState;
  forecast: CandidateForecaster;
} {
  const endpointWasProvided = Boolean(process.env.TIMESFM_ENDPOINT?.trim());
  const provider = createForecastProviderFromEnvironment();
  if (provider) {
    return {
      requestState: "timesfm_endpoint_configured",
      forecast: (request) => provider.forecast(request),
    };
  }

  const requestState: CandidateRequestState = endpointWasProvided
    ? "timesfm_endpoint_rejected"
    : "timesfm_endpoint_not_configured";
  return {
    requestState,
    forecast: (request) =>
      Promise.resolve(
        buildSeasonalFallback({
          history: request.history,
          horizon: request.horizon,
          generatedAt: `${request.history[request.history.length - 1].date}T00:00:00.000Z`,
          isIllustrative: request.isIllustrative,
          notice:
            "TimesFM was not configured for this evaluation. This origin uses the deterministic weekday fallback and is not a TimesFM measurement.",
        }),
      ),
  };
}

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }

  // This CLI runs outside Next.js, so load the same root .env files explicitly.
  // Shell-provided values keep precedence under @next/env's normal load order.
  loadEnvConfig(process.cwd());
  const dataset = await loadDataset(options.inputPath);
  const candidate = createCandidate();
  const report = await evaluateForecastBacktest({
    history: dataset.history,
    datasetLabel: dataset.label,
    datasetKind: dataset.kind,
    evaluatedAt: options.evaluatedAt,
    candidateRequestState: candidate.requestState,
    candidateForecast: candidate.forecast,
    minTrainingPoints: options.minTrainingPoints,
    originStride: options.originStride,
    maxOriginsPerHorizon: options.maxOriginsPerHorizon,
  });

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (options.requireTimesFm && report.candidate.outcome !== "timesfm_only") {
    process.exitCode = 2;
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown evaluation error";
  process.stderr.write(`Forecast evaluation failed: ${message}\n`);
  process.exitCode = 1;
});
