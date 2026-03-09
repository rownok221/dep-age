import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';
import { scanDependencyTree, summarizeTree, formatTree } from '../src/tree-scanner';
import type { TreeNode } from '../src/types';
import { createAbandonmentThreshold } from '../src/types';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

describe('tree-scanner', () => {
  let tmpDir: string;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dep-age-tree-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    globalThis.fetch = originalFetch;
  });

  function mockRegistry(packages: Record<string, { deps?: Record<string, string>; ageDays?: number }>) {
    globalThis.fetch = mock(async (url) => {
      const urlStr = url.toString();
      for (const [name, info] of Object.entries(packages)) {
        if (urlStr.endsWith(`/${name}`) || urlStr.endsWith(`/${encodeURIComponent(name)}`)) {
          const publishDate = new Date(Date.now() - (info.ageDays ?? 1) * 86400000).toISOString();
          return new Response(JSON.stringify({
            'dist-tags': { latest: '1.0.0' },
            versions: {
              '1.0.0': {
                version: '1.0.0',
                dependencies: info.deps ?? {},
              },
            },
            time: { modified: publishDate, created: publishDate, '1.0.0': publishDate },
          }));
        }
      }
      return new Response(JSON.stringify({
        'dist-tags': { latest: '1.0.0' },
        versions: { '1.0.0': { version: '1.0.0', dependencies: {} } },
        time: { modified: new Date().toISOString(), created: new Date().toISOString(), '1.0.0': new Date().toISOString() },
      }));
    });
  }

  it('scans direct and transitive dependencies', async () => {
    const pkgPath = path.join(tmpDir, 'package.json');
    fs.writeFileSync(pkgPath, JSON.stringify({
      dependencies: { 'pkg-a': '1.0.0' },
    }));

    mockRegistry({
      'pkg-a': { deps: { 'pkg-b': '1.0.0' }, ageDays: 10 },
      'pkg-b': { deps: {}, ageDays: 20 },
    });

    const tree = await scanDependencyTree({
      packageJsonPath: pkgPath,
      maxDepth: 3,
    });

    expect(tree).toHaveLength(1);
    expect(tree[0].name).toBe('pkg-a');
    expect(tree[0].children).toHaveLength(1);
    expect(tree[0].children[0].name).toBe('pkg-b');
    expect(tree[0].children[0].children).toHaveLength(0);
  });

  it('respects maxDepth and stops recursing', async () => {
    const pkgPath = path.join(tmpDir, 'package.json');
    fs.writeFileSync(pkgPath, JSON.stringify({
      dependencies: { 'level0': '1.0.0' },
    }));

    mockRegistry({
      'level0': { deps: { 'level1': '1.0.0' }, ageDays: 5 },
      'level1': { deps: { 'level2': '1.0.0' }, ageDays: 5 },
      'level2': { deps: { 'level3': '1.0.0' }, ageDays: 5 },
      'level3': { deps: {}, ageDays: 5 },
    });

    const tree = await scanDependencyTree({
      packageJsonPath: pkgPath,
      maxDepth: 2,
    });

    expect(tree[0].name).toBe('level0');
    expect(tree[0].children[0].name).toBe('level1');
    // level1 is at depth 1, its child level2 would be depth 2 = maxDepth, so no children
    expect(tree[0].children[0].children[0].name).toBe('level2');
    expect(tree[0].children[0].children[0].children).toHaveLength(0);
  });

  it('detects abandoned packages in the tree and summarizes correctly', async () => {
    const pkgPath = path.join(tmpDir, 'package.json');
    fs.writeFileSync(pkgPath, JSON.stringify({
      dependencies: { 'fresh-pkg': '1.0.0', 'old-pkg': '1.0.0' },
    }));

    const threshold = createAbandonmentThreshold(100);

    mockRegistry({
      'fresh-pkg': { deps: { 'also-fresh': '1.0.0' }, ageDays: 10 },
      'also-fresh': { deps: {}, ageDays: 20 },
      'old-pkg': { deps: { 'ancient': '1.0.0' }, ageDays: 200 },
      'ancient': { deps: {}, ageDays: 500 },
    });

    const tree = await scanDependencyTree({
      packageJsonPath: pkgPath,
      maxDepth: 3,
      abandonmentThreshold: threshold,
    });

    const summary = summarizeTree(tree);

    expect(summary.totalPackages).toBe(4);
    expect(summary.uniquePackages).toBe(4);
    expect(summary.abandonedCount).toBe(2); // old-pkg + ancient
    expect(summary.abandonedPaths.length).toBe(2);
    expect(summary.healthScore).toBeLessThanOrEqual(75);
    expect(summary.grade).not.toBe('A');
  });

  it('ignores specified packages in the tree', async () => {
    const pkgPath = path.join(tmpDir, 'package.json');
    fs.writeFileSync(pkgPath, JSON.stringify({
      dependencies: { 'keep-me': '1.0.0', 'skip-me': '1.0.0' },
    }));

    mockRegistry({
      'keep-me': { deps: {}, ageDays: 5 },
      'skip-me': { deps: {}, ageDays: 5 },
    });

    const tree = await scanDependencyTree({
      packageJsonPath: pkgPath,
      ignore: ['skip-me'],
    });

    expect(tree).toHaveLength(1);
    expect(tree[0].name).toBe('keep-me');
  });

  it('handles circular dependencies without infinite loops', async () => {
    const pkgPath = path.join(tmpDir, 'package.json');
    fs.writeFileSync(pkgPath, JSON.stringify({
      dependencies: { 'circular-a': '1.0.0' },
    }));

    mockRegistry({
      'circular-a': { deps: { 'circular-b': '1.0.0' }, ageDays: 5 },
      'circular-b': { deps: { 'circular-a': '1.0.0' }, ageDays: 5 },
    });

    const tree = await scanDependencyTree({
      packageJsonPath: pkgPath,
      maxDepth: 10,
    });

    // Should terminate without hanging
    expect(tree).toHaveLength(1);
    expect(tree[0].name).toBe('circular-a');
    expect(tree[0].children[0].name).toBe('circular-b');
    // circular-b tries to resolve circular-a but it's already visited, so no children
    expect(tree[0].children[0].children).toHaveLength(0);
  });

  describe('summarizeTree', () => {
    it('returns perfect score for empty tree', () => {
      const summary = summarizeTree([]);
      expect(summary.totalPackages).toBe(0);
      expect(summary.healthScore).toBe(100);
      expect(summary.grade).toBe('A');
    });
  });

  describe('formatTree', () => {
    it('renders tree with connectors', () => {
      const tree: TreeNode[] = [
        {
          name: 'root-pkg',
          version: '1.0.0',
          ageInDays: 10,
          isAbandoned: false,
          depth: 0,
          children: [
            {
              name: 'child-pkg',
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
      expect(output).toContain('root-pkg@1.0.0');
      expect(output).toContain('child-pkg@2.0.0');
      expect(output).toContain('ABANDONED');
      expect(output).toContain('└──');
    });
  });
});
