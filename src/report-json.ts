import { readFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * The parts of e2e's `report.json` (schema report-v1) e2e-mutate reads.
 * Field names follow `packages/e2e/schema/report-v1.schema.json` in e2e.
 */
export interface E2EReport {
  readonly schemaVersion: string;
  readonly run: {
    readonly status: string;
    readonly exitCode: number;
    readonly results: readonly E2EResult[];
    readonly errors?: readonly { readonly code?: string; readonly message?: string }[];
    readonly usage?: { readonly estimatedCostUsd?: number; readonly modelTokens?: number };
    readonly serialGroups?: readonly unknown[];
  };
}

export interface E2EResult {
  readonly id: string;
  readonly testId?: string;
  readonly file?: string;
  readonly titlePath?: readonly string[];
  readonly source?: { readonly file: string; readonly line: number; readonly column?: number };
  /** `test`, or `setup` for a setup test e2e ran because a selected test needs it. */
  readonly kind?: string;
  readonly status: string;
  readonly attempts?: readonly E2EAttempt[];
}

export interface E2EAttempt {
  readonly index: number;
  readonly status: string;
  readonly startedAt: string;
  readonly durationMs: number;
  readonly steps?: readonly E2EStep[];
  readonly appLog?: readonly { readonly source: string; readonly level: string; readonly text: string; readonly step?: number; readonly at?: string }[];
  readonly artifacts?: readonly E2EArtifact[];
  readonly error?: { readonly code?: string; readonly message?: string };
}

export interface E2EStep {
  readonly id?: string;
  readonly index: number;
  readonly kind: string;
  readonly api: string;
  readonly label?: string;
  readonly status: string;
  readonly startedAt?: string;
  readonly durationMs?: number;
  readonly error?: { readonly code?: string; readonly message?: string };
  readonly cache?: {
    readonly mode?: string;
    readonly reason?: string;
    readonly detail?: string;
    readonly write?: string;
    readonly replayedActions?: number;
    readonly totalActions?: number;
  };
  readonly artifacts?: readonly E2EArtifact[];
}

export interface E2EArtifact {
  readonly kind: string;
  readonly path?: string;
  readonly producer?: { readonly kind: string; readonly stepId?: string };
}

/** Reads `<output>/report.json`, or returns undefined when the run wrote none. */
export async function readReport(outputDir: string): Promise<E2EReport | undefined> {
  try {
    return JSON.parse(await readFile(path.join(outputDir, 'report.json'), 'utf8')) as E2EReport;
  } catch {
    return undefined;
  }
}

/** The `file:line` key e2e-mutate uses for a test. */
export function resultKey(result: E2EResult): string | undefined {
  return result.source ? `${result.source.file}:${result.source.line}` : undefined;
}

/** The test's final attempt, the one its status comes from. */
export function finalAttempt(result: E2EResult): E2EAttempt | undefined {
  const attempts = result.attempts ?? [];
  return attempts[attempts.length - 1];
}
