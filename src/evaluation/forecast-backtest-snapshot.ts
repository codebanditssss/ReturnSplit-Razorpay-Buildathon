/**
 * Checked-in summary of a strict TimesFM evidence run. This is deliberately a
 * dated artifact rather than a live health signal. Reproduce it with the
 * command shown in `command` and replace the snapshot when the dataset or
 * model changes.
 */
export const latestForecastBacktest = {
  evaluatedAt: "2026-09-04T08:57:27.375Z",
  datasetLabel: "Creo Market synthetic demo v1",
  datasetKind: "synthetic_demo",
  datasetPoints: 56,
  datasetSha256:
    "4c65deca74a14911abaae6616c8f82b1fbdd4752e483d7d1bb62abe367836cfe",
  requestedModel: "google/timesfm-2.5-200m-pytorch",
  timesFmOrigins: 15,
  fallbackOrigins: 0,
  releaseStatus: "not_approved_for_production",
  evidenceStatus: "illustrative_backtest",
  command: "pnpm --silent eval:forecast -- --require-timesfm",
  horizons: [
    {
      days: 7,
      observations: 35,
      wape: 0.037652,
      seasonalNaiveWape: 0.056295,
      lastValueWape: 0.189263,
      intervalCoverage: 0.942857,
    },
    {
      days: 14,
      observations: 70,
      wape: 0.034296,
      seasonalNaiveWape: 0.050698,
      lastValueWape: 0.179277,
      intervalCoverage: 0.928571,
    },
    {
      days: 30,
      observations: 150,
      wape: 0.037115,
      seasonalNaiveWape: 0.049134,
      lastValueWape: 0.242944,
      intervalCoverage: 0.933333,
    },
  ],
} as const;
