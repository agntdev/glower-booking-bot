// Globs every per-feature dialog spec under tests/specs/ and runs each one
// against a fresh bot. One Vitest "test" per feature file keeps failures
// pinpointed (one feature broken, one red test) instead of a single mega-test
// that hides which spec failed.
//
// Also globs tests/commands/<slug>.json to verify every declared command has
// at least one spec that exercises it (the coverage half of the test gate).

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { buildBot } from "../src/bot.js";
import {
  parseBotSpec,
  parseBotSpecs,
  runSpecs,
  computeCoverage,
  formatSuiteResult,
  type BotSpec,
} from "../src/toolkit/index.js";

const SPECS_DIR = new URL("./specs/", import.meta.url);
const COMMANDS_DIR = new URL("./commands/", import.meta.url);

function listJson(dir: URL): string[] {
  try {
    return readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .sort();
  } catch {
    return [];
  }
}

const specFiles = listJson(SPECS_DIR);
const cmdFiles = listJson(COMMANDS_DIR);

for (const file of specFiles) {
  describe(`specs/${file}`, () => {
    it("all dialog specs pass against a fresh bot", async () => {
      const raw = JSON.parse(
        readFileSync(new URL(file, SPECS_DIR), "utf8"),
      ) as unknown[];
      const specs = parseBotSpecs(raw);
      const suite = await runSpecs(() => buildBot("test-token"), specs);
      if (suite.failed > 0) {
        // Print the full report for the failure.
        // eslint-disable-next-line no-console
        console.error(formatSuiteResult(suite));
      }
      expect(suite.failed).toBe(0);
      expect(suite.passed).toBeGreaterThan(0);
    });
  });
}

describe("command coverage", () => {
  it("every declared command has ≥1 spec exercising it", () => {
    // Load every per-feature spec.
    const allSpecs: BotSpec[] = [];
    for (const file of specFiles) {
      const raw = JSON.parse(
        readFileSync(new URL(file, SPECS_DIR), "utf8"),
      ) as unknown[];
      allSpecs.push(...raw.map(parseBotSpec));
    }
    // Load every declared-command manifest.
    const declared: string[] = [];
    for (const file of cmdFiles) {
      const raw = JSON.parse(
        readFileSync(new URL(file, COMMANDS_DIR), "utf8"),
      ) as string[];
      if (Array.isArray(raw)) declared.push(...raw);
    }
    const cov = computeCoverage(allSpecs, declared);
    if (cov.missing.length > 0) {
      // eslint-disable-next-line no-console
      console.error("missing coverage for:", cov.missing);
    }
    expect(cov.missing).toEqual([]);
    expect(cov.fraction).toBe(1);
  });
});