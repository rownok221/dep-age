import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { setTimeout as sleep } from "timers/promises";
import type { PackageJson, ScanOptions, DependencyInfo, ScanResult, AbandonmentThreshold } from "./types";
import { DEFAULT_ABANDONMENT_THRESHOLD } from "./types";

const npmRegistryUrl = "https://registry.npmjs.org/";
const maxConcurrentFetches = 10;
const fetchTimeoutMs = 8000;
const defaultCacheTTL = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

interface CacheEntry {
  timestamp: number;
  data: Omit<DependencyInfo, 'currentVersion' | 'isAbandoned'>;
}

/** Internal queue implementation for concurrency control */
class PromiseQueue {
  private pending = 0;
  private queue: Array<() => void> = [];

  constructor(private readonly concurrency: number) {}

  async enqueue<T>(task: () => Promise<T>): Promise<T> {
    while (this.pending >= this.concurrency) {
      await new Promise<void>((resolve) => this.queue.push(resolve));
    }

    this.pending++;
    try {
      return await task();
    } finally {
      this.pending--;
      this.queue.shift()?.();
    }
  }
}

/**
 * Extract package names from specified dependency fields in package.json
 * @internal
 */
function getDependenciesFromPackageJson(
  pkg: PackageJson,
  fields: ReadonlyArray<"dependencies" | "devDependencies" | "peerDependencies" | "optionalDependencies">
): Set<string> {
  const packages = new Set<string>();
  
  for (const field of fields) {
    const deps = pkg[field];
    if (deps) {
      for (const name of Object.keys(deps)) {
        packages.add(name);
      }
    }
  }
  
  return packages;
}

/**
 * Parse alternative package suggestions from deprecation message
 * @internal
 */
function extractAlternativesFromDeprecation(message?: string): string[] {
  if (!message) return [];
  const match = message.match(/use\s+([@\w/\-]+(?:\s+[@\w/\-]+)*)\s+instead/gi);
  return match ? [...new Set(match.flatMap(m => m.replace(/use\s+/gi, "").replace(/\s+instead/gi, "").split(/\s+/)))] : [];
}

/**
 * Fetches package metadata from the npm registry or cache.
 * @param name - Package name.
 * @param registryUrl - URL of the npm registry.
 * @param useCache - Whether to use caching.
 * @param cachePath - Path to the cache directory.
 * @param cacheTTL - Time-to-live for cache entries in milliseconds.
 * @returns Processed package metadata.
 */
export async function fetchPackageMetadata(
  name: string,
  registryUrl: string = npmRegistryUrl,
  useCache: boolean = false,
  cachePath?: string,
  cacheTTL: number = defaultCacheTTL
): Promise<Omit<DependencyInfo, 'currentVersion' | 'isAbandoned'>> {
  const cacheDir = cachePath ? path.join(cachePath, '.dep-age-cache') : path.join(os.tmpdir(), '.dep-age-cache');
  const cacheFilePath = path.join(cacheDir, `${encodeURIComponent(name)}.json`);

  if (useCache) {
    try {
      if (fs.existsSync(cacheFilePath)) {
        const cacheEntry: CacheEntry = JSON.parse(fs.readFileSync(cacheFilePath, 'utf8'));
        if (Date.now() - cacheEntry.timestamp < cacheTTL) {
          return { ...cacheEntry.data, publishedDate: new Date(cacheEntry.data.publishedDate) };
        }
      }
    } catch (error) {
      console.warn(`Cache read error for ${name}: ${error instanceof Error ? error.message : String(error)}`);
      // Continue to fetch if cache read fails
    }
  }

  const registryEndpoint = new URL(name, registryUrl).toString();
  
  const controller = new AbortController();
  const timeout = sleep(fetchTimeoutMs).then(() => {
    controller.abort();
    throw new Error(`Registry request timed out after ${fetchTimeoutMs}ms`);
  });

  try {
    const response = await Promise.race([
      fetch(registryEndpoint, { signal: controller.signal }),
      timeout
    ]);
    
    if (!response.ok) {
      throw new Error(`Registry returned ${response.status}: ${await response.text()}`);
    }

    const metadata = await response.json();
    if (!metadata.time || typeof metadata.time !== "object") {
      throw new Error("Invalid registry response: missing time field");
    }

    const latestVersion = metadata["dist-tags"]?.latest;
    if (!latestVersion || !metadata.versions?.[latestVersion]) {
      throw new Error("Missing latest version information");
    }

    const publishDate = new Date(metadata.time[latestVersion]);
    if (Number.isNaN(publishDate.getTime())) {
      throw new Error("Invalid publish date format");
    }

    const ageInDays = Math.floor((Date.now() - publishDate.getTime()) / 86400000);
    const deprecatedMessage = metadata.versions[latestVersion].deprecated || metadata.deprecated;

    const resultData: Omit<DependencyInfo, 'currentVersion' | 'isAbandoned'> = {
      name,
      publishedDate: publishDate,
      ageInDays,
      alternatives: extractAlternativesFromDeprecation(deprecatedMessage)
    };

    if (useCache) {
      try {
        if (!fs.existsSync(cacheDir)) {
          fs.mkdirSync(cacheDir, { recursive: true });
        }
        const cacheEntry: CacheEntry = { timestamp: Date.now(), data: resultData };
        fs.writeFileSync(cacheFilePath, JSON.stringify(cacheEntry), 'utf8');
      } catch (error) {
        console.warn(`Cache write error for ${name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    return resultData;
  } catch (error) {
    throw new Error(`Failed to fetch metadata for ${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Scan project dependencies and analyze package freshness
 * @param options - Configuration for dependency scanning
 * @returns Object mapping package names to their analyzed metadata
 * @throws {Error} When package.json is invalid or registry communication fails
 * @example
 * const results = await scanDependencies({
 *   packageJsonPath: './package.json',
 *   abandonmentThreshold: createAbandonmentThreshold(365)
 * });
 */
export async function scanDependencies(options: ScanOptions & { packageJsonPath?: string }): Promise<ScanResult> {
  const packageJsonPath = options.packageJsonPath ?? path.join(process.cwd(), "package.json");
  const rawJson = fs.readFileSync(packageJsonPath, "utf8");
  const pkg = JSON.parse(rawJson) as PackageJson;
  
  const dependencyFields = options.dependencyFields ?? [
    "dependencies", "devDependencies", "peerDependencies", "optionalDependencies"
  ].filter((f): f is keyof PackageJson => pkg[f as keyof PackageJson] !== undefined);
  
  const packageNames = getDependenciesFromPackageJson(pkg, dependencyFields);
  
  // Filter out ignored packages
  if (options.ignore) {
    for (const name of options.ignore) {
      packageNames.delete(name);
    }
  }
  
  const queue = new PromiseQueue(options.concurrency ?? maxConcurrentFetches);
  const results = new Map<string, DependencyInfo>();
  
  await Promise.all([...packageNames].map(async (name) => {
    const versionSpec = (
      pkg.dependencies?.[name] ||
      pkg.devDependencies?.[name] ||
      pkg.peerDependencies?.[name] ||
      pkg.optionalDependencies?.[name]
    ) ?? "*";
    
    try {
      const meta = await queue.enqueue(() => 
        fetchPackageMetadata(
          name,
          options.registryUrl,
          options.useCache,
          options.cachePath,
          options.cacheTTL
        )
      );
      
      const threshold = options.abandonmentThreshold ?? DEFAULT_ABANDONMENT_THRESHOLD;
      const isAbandoned = meta.ageInDays >= threshold;
      
      results.set(name, {
        name,
        currentVersion: versionSpec.replace(/^[\^~]/, ''),
        publishedDate: meta.publishedDate,
        ageInDays: meta.ageInDays,
        isAbandoned,
        alternatives: meta.alternatives
      });
    } catch (error) {
      console.warn(`Failed to analyze ${name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }));
  
  return Object.fromEntries(results) as ScanResult;
}