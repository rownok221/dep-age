import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import { createViewerApp, startViewer } from "../src/viewer";
import type { TreeNode } from "../src/types";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

describe("Interactive Dependency Tree Viewer", () => {
  let tmpDir: string;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dep-age-viewer-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    globalThis.fetch = originalFetch;
  });

  function createMockPackage(name: string, version: string, deps: Record<string, string> = {}) {
    const pkgDir = path.join(tmpDir, "node_modules", name);
    fs.mkdirSync(pkgDir, { recursive: true });
    fs.writeFileSync(
      path.join(pkgDir, "package.json"),
      JSON.stringify({ name, version, dependencies: deps })
    );
  }

  function mockRegistry(packages: Record<string, { deps?: Record<string, string>; ageDays?: number }>) {
    globalThis.fetch = mock(async (url) => {
      const urlStr = url.toString();
      for (const [name, info] of Object.entries(packages)) {
        if (urlStr.endsWith(`/${name}`) || urlStr.endsWith(`/${encodeURIComponent(name)}`)) {
          const publishDate = new Date(Date.now() - (info.ageDays ?? 1) * 86400000).toISOString();
          return new Response(JSON.stringify({
            "dist-tags": { latest: "1.0.0" },
            versions: {
              "1.0.0": {
                version: "1.0.0",
                dependencies: info.deps ?? {},
              },
            },
            time: { modified: publishDate, created: publishDate, "1.0.0": publishDate },
          }));
        }
      }
      return new Response("Not found", { status: 404 });
    });
  }

  it("should create viewer app and serve HTML interface", async () => {
    const pkgPath = path.join(tmpDir, "package.json");
    fs.writeFileSync(pkgPath, JSON.stringify({
      dependencies: { "test-pkg": "1.0.0" },
    }));

    createMockPackage("test-pkg", "1.0.0");
    mockRegistry({ "test-pkg": { ageDays: 10 } });

    const app = await createViewerApp({
      packageJsonPath: pkgPath,
      port: 0,
    });

    const req = new Request("http://localhost/");
    const res = await app.fetch(req);
    
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("dep-age");
    expect(html).toContain("Interactive Dependency Tree");
    expect(html).toContain("test-pkg");
  });

  it("should provide tree data via API endpoint", async () => {
    const pkgPath = path.join(tmpDir, "package.json");
    fs.writeFileSync(pkgPath, JSON.stringify({
      dependencies: { "parent": "1.0.0" },
    }));

    createMockPackage("parent", "1.0.0", { "child": "1.0.0" });
    createMockPackage("child", "1.0.0");
    
    mockRegistry({
      "parent": { deps: { "child": "1.0.0" }, ageDays: 20 },
      "child": { deps: {}, ageDays: 30 },
    });

    const app = await createViewerApp({
      packageJsonPath: pkgPath,
      port: 0,
    });

    const req = new Request("http://localhost/api/tree");
    const res = await app.fetch(req);
    
    expect(res.status).toBe(200);
    const data = await res.json();
    
    expect(data.tree).toBeDefined();
    expect(data.tree).toHaveLength(1);
    expect(data.tree[0].name).toBe("parent");
    expect(data.tree[0].children).toHaveLength(1);
    expect(data.tree[0].children[0].name).toBe("child");
    expect(data.health).toBeDefined();
    expect(data.summary).toBeDefined();
  });

  it("should filter tree by minimum health score", async () => {
    const pkgPath = path.join(tmpDir, "package.json");
    fs.writeFileSync(pkgPath, JSON.stringify({
      dependencies: { "fresh": "1.0.0", "old": "1.0.0" },
    }));

    createMockPackage("fresh", "1.0.0");
    createMockPackage("old", "1.0.0");
    
    mockRegistry({
      "fresh": { deps: {}, ageDays: 10 },
      "old": { deps: {}, ageDays: 800 },
    });

    const app = await createViewerApp({
      packageJsonPath: pkgPath,
      port: 0,
      abandonmentThreshold: 730,
    });

    // Filter for health score >= 50
    const req = new Request("http://localhost/api/tree?minHealth=50");
    const res = await app.fetch(req);
    
    expect(res.status).toBe(200);
    const data = await res.json();
    
    // Should only include fresh package (health > 50%)
    expect(data.tree).toHaveLength(1);
    expect(data.tree[0].name).toBe("fresh");
  });

  it("should filter tree to show only abandoned packages", async () => {
    const pkgPath = path.join(tmpDir, "package.json");
    fs.writeFileSync(pkgPath, JSON.stringify({
      dependencies: { "active": "1.0.0", "abandoned": "1.0.0" },
    }));

    createMockPackage("active", "1.0.0");
    createMockPackage("abandoned", "1.0.0");
    
    mockRegistry({
      "active": { deps: {}, ageDays: 30 },
      "abandoned": { deps: {}, ageDays: 800 },
    });

    const app = await createViewerApp({
      packageJsonPath: pkgPath,
      port: 0,
      abandonmentThreshold: 730,
    });

    const req = new Request("http://localhost/api/tree?abandonedOnly=true");
    const res = await app.fetch(req);
    
    expect(res.status).toBe(200);
    const data = await res.json();
    
    expect(data.tree).toHaveLength(1);
    expect(data.tree[0].name).toBe("abandoned");
    expect(data.tree[0].isAbandoned).toBe(true);
  });

  it("should search tree by package name", async () => {
    const pkgPath = path.join(tmpDir, "package.json");
    fs.writeFileSync(pkgPath, JSON.stringify({
      dependencies: { "alpha": "1.0.0", "beta": "1.0.0" },
    }));

    createMockPackage("alpha", "1.0.0");
    createMockPackage("beta", "1.0.0");
    
    mockRegistry({
      "alpha": { deps: {}, ageDays: 10 },
      "beta": { deps: {}, ageDays: 10 },
    });

    const app = await createViewerApp({
      packageJsonPath: pkgPath,
      port: 0,
    });

    const req = new Request("http://localhost/api/tree?search=alp");
    const res = await app.fetch(req);
    
    expect(res.status).toBe(200);
    const data = await res.json();
    
    expect(data.tree).toHaveLength(1);
    expect(data.tree[0].name).toBe("alpha");
  });

  it("should provide health data via API endpoint", async () => {
    const pkgPath = path.join(tmpDir, "package.json");
    fs.writeFileSync(pkgPath, JSON.stringify({
      dependencies: { "pkg-a": "1.0.0" },
    }));

    createMockPackage("pkg-a", "1.0.0");
    mockRegistry({ "pkg-a": { ageDays: 10 } });

    const app = await createViewerApp({
      packageJsonPath: pkgPath,
      port: 0,
    });

    const req = new Request("http://localhost/api/health");
    const res = await app.fetch(req);
    
    expect(res.status).toBe(200);
    const health = await res.json();
    
    expect(health.score).toBeDefined();
    expect(health.grade).toBeDefined();
    expect(health.totalDeps).toBe(1);
  });

  it("should start viewer server on specified port", async () => {
    const pkgPath = path.join(tmpDir, "package.json");
    fs.writeFileSync(pkgPath, JSON.stringify({
      dependencies: {},
    }));

    const viewer = await startViewer({
      packageJsonPath: pkgPath,
      port: 0, // Random available port
      openBrowser: false,
    });

    expect(viewer.url).toContain("http://localhost:");
    expect(viewer.stop).toBeFunction();

    viewer.stop();
  });

  it("should enrich tree nodes with health scores", async () => {
    const pkgPath = path.join(tmpDir, "package.json");
    fs.writeFileSync(pkgPath, JSON.stringify({
      dependencies: { "aging-pkg": "1.0.0" },
    }));

    createMockPackage("aging-pkg", "1.0.0");
    
    // 400 days old with 730 threshold = ~54% ratio = "aging" category
    mockRegistry({
      "aging-pkg": { deps: {}, ageDays: 400 },
    });

    const app = await createViewerApp({
      packageJsonPath: pkgPath,
      port: 0,
      abandonmentThreshold: 730,
    });

    const req = new Request("http://localhost/api/tree");
    const res = await app.fetch(req);
    
    const data = await res.json();
    expect(data.tree[0].healthScore).toBe(50); // aging = 50%
    expect(data.tree[0].healthCategory).toBe("aging");
  });
});
