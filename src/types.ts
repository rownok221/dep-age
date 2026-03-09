// REMOVED external import: import type { ReadonlyDeep } from "type-fest";

/** Represents the parsed package.json file structure. */
export interface PackageJson {
  readonly name?: string;
  readonly version?: string;
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly devDependencies?: Readonly<Record<string, string>>;
  readonly optionalDependencies?: Readonly<Record<string, string>>;
  readonly peerDependencies?: Readonly<Record<string, string>>;
}

/** Information about a specific dependency package. */
export interface DependencyInfo {
  readonly name: string;
  readonly currentVersion: string;
  readonly publishedDate: Date;
  readonly ageInDays: number;
  readonly isAbandoned: boolean;
  readonly alternatives?: ReadonlyArray<string>;
}

/** A node in the dependency tree with transitive dependency info. */
export interface TreeNode {
  readonly name: string;
  readonly version: string;
  readonly ageInDays: number;
  readonly isAbandoned: boolean;
  readonly depth: number;
  readonly children: ReadonlyArray<TreeNode>;
}

/** Summary statistics for a dependency tree analysis. */
export interface TreeSummary {
  readonly totalPackages: number;
  readonly uniquePackages: number;
  readonly maxDepth: number;
  readonly abandonedCount: number;
  readonly abandonedPaths: ReadonlyArray<ReadonlyArray<string>>;
  readonly healthScore: number;
  readonly grade: 'A' | 'B' | 'C' | 'D' | 'F';
}

/** Options for tree scanning. */
export interface TreeScanOptions {
  readonly packageJsonPath?: string;
  readonly maxDepth?: number;
  readonly registryUrl?: string;
  readonly abandonmentThreshold?: AbandonmentThreshold;
  readonly ignore?: ReadonlyArray<string>;
  readonly concurrency?: number;
}

/** Configuration options for dependency scanning. */
export interface ScanOptions {
  readonly dependencyFields?: ReadonlyArray<DependencyField>;
  readonly registryUrl?: string;
  readonly abandonmentThreshold?: AbandonmentThreshold;
  readonly checkForAlternatives?: boolean;
  readonly useCache?: boolean;
  readonly cachePath?: string;
  readonly cacheTTL?: number; // Time-to-live for cache entries in milliseconds
  /** Package names to ignore during scanning */
  readonly ignore?: ReadonlyArray<string>;
}

/** Specific dependency fields to scan in package.json */
export type DependencyField = 
  | 'dependencies'
  | 'devDependencies'
  | 'optionalDependencies'
  | 'peerDependencies';

/** Result of dependency scanning process. */
export type ScanResult = Readonly<Record<string, DependencyInfo>>;

/** Formatting options for report generation. */
export interface ReportOptions {
  readonly format?: 'text' | 'json' | 'markdown';
  readonly verbosity?: number;
  readonly color?: boolean;
  readonly showAlternatives?: boolean;
  readonly showOnlyAbandoned?: boolean;
  readonly sortBy?: 'name' | 'age' | 'status';
  readonly outputFilePath?: string;
}

/** Health score summary for a project's dependencies. */
export interface HealthScore {
  readonly score: number;
  readonly grade: 'A' | 'B' | 'C' | 'D' | 'F';
  readonly totalDeps: number;
  readonly veryFreshCount: number; // < 0.25 * threshold
  readonly freshCount: number;     // < 0.5 * threshold
  readonly agingCount: number;     // < 0.75 * threshold
  readonly oldCount: number;       // < 1.0 * threshold
  readonly abandonedCount: number; // >= 1.0 * threshold
  readonly averageAgeDays: number;
  readonly oldestPackage: string | null;
  readonly summary: string;
  readonly explanation?: ReadonlyArray<string>; // Detailed explanations for low scores
}

/** Flattened data structure for report display rows. */
export interface ReportRow {
  readonly name: string;
  readonly currentVersion: string;
  readonly publishedDate: string;
  readonly age: number;
  readonly status: 'active' | 'abandoned';
  readonly alternatives?: ReadonlyArray<string>;
}

/** Branded type enforcing positive abandonment threshold in days. */
export type AbandonmentThreshold = number & { __brand: 'AbandonmentThreshold' };

/** Default threshold (2 years) for marking packages as abandoned. */
export const DEFAULT_ABANDONMENT_THRESHOLD = 730 as AbandonmentThreshold;

/** Validates and creates branded abandonment threshold type. */
export function createAbandonmentThreshold(days: number): AbandonmentThreshold {
  if (!Number.isInteger(days) || days <= 0) {
    throw new RangeError(`Abandonment threshold must be positive integer, got ${days}`);
  }
  return days as AbandonmentThreshold;
}
