import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';
import { scanDependencyTree, summarizeTree, formatTree } from '../src/tree-scanner';
import { createAbandonmentThreshold } from '../src/types';
import type { TreeNode } from '../src/types';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/** Helper to create a fake node_modules structure */
function createNodeModules(
  tmpDir: string,
  structure: Record<string, { version: string; deps?: Record<string, string> }>
): void {
  for (const [name, info] of Object.entries(structure)) {
    const pkgDir = path.join(tmpDir, 'node_modules', name);
    fs.mkdirSync(pkgDir, { recursive: true });
    fs.writeFileSync(
      path.join(pkgDir, 'package.json'),
      JSON.stringify({
        name,
        version: info.version,
        dependencies: info.deps ?? {},
      })
    );
  }
}

/** Mock fetch to return consistent age data */
function mockFetchWithAges(ages: Record<string, number>): void {
  globalThis.fetch = mock(async (url) => {
    const urlStr = url.toString();
    const match = urlStr.match(/\/([^/]+)$/);
    const name = match ? decodeURIComponent(match[1]) : 'unknown';
    const daysAgo = ages[name] ?? 1;
    const mockDate = new Date(Date.now() - daysAgo * 86400000).toISOString();
    return new Response(
      JSON.stringify({
        'dist-tags': { latest: '1.0.0' },
        versions: { '1.0.0': { version: '1.0.0' } },
        time: { modified: mockDate, created: mockDate, '1.0.0': mockDate },
      })
    );
  });
}

describe('dependency tree analysis', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dep-age-tree-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('scans direct dependencies and their transitive deps', async () => {
    const packagePath = path.join(tmpDir, 'package.json');
    fs.writeFileSync(
      packagePath,
      JSON.stringify({ dependencies: { alpha: '1.0.0', beta: '2.0.0' } })
    );

    createNodeModules(tmpDir, {
      alpha: { version: '1.0.0', deps: { gamma: '3.0.0' } },
      beta: { version: '2.0.0' },
      gamma: { version: '3.0.0' },
    });

    mockFetchWithAges({ alpha: 10, beta: 20, gamma: 30 });

    const tree = await scanDependencyTree({
      packageJsonPath: packagePath,
      maxDepth: 3,
    });

    expect(tree).toHaveLength(2);
    const alphaNode = tree.find((n) => n.name === 'alpha');
    expect(alphaNode).toBeDefined();
    expect(alphaNode!.children).toHaveLength(1);
    expect(alphaNode!.children[0].name).toBe('gamma');

    const betaNode = tree.find((n) => n.name === 'beta');
    expect(betaNode).toBeDefined();
    expect(betaNode!.children).toHaveLength(0);
  });

  it('detects abandoned packages in the tree and reports paths', async () => {
    const packagePath = path.join(tmpDir, 'package.json');
    fs.writeFileSync(
      packagePath,
      JSON.stringify({ dependencies: { fresh: '1.0.0', stale: '2.0.0' } })
    );

    createNodeModules(tmpDir, {
      fresh: { version: '1.0.0', deps: { deep_stale: '1.0.0' } },
      stale: { version: '2.0.0' },
      deep_stale: { version: '1.0.0' },
    });

    const threshold = createAbandonmentThreshold(100);
    mockFetchWithAges({ fresh: 10, stale: 200, deep_stale: 150 });

    const tree = await scanDependencyTree({
      packageJsonPath: packagePath,
      maxDepth: 3,
      abandonmentThreshold: threshold,
    });

    const summary = summarizeTree(tree);

    expect(summary.abandonedCount).toBe(2);
    expect(summary.abandonedPaths).toContainEqual(['stale']);
    expect(summary.abandonedPaths).toContainEqual(['fresh', 'deep_stale']);
    expect(summary.healthScore).toBeLessThan(100);
  });

  it('respects maxDepth and stops recursing', async () => {
    const packagePath = path.join(tmpDir, 'package.json');
    fs.writeFileSync(
      packagePath,
      JSON.stringify({ dependencies: { level0: '1.0.0' } })
    );

    createNodeModules(tmpDir, {
      level0: { version: '1.0.0', deps: { level1: '1.0.0' } },
      level1: { version: '1.0.0', deps: { level2: '1.0.0' } },
      level2: { version: '1.0.0' },
    });

    mockFetchWithAges({ level0: 5, level1: 5, level2: 5 });

    const tree = await scanDependencyTree({
      packageJsonPath: packagePath,
      maxDepth: 1,
    });

    expect(tree).toHaveLength(1);
    expect(tree[0].children).toHaveLength(1);
    // level2 should NOT appear because maxDepth=1 means only depth 0 and 1
    expect(tree[0].children[0].children).toHaveLength(0);
  });

  it('ignores specified packages in tree scan', async () => {
    const packagePath = path.join(tmpDir, 'package.json');
    fs.writeFileSync(
      packagePath,
      JSON.stringify({ dependencies: { keep: '1.0.0', skip: '2.0.0' } })
    );

    createNodeModules(tmpDir, {
      keep: { version: '1.0.0' },
      skip: { version: '2.0.0' },
    });

    mockFetchWithAges({ keep: 5, skip: 5 });

    const tree = await scanDependencyTree({
      packageJsonPath: packagePath,
      ignore: ['skip'],
    });

    expect(tree).toHaveLength(1);
    expect(tree[0].name).toBe('keep');
  });

  it('summarizeTree returns correct stats for empty tree', () => {
    const summary = summarizeTree([]);
    expect(summary.totalPackages).toBe(0);
    expect(summary.uniquePackages).toBe(0);
    expect(summary.maxDepth).toBe(0);
    expect(summary.abandonedCount).toBe(0);
    expect(summary.healthScore).toBe(100);
    expect(summary.grade).toBe('A');
  });

  it('formatTree renders text output correctly', () => {
    const tree: TreeNode[] = [
      {
        name: 'a',
        version: '1.0.0',
        ageInDays: 10,
        isAbandoned: false,
        depth: 0,
        children: [
          {
            name: 'b',
            version: '2.0.0',
            ageInDays: 800,
            isAbandoned: true,
            depth: 1,
            children: [],
          },
        ],
      },
    ];

    const output = formatTree(tree, { color: false });
    expect(output).toContain('a@1.0.0');
    expect(output).toContain('b@2.0.0');
    expect(output).toContain('ABANDONED');
    expect(output).toContain('10d');
  });

  it('formatTree renders JSON output', () => {
    const tree: TreeNode[] = [
      {
        name: 'x',
        version: '1.0.0',
        ageInDays: 5,
        isAbandoned: false,
        depth: 0,
        children: [],
      },
    ];

    const json = formatTree(tree, { format: 'json' });
    const parsed = JSON.parse(json);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].name).toBe('x');
  });
});
