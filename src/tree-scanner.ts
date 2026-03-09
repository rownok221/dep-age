import * as path from "path";
import * as fs from "fs";
import { fetchPackageMetadata } from "./scanner";
import type { TreeNode, TreeSummary, TreeScanOptions, AbandonmentThreshold } from "./types";
import { DEFAULT_ABANDONMENT_THRESHOLD } from "./types";

const NPM_REGISTRY = "https://registry.npmjs.org/";
const MAX_CONCURRENT = 8;
const FETCH_TIMEOUT = 8000;

/** @internal Simple concurrency limiter */
class Semaphore {
  private pending = 0;
  private queue: Array<() => void> = [];
  constructor(private readonly limit: number) {}
  async acquire(): Promise<void> {
    if (this.pending < this.limit) { this.pending++; return; }
    await new Promise<void>(r => this.queue.push(r));
  }
  release(): void {
    this.pending--;
    this.queue.shift()?.();
  }
}

interface NpmPkgMeta {
  versions?: Record<string, { dependencies?: Record<string, string> }>;
  "dist-tags"?: { latest?: string };
  time?: Record<string, string>;
}

/**
 * Fetch transitive dependency metadata from the npm registry.
 * @internal
 */
async function fetchPkgJson(
  name: string,
  registryUrl: string
): Promise<NpmPkgMeta> {
  const url = new URL(name, registryUrl).toString();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`${res.status}`);
    return (await res.json()) as NpmPkgMeta;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Scan the full dependency tree of a project, resolving transitive dependencies.
 * @param options - Tree scanning configuration
 * @returns Root-level tree nodes for each direct dependency
 * @example
 * 
 * const tree = await scanDependencyTree({ packageJsonPath: './package.json', maxDepth: 3 });
 * const summary = summarizeTree(tree);
 * console.log(formatTree(tree));
 * 
 */
export async function scanDependencyTree(
  options: TreeScanOptions = {}
): Promise<ReadonlyArray<TreeNode>> {
  const pkgPath = options.packageJsonPath ?? path.join(process.cwd(), "package.json");
  const maxDepth = options.maxDepth ?? 5;
  const registryUrl = options.registryUrl ?? NPM_REGISTRY;
  const threshold = options.abandonmentThreshold ?? DEFAULT_ABANDONMENT_THRESHOLD;
  const ignoreSet = new Set(options.ignore ?? []);
  const concurrency = options.concurrency ?? MAX_CONCURRENT;

  const raw = fs.readFileSync(pkgPath, "utf8");
  const pkg = JSON.parse(raw);
  const directDeps: Record<string, string> = { ...pkg.dependencies };

  const sem = new Semaphore(concurrency);
  const cache = new Map<string, NpmPkgMeta>();

  async function resolve(
    name: string,
    version: string,
    depth: number,
    visited: Set<string>
  ): Promise<TreeNode> {
    const ageInfo = await getAge(name, registryUrl, threshold, sem, cache);

    if (depth >= maxDepth || visited.has(name)) {
      return {
        name,
        version,
        ageInDays: ageInfo.age,
        isAbandoned: ageInfo.abandoned,
        depth,
        children: [],
      };
    }

    visited.add(name);

    let childDeps: Record<string, string> = {};
    try {
      const meta = cache.get(name) ?? await fetchCached(name, registryUrl, sem, cache);
      const latest = meta["dist-tags"]?.latest;
      if (latest && meta.versions?.[latest]?.dependencies) {
        childDeps = meta.versions[latest].dependencies!;
      }
    } catch {
      // no transitive deps available
    }

    const children: TreeNode[] = [];
    const entries = Object.entries(childDeps).filter(([n]) => !ignoreSet.has(n));

    await Promise.all(
      entries.map(async ([childName, childVer]) => {
        const child = await resolve(childName, childVer, depth + 1, new Set(visited));
        children.push(child);
      })
    );

    visited.delete(name);

    return {
      name,
      version,
      ageInDays: ageInfo.age,
      isAbandoned: ageInfo.abandoned,
      depth,
      children,
    };
  }

  const entries = Object.entries(directDeps).filter(([n]) => !ignoreSet.has(n));
  const roots: TreeNode[] = [];

  await Promise.all(
    entries.map(async ([name, ver]) => {
      const node = await resolve(name, ver, 0, new Set());
      roots.push(node);
    })
  );

  return roots.sort((a, b) => a.name.localeCompare(b.name));
}

async function fetchCached(
  name: string,
  registryUrl: string,
  sem: Semaphore,
  cache: Map<string, NpmPkgMeta>
): Promise<NpmPkgMeta> {
  if (cache.has(name)) return cache.get(name)!;
  await sem.acquire();
  try {
    const meta = await fetchPkgJson(name, registryUrl);
    cache.set(name, meta);
    return meta;
  } finally {
    sem.release();
  }
}

async function getAge(
  name: string,
  registryUrl: string,
  threshold: AbandonmentThreshold,
  sem: Semaphore,
  cache: Map<string, NpmPkgMeta>
): Promise<{ age: number; abandoned: boolean }> {
  try {
    const meta = await fetchCached(name, registryUrl, sem, cache);
    const latest = meta["dist-tags"]?.latest;
    if (!latest || !meta.time?.[latest]) return { age: 0, abandoned: false };
    const published = new Date(meta.time[latest]);
    const age = Math.floor((Date.now() - published.getTime()) / 86400000);
    return { age, abandoned: age >= threshold };
  } catch {
    return { age: 0, abandoned: false };
  }
}

/**
 * Generate summary statistics from a dependency tree.
 * @param tree - Array of root TreeNode objects from scanDependencyTree
 * @returns Summary with total/unique counts, max depth, abandoned paths, health score and grade
 */
export function summarizeTree(tree: ReadonlyArray<TreeNode>): TreeSummary {
  let totalPackages = 0;
  let maxDepth = 0;
  let abandonedCount = 0;
  const unique = new Set<string>();
  const abandonedPaths: string[][] = [];

  function walk(node: TreeNode, pathSoFar: string[]): void {
    totalPackages++;
    unique.add(node.name);
    if (node.depth > maxDepth) maxDepth = node.depth;

    const currentPath = [...pathSoFar, node.name];
    if (node.isAbandoned) {
      abandonedCount++;
      abandonedPaths.push(currentPath);
    }

    for (const child of node.children) {
      walk(child, currentPath);
    }
  }

  for (const root of tree) {
    walk(root, []);
  }

  const uniquePackages = unique.size;
  const abandonedRatio = uniquePackages > 0 ? abandonedCount / totalPackages : 0;
  const healthScore = Math.round(Math.max(0, Math.min(100, (1 - abandonedRatio) * 100)));

  const grade: TreeSummary['grade'] =
    healthScore >= 90 ? 'A' :
    healthScore >= 75 ? 'B' :
    healthScore >= 60 ? 'C' :
    healthScore >= 40 ? 'D' : 'F';

  return {
    totalPackages,
    uniquePackages,
    maxDepth,
    abandonedCount,
    abandonedPaths,
    healthScore,
    grade,
  };
}

/**
 * Format a dependency tree as an indented string for terminal display.
 * @param tree - Array of root TreeNode objects
 * @param options - Formatting options (color support)
 * @returns Formatted tree string
 */
export function formatTree(
  tree: ReadonlyArray<TreeNode>,
  options: { color?: boolean } = {}
): string {
  const lines: string[] = [];
  const RED = options.color ? '\x1b[31m' : '';
  const GREEN = options.color ? '\x1b[32m' : '';
  const DIM = options.color ? '\x1b[2m' : '';
  const RESET = options.color ? '\x1b[0m' : '';

  function render(node: TreeNode, prefix: string, isLast: boolean): void {
    const connector = isLast ? '└── ' : '├── ';
    const status = node.isAbandoned
      ? `${RED}ABANDONED (${node.ageInDays}d)${RESET}`
      : `${GREEN}${node.ageInDays}d${RESET}`;
    lines.push(`${prefix}${connector}${node.name}@${node.version} ${DIM}[${status}${DIM}]${RESET}`);

    const childPrefix = prefix + (isLast ? '    ' : '│   ');
    for (let i = 0; i < node.children.length; i++) {
      render(node.children[i], childPrefix, i === node.children.length - 1);
    }
  }

  for (let i = 0; i < tree.length; i++) {
    render(tree[i], '', i === tree.length - 1);
  }

  return lines.join('\n');
}
