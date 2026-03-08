import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';
import { scanDependencies, generateReport, calculateHealthScore, type ScanResult, type DependencyInfo, createAbandonmentThreshold } from '../src/index';
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

  it('uses custom npm registry when specified', async () => {
    const packagePath = path.join(tmpDir, 'package.json');
    fs.writeFileSync(packagePath, JSON.stringify({
      dependencies: { custompkg: '1.0.0' }
    }));

    const mockDate = new Date(Date.now() - 86400000).toISOString();
    let fetchedUrl = '';
    globalThis.fetch = mock(async (url) => {
      fetchedUrl = url.toString();
      return new Response(JSON.stringify({
        'dist-tags': { latest: '1.2.0' },
        versions: { '1.2.0': { version: '1.2.0' } },
        time: { modified: mockDate, created: mockDate, '1.2.0': mockDate }
      }));
    });

    const customRegistry = 'https://custom.registry/';
    await scanDependencies({ 
      packageJsonPath: packagePath,
      registryUrl: customRegistry
    });

    expect(fetchedUrl).toStartWith(customRegistry);
    expect(fetchedUrl).toInclude('custompkg');
  });

  it('ignores specified dependencies', async () => {
    const packagePath = path.join(tmpDir, 'package.json');
    fs.writeFileSync(packagePath, JSON.stringify({
      dependencies: { 
        pkg1: '1.0.0',
        pkg2: '2.0.0',
        pkg3: '3.0.0'
      }
    }));

    const fetchedPackages: string[] = [];
    globalThis.fetch = mock(async (url) => {
      const urlStr = url.toString();
      const match = urlStr.match(/\/([^\/]+)$/);
      if (match) fetchedPackages.push(match[1]);
      
      const mockDate = new Date(Date.now() - 86400000).toISOString();
      return new Response(JSON.stringify({
        'dist-tags': { latest: '1.0.0' },
        versions: { '1.0.0': { version: '1.0.0' } },
        time: { modified: mockDate, created: mockDate, '1.0.0': mockDate }
      }));
    });

    const result = await scanDependencies({ 
      packageJsonPath: packagePath,
      ignore: ['pkg2']
    });

    expect(fetchedPackages).not.toContain('pkg2');
    expect(fetchedPackages).toContain('pkg1');
    expect(fetchedPackages).toContain('pkg3');
    expect(result['pkg2']).toBeUndefined();
    expect(result['pkg1']).toBeDefined();
    expect(result['pkg3']).toBeDefined();
  });

  it('ignores multiple dependencies', async () => {
    const packagePath = path.join(tmpDir, 'package.json');
    fs.writeFileSync(packagePath, JSON.stringify({
      dependencies: { 
        keep1: '1.0.0',
        ignore1: '2.0.0',
        keep2: '3.0.0',
        ignore2: '4.0.0'
      }
    }));

    const fetchedPackages: string[] = [];
    globalThis.fetch = mock(async (url) => {
      const urlStr = url.toString();
      const match = urlStr.match(/\/([^\/]+)$/);
      if (match) fetchedPackages.push(match[1]);
      
      const mockDate = new Date(Date.now() - 86400000).toISOString();
      return new Response(JSON.stringify({
        'dist-tags': { latest: '1.0.0' },
        versions: { '1.0.0': { version: '1.0.0' } },
        time: { modified: mockDate, created: mockDate, '1.0.0': mockDate }
      }));
    });

    const result = await scanDependencies({ 
      packageJsonPath: packagePath,
      ignore: ['ignore1', 'ignore2']
    });

    expect(fetchedPackages).toContain('keep1');
    expect(fetchedPackages).toContain('keep2');
    expect(fetchedPackages).not.toContain('ignore1');
    expect(fetchedPackages).not.toContain('ignore2');
    expect(Object.keys(result)).toHaveLength(2);
    expect(result['keep1']).toBeDefined();
    expect(result['keep2']).toBeDefined();
    expect(result['ignore1']).toBeUndefined();
    expect(result['ignore2']).toBeUndefined();
  });
});