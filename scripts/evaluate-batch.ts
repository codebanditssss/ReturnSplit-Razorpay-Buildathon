import { buildSyntheticBatch, evaluateSyntheticBatch } from "../src/evaluation/batch";

const records = buildSyntheticBatch();
const report = evaluateSyntheticBatch(records);
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
