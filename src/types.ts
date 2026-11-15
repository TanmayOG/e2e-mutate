/** A JSON value, as mutant specs cross into the page as JSON. */
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

/** The bug types e2e-mutate plants (README, "How it works", step 2). */
export const BUG_TYPES = [
  'wrong-number',
  'wrong-word',
  'missing-element',
  'dead-control',
  'swapped-rows',
  'server-error',
  'lost-write',
  'wrong-api-value',
  'missing-api-item',
] as const;
export type BugType = (typeof BUG_TYPES)[number];

/** A path into a JSON body: object keys, array indexes, or `{ id }` to pick the array item with that id. */
export type JsonPathSegment = string | number | { readonly id: string };

/** How a mutant finds its element on the page. */
export interface ElementRef {
  readonly testId?: string;
  readonly css?: string;
  readonly role?: string;
  readonly name?: string;
  readonly region?: string;
  readonly text?: string;
}

/** One planted bug: the spec `in-page/apply.js` receives, plus what the report needs. */
export interface Mutant {
  readonly id: string;
  readonly type: BugType;
  /** One line a person reads: what is broken. */
  readonly title: string;
  /** What the app showed or answered, and what the bug changes it to. */
  readonly before: string;
  readonly after: string;
  /** Normalized page path, for screen bugs. */
  readonly page?: string;
  readonly from?: string;
  readonly to?: string;
  readonly element?: ElementRef;
  readonly method?: string;
  readonly path?: string;
  readonly jsonPath?: readonly JsonPathSegment[];
  readonly value?: JsonValue;
  readonly itemId?: string;
  /** For swapped rows: the labels of the first two rows as recorded, for the report's suggestion. */
  readonly rows?: readonly [string, string];
  /** Keys of the tests whose baseline touched what this bug changes. */
  readonly tests: readonly string[];
}

/** What the recorder saw, one event at a time. */
export type RecorderEvent =
  | { readonly kind: 'text'; readonly at: number; readonly page: string; readonly text: string }
  | {
      readonly kind: 'element';
      readonly at: number;
      readonly page: string;
      readonly testId?: string;
      readonly role?: string;
      readonly text: string;
      readonly css: string;
    }
  | { readonly kind: 'list'; readonly at: number; readonly page: string; readonly css: string; readonly rows: readonly string[] }
  | {
      readonly kind: 'control';
      readonly at: number;
      readonly page: string;
      readonly role: string;
      readonly name: string;
      readonly region?: string;
      /** No click listener on it or above it, no `onclick` and no default action: a dead-control bug would change nothing. */
      readonly inert?: boolean;
    }
  | {
      readonly kind: 'request';
      readonly at: number;
      readonly page: string;
      readonly method: string;
      readonly path: string;
      readonly sameOrigin: boolean;
      readonly status: number;
      readonly requestJson?: JsonValue;
      readonly responseJson?: JsonValue;
    };

/** One test in the drill, keyed by `file:line`. */
export interface TestRef {
  readonly key: string;
  readonly file: string;
  readonly line: number;
  readonly title: string;
}

/** A step as the baseline replay ran it. */
export interface BaselineStep {
  readonly index: number;
  readonly kind: string;
  readonly api: string;
  readonly label: string;
  readonly cacheMode?: string;
  readonly durationMs: number;
}

/** A test the baseline proved stable, with its steps and what it touched. */
export interface BaselineTest extends TestRef {
  readonly steps: readonly BaselineStep[];
  readonly events: readonly RecorderEvent[];
}

/** Why a test was left out of the drill. */
export interface SkippedTest extends Partial<TestRef> {
  readonly title: string;
  readonly reason: string;
}

export type TestOutcome =
  | 'caught'
  | 'timed-out'
  | 'healed-past'
  | 'got-through'
  | 'not-reached'
  | 'failed-before'
  | 'flaky'
  | 'error';

export type MutantOutcome = 'caught' | 'healed-past' | 'got-through' | 'not-reached' | 'inconclusive' | 'flaky' | 'error';

/** A step that took over from replay under the bug. */
export interface HealedStep {
  readonly index: number;
  readonly label: string;
  readonly reason?: string;
  readonly detail?: string;
  readonly durationMs: number;
  readonly baselineMs: number;
}

/** How one test fared under one mutant. */
export interface TestVerdict {
  readonly test: string;
  readonly title: string;
  readonly outcome: TestOutcome;
  readonly appliedAtStep?: number;
  readonly failedStep?: {
    readonly index: number;
    readonly kind: string;
    readonly api: string;
    readonly label: string;
    readonly code?: string;
    readonly message?: string;
  };
  /** The test's own error, when it failed outside any step (an `expect` on a plain value, its code throwing). */
  readonly failure?: { readonly code?: string; readonly message?: string };
  readonly healed: readonly HealedStep[];
  /** Weak checks in the test that passed under the bug (its `agent.assert` labels). */
  readonly passedJudgments: readonly string[];
  /** Paths relative to the drill's output directory. */
  readonly screenshot?: string;
  readonly video?: string;
  readonly trace?: string;
}

/** How one mutant fared across the tests that touch it. */
export interface MutantVerdict {
  readonly mutant: Mutant;
  readonly outcome: MutantOutcome;
  readonly tests: readonly TestVerdict[];
  readonly durationMs: number;
  readonly costUsd: number;
  /** The confirm run's outcome, when one ran. */
  readonly confirmedBy?: MutantOutcome;
  readonly runDir: string;
  readonly suggestions: readonly string[];
}
