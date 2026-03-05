import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';
import { scanDependencies, generateReport, type ScanResult, type DependencyInfo, createAbandonmentThreshold } from '../src/index';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

describe('dep-age', () => {
  let tmpDir: string;
  
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dep-age-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('scans valid package.json and returns structured results', async () => {
    const packagePath = path.join(tmpDir, 'package.json');
    fs.writeFileSync(packagePath, JSON.stringify({
      dependencies: { fresh: '1.0.0', recent: '2.1.3' }
    }));

    const mockDate = new Date(Date.now() - 86400000).toISOString();
    globalThis.fetch = async (url) => {
      const pkg = url.toString().split('/').pop()!;
      return new Response(JSON.stringify({
        'dist-tags': { latest: pkg === 'fresh' ? '1.2.0' : '2.2.0' },
        time: { modified: mockDate, created: mockDate, [pkg === 'fresh' ? '1.0.0' : '2.1.3']: mockDate }
      }));
    };

    const result = await scanDependencies({ packageJsonPath: packagePath });
    expect(Object.keys(result)).toHaveLength(2);
    expect(result.fresh?.ageInDays).toBeGreaterThan(0);
    expect(result.recent?.latestVersion).toMatch(/2\.\d+\.\d+/);
  });

  it('throws informative error for missing package.json', async () => {
    const badPath = path.join(tmpDir, 'nonexistent.json');
    await expect(scanDependencies({ packageJsonPath: badPath }))
      .rejects.toThrow(`ENOENT: no such file or directory, open '${badPath}'`);
  });

  it('flags packages older than abandonment threshold', async () => {
    const packagePath = path.join(tmpDir, 'package.json');
    fs.writeFileSync(packagePath, JSON.stringify({ dependencies: { ancient: '0.1.0' } }));

    const oldDate = new Date(Date.now() - 86400000 * 731).toISOString();
    globalThis.fetch = async () => new Response(JSON.stringify({
      'dist-tags': { latest: '5.0.0' },
      time: { modified: oldDate, created: oldDate, '0.1.0': oldDate }
    }));

    const result = await scanDependencies({
      packageJsonPath: packagePath,
      abandonmentThreshold: createAbandonmentThreshold(730)
    });

    expect(result.ancient?.isAbandoned).toBe(true);
  });

  it('generates valid reports in all formats', () => {
    const mockResult: ScanResult = {
      testpkg: {
        name: 'testpkg',
        currentVersion: '1.0.0',
        publishedDate: new Date(Date.now() - 86400000),
        ageInDays: 1,
        isAbandoned: false,
        alternatives: ['newpkg']
      }
    };

    expect(generateReport(mockResult, { format: 'text' })).toInclude('testpkg');
    expect(JSON.parse(generateReport(mockResult, { format: 'json' }))).toBeArray();
    expect(generateReport(mockResult, { format: 'markdown' })).toInclude('| testpkg |');
  });

  it('handles registry fetch errors gracefully', async () => {
    const packagePath = path.join(tmpDir, 'package.json');
    fs.writeFileSync(packagePath, JSON.stringify({ dependencies: { errorpkg: '3.0.0' } }));

    globalThis.fetch = async () => { throw new Error('Simulated network failure'); };
    const result = await scanDependencies({ packageJsonPath: packagePath });

    expect(Object.keys(result)).toHaveLength(0);
  });
});