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

/** Configuration options for dependency scanning. */
export interface ScanOptions {
  readonly dependencyFields?: ReadonlyArray<DependencyField>;
  readonly registryUrl?: string;
  readonly abandonmentThreshold?: AbandonmentThreshold;
  readonly checkForAlternatives?: boolean;
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
  readonly format?: 'text' | 'json';
  readonly verbosity?: number;
  readonly color?: boolean;
  readonly showAlternatives?: boolean;
  readonly outputFilePath?: string;
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