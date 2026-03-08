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

  // ... rest of existing tests
});

// ... rest of test file