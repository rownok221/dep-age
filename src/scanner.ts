import * as path from "path";
import * as fs from "fs";
// REMOVED external import: import { setTimeout } from "timers/promises";
import type { PackageJson, ScanOptions, DependencyInfo, ScanResult, AbandonmentThreshold } from "./types";
import { DEFAULT_ABANDONMENT_THRESHOLD } from "./types";

const npmRegistryUrl = "https://registry.npmjs.org/";
const maxConcurrentFetches = 10;
const fetchTimeoutMs = 8000;

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
  const match = message.match(/use\s+([@\w/-]+(?:\s+[@\w/-]+)*)\s+instead/gi);
  return match ? [...new Set(match.flatMap(m => m.replace(/use\s+/gi, "").replace(/\s+instead/gi, "").split(/\s+/)))] : [];
}

/**
 * Fetch npm registry metadata for a package
 * @param name - Package name to query
 * @param registryUrl - Custom registry URL (default: npm public registry)
 * @returns Processed package metadata with version timestamps
 * @throws {Error} When registry response is invalid or request fails
 * @example
 * const reactMeta = await fetchPackageMetadata('react');
 */
export async function fetchPackageMetadata(
  name: string,
  registryUrl: string = npmRegistryUrl
): Promise<DependencyInfo> {
  const registryEndpoint = new URL(name, registryUrl).toString();
  
  const controller = new AbortController();
  const timeout = setTimeout(fetchTimeoutMs).then(() => {
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

    return {
      name,
      currentVersion: "", // Filled during scanning from actual package.json
      publishedDate: publishDate,
      ageInDays,
      isAbandoned: false, // Evaluated later with threshold
      alternatives: extractAlternativesFromDeprecation(deprecatedMessage)
    };
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
      const meta = await queue.enqueue(() => fetchPackageMetadata(name, options.registryUrl));
      const threshold = options.abandonmentThreshold ?? DEFAULT_ABANDONMENT_THRESHOLD;
      
      results.set(name, {
        ...meta,
        currentVersion: versionSpec,
        isAbandoned: meta.ageInDays >= threshold
      });
    } catch (error) {
      console.warn(`Skipping ${name}: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }));

  return Object.fromEntries(results.entries());
}