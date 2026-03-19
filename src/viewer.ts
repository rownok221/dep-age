import { Hono } from "hono";
import { scanDependencyTree, summarizeTree } from "./tree-scanner";
import { calculateHealthScore } from "./health";
import type {
  TreeNode,
  TreeScanOptions,
  TreeSummary,
  HealthScore,
} from "./types";
import { DEFAULT_ABANDONMENT_THRESHOLD } from "./types";

export interface ViewerOptions extends TreeScanOptions {
  port?: number;
  openBrowser?: boolean;
}

interface TreeNodeWithHealth extends TreeNode {
  healthScore: number;
  healthCategory: "excellent" | "good" | "aging" | "old" | "abandoned";
}

interface ViewerState {
  tree: TreeNodeWithHealth[];
  summary: TreeSummary;
  health: HealthScore;
  timestamp: number;
}

/**
 * Calculate health category for a single node based on age
 */
function calculateNodeHealth(
  node: TreeNode,
  threshold: number
): { score: number; category: TreeNodeWithHealth["healthCategory"] } {
  if (node.isAbandoned) return { score: 0, category: "abandoned" };
  
  const ratio = node.ageInDays / threshold;
  if (ratio < 0.25) return { score: 100, category: "excellent" };
  if (ratio < 0.5) return { score: 75, category: "good" };
  if (ratio < 0.75) return { score: 50, category: "aging" };
  return { score: 25, category: "old" };
}

/**
 * Enrich tree nodes with health scores
 */
function enrichTreeWithHealth(
  nodes: TreeNode[],
  threshold: number
): TreeNodeWithHealth[] {
  return nodes.map((node) => {
    const { score, category } = calculateNodeHealth(node, threshold);
    return {
      ...node,
      healthScore: score,
      healthCategory: category,
      children: enrichTreeWithHealth([...node.children], threshold),
    };
  });
}

/**
 * Filter tree by minimum health score
 */
function filterTreeByHealth(
  nodes: TreeNodeWithHealth[],
  minHealth: number
): TreeNodeWithHealth[] {
  return nodes
    .filter((node) => node.healthScore >= minHealth)
    .map((node) => ({
      ...node,
      children: filterTreeByHealth(node.children, minHealth),
    }));
}

/**
 * Filter tree to show only abandoned packages
 */
function filterTreeByAbandoned(
  nodes: TreeNodeWithHealth[]
): TreeNodeWithHealth[] {
  const result: TreeNodeWithHealth[] = [];
  
  for (const node of nodes) {
    const filteredChildren = filterTreeByAbandoned(node.children);
    if (node.healthCategory === "abandoned" || filteredChildren.length > 0) {
      result.push({
        ...node,
        children: filteredChildren,
      });
    }
  }
  
  return result;
}

/**
 * Search tree by package name
 */
function searchTree(
  nodes: TreeNodeWithHealth[],
  query: string
): TreeNodeWithHealth[] {
  if (!query) return nodes;
  
  const lowerQuery = query.toLowerCase();
  return nodes
    .map((node) => ({
      ...node,
      children: searchTree(node.children, query),
    }))
    .filter(
      (node) =>
        node.name.toLowerCase().includes(lowerQuery) ||
        node.children.length > 0
    );
}

/**
 * Generate HTML for the interactive viewer interface
 */
function generateViewerHTML(state: ViewerState): string {
  const colors = {
    excellent: "#22c55e",
    good: "#84cc16",
    aging: "#eab308",
    old: "#f97316",
    abandoned: "#ef4444",
  };

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>dep-age - Interactive Dependency Tree</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #0f172a;
      color: #e2e8f0;
      height: 100vh;
      overflow: hidden;
    }
    .container {
      display: grid;
      grid-template-columns: 300px 1fr 350px;
      height: 100vh;
    }
    .sidebar {
      background: #1e293b;
      padding: 1.5rem;
      overflow-y: auto;
      border-right: 1px solid #334155;
    }
    .main {
      overflow-y: auto;
      padding: 1.5rem;
    }
    .details {
      background: #1e293b;
      padding: 1.5rem;
      overflow-y: auto;
      border-left: 1px solid #334155;
    }
    h1 { font-size: 1.25rem; margin-bottom: 0.5rem; color: #f8fafc; }
    h2 { font-size: 1rem; margin: 1.5rem 0 0.75rem; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.05em; }
    .stats-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 1rem;
      margin-bottom: 1.5rem;
    }
    .stat-card {
      background: #334155;
      padding: 1rem;
      border-radius: 0.5rem;
      text-align: center;
    }
    .stat-value {
      font-size: 1.5rem;
      font-weight: bold;
      color: #f8fafc;
    }
    .stat-label {
      font-size: 0.75rem;
      color: #94a3b8;
      margin-top: 0.25rem;
    }
    .grade-${state.health.grade} { color: ${state.health.grade === 'A' ? '#22c55e' : state.health.grade === 'B' ? '#84cc16' : state.health.grade === 'C' ? '#eab308' : state.health.grade === 'D' ? '#f97316' : '#ef4444'}; }
    .filter-group { margin-bottom: 1rem; }
    .filter-group label {
      display: block;
      font-size: 0.875rem;
      color: #94a3b8;
      margin-bottom: 0.5rem;
    }
    input[type="range"] {
      width: 100%;
      accent-color: #3b82f6;
    }
    input[type="text"], input[type="number"] {
      width: 100%;
      padding: 0.5rem;
      background: #334155;
      border: 1px solid #475569;
      border-radius: 0.375rem;
      color: #f8fafc;
    }
    .checkbox-wrapper {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    input[type="checkbox"] {
      accent-color: #3b82f6;
    }
    .tree-node {
      margin-left: 1.5rem;
      border-left: 2px solid #334155;
      padding-left: 0.75rem;
      margin-top: 0.5rem;
    }
    .tree-node-content {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.5rem;
      border-radius: 0.375rem;
      cursor: pointer;
      transition: background 0.2s;
    }
    .tree-node-content:hover {
      background: #334155;
    }
    .tree-node-content.active {
      background: #3b82f6;
    }
    .toggle-btn {
      width: 1.25rem;
      height: 1.25rem;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      color: #94a3b8;
      font-size: 0.75rem;
    }
    .toggle-btn.leaf { visibility: hidden; }
    .health-indicator {
      width: 0.75rem;
      height: 0.75rem;
      border-radius: 50%;
      flex-shrink: 0;
    }
    .pkg-name { font-weight: 500; }
    .pkg-version { color: #94a3b8; font-size: 0.875rem; }
    .pkg-age { color: #64748b; font-size: 0.75rem; margin-left: auto; }
    .legend {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      margin-top: 1rem;
    }
    .legend-item {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      font-size: 0.875rem;
    }
    .legend-color {
      width: 1rem;
      height: 1rem;
      border-radius: 0.25rem;
    }
    .detail-row {
      display: flex;
      justify-content: space-between;
      padding: 0.75rem 0;
      border-bottom: 1px solid #334155;
    }
    .detail-label { color: #94a3b8; }
    .detail-value { font-weight: 500; }
    .abandoned-badge {
      background: #ef4444;
      color: white;
      padding: 0.25rem 0.5rem;
      border-radius: 0.25rem;
      font-size: 0.75rem;
      font-weight: bold;
    }
    .refresh-btn {
      width: 100%;
      padding: 0.75rem;
      background: #3b82f6;
      color: white;
      border: none;
      border-radius: 0.375rem;
      cursor: pointer;
      font-weight: 500;
      margin-top: 1rem;
    }
    .refresh-btn:hover { background: #2563eb; }
    .hidden { display: none; }
    .collapsed > .tree-node { display: none; }
    #chart-container {
      height: 200px;
      margin-bottom: 1.5rem;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="sidebar">
      <h1>🔍 dep-age</h1>
      <p style="color: #64748b; font-size: 0.875rem; margin-bottom: 1.5rem;">Interactive Dependency Tree</p>
      
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-value grade-${state.health.grade}">${state.health.grade}</div>
          <div class="stat-label">Health Grade</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${state.health.score}%</div>
          <div class="stat-label">Health Score</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${state.summary.totalPackages}</div>
          <div class="stat-label">Total Packages</div>
        </div>
        <div class="stat-card">
          <div class="stat-value" style="color: ${state.summary.abandonedCount > 0 ? '#ef4444' : '#22c55e'}">${state.summary.abandonedCount}</div>
          <div class="stat-label">Abandoned</div>
        </div>
      </div>

      <div id="chart-container">
        <canvas id="healthChart"></canvas>
      </div>

      <h2>Filters</h2>
      
      <div class="filter-group">
        <label>Min Health Score: <span id="healthValue">0</span>%</label>
        <input type="range" id="healthFilter" min="0" max="100" value="0">
      </div>

      <div class="filter-group">
        <div class="checkbox-wrapper">
          <input type="checkbox" id="abandonedOnly">
          <label for="abandonedOnly" style="margin: 0;">Abandoned Only</label>
        </div>
      </div>

      <div class="filter-group">
        <label>Search Packages</label>
        <input type="text" id="searchFilter" placeholder="Filter by name...">
      </div>

      <h2>Legend</h2>
      <div class="legend">
        <div class="legend-item">
          <div class="legend-color" style="background: ${colors.excellent}"></div>
          <span>Excellent (&lt;25% threshold)</span>
        </div>
        <div class="legend-item">
          <div class="legend-color" style="background: ${colors.good}"></div>
          <span>Good (&lt;50% threshold)</span>
        </div>
        <div class="legend-item">
          <div class="legend-color" style="background: ${colors.aging}"></div>
          <span>Aging (&lt;75% threshold)</span>
        </div>
        <div class="legend-item">
          <div class="legend-color" style="background: ${colors.old}"></div>
          <span>Old (&lt;100% threshold)</span>
        </div>
        <div class="legend-item">
          <div class="legend-color" style="background: ${colors.abandoned}"></div>
          <span>Abandoned (≥threshold)</span>
        </div>
      </div>

      <button class="refresh-btn" onclick="refreshData()">🔄 Refresh Data</button>
    </div>

    <div class="main" id="treeContainer">
      <!-- Tree rendered here -->
    </div>

    <div class="details" id="detailsPanel">
      <h2>Package Details</h2>
      <p style="color: #64748b; font-size: 0.875rem;">Select a package to view details</p>
    </div>
  </div>

  <script>
    const colors = ${JSON.stringify(colors)};
    let treeData = ${JSON.stringify(state.tree)};
    let selectedNode = null;

    // Initialize chart
    const ctx = document.getElementById('healthChart').getContext('2d');
    new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: ['Excellent', 'Good', 'Aging', 'Old', 'Abandoned'],
        datasets: [{
          data: [
            ${state.health.veryFreshCount},
            ${state.health.freshCount},
            ${state.health.agingCount},
            ${state.health.oldCount},
            ${state.health.abandonedCount}
          ],
          backgroundColor: [colors.excellent, colors.good, colors.aging, colors.old, colors.abandoned],
          borderWidth: 0
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false }
        }
      }
    });

    function renderNode(node, isRoot = false) {
      const hasChildren = node.children && node.children.length > 0;
      const healthColor = colors[node.healthCategory];
      
      let html = '<div class="tree-node" style="margin-left: ' + (isRoot ? '0' : '1.5rem') + '">';
      html += '<div class="tree-node-content" data-name="' + node.name + '" onclick="selectNode(this, ' + "'" + node.name + "'" + ')">';
      html += '<span class="toggle-btn ' + (hasChildren ? '' : 'leaf') + '" onclick="toggleNode(event, this)">▼</span>';
      html += '<div class="health-indicator" style="background: ' + healthColor + '"></div>';
      html += '<span class="pkg-name">' + node.name + '</span>';
      html += '<span class="pkg-version">@' + node.version + '</span>';
      if (node.isAbandoned) {
        html += '<span class="abandoned-badge">ABANDONED</span>';
      }
      html += '<span class="pkg-age">' + node.ageInDays + 'd</span>';
      html += '</div>';
      
      if (hasChildren) {
        html += '<div class="children">';
        node.children.forEach(child => {
          html += renderNode(child);
        });
        html += '</div>';
      }
      
      html += '</div>';
      return html;
    }

    function renderTree() {
      const container = document.getElementById('treeContainer');
      container.innerHTML = treeData.map(node => renderNode(node, true)).join('');
    }

    function toggleNode(event, btn) {
      event.stopPropagation();
      const node = btn.closest('.tree-node');
      node.classList.toggle('collapsed');
      btn.textContent = node.classList.contains('collapsed') ? '▶' : '▼';
    }

    function selectNode(el, name) {
      document.querySelectorAll('.tree-node-content').forEach(n => n.classList.remove('active'));
      el.classList.add('active');
      
      const node = findNode(treeData, name);
      if (node) {
        showDetails(node);
      }
    }

    function findNode(nodes, name) {
      for (const node of nodes) {
        if (node.name === name) return node;
        const found = findNode(node.children, name);
        if (found) return found;
      }
      return null;
    }

    function showDetails(node) {
      const panel = document.getElementById('detailsPanel');
      const healthColor = colors[node.healthCategory];
      
      panel.innerHTML = \`
        <h2>Package Details</h2>
        <div class="detail-row">
          <span class="detail-label">Name</span>
          <span class="detail-value">\${node.name}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Version</span>
          <span class="detail-value">\${node.version}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Health Score</span>
          <span class="detail-value" style="color: \${healthColor}">\${node.healthScore}%</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Status</span>
          <span class="detail-value" style="color: \${healthColor}; text-transform: uppercase;">\${node.healthCategory}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Age</span>
          <span class="detail-value">\${node.ageInDays} days</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Depth</span>
          <span class="detail-value">\${node.depth}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Dependencies</span>
          <span class="detail-value">\${node.children.length}</span>
        </div>
        \${node.isAbandoned ? '<div style="margin-top: 1rem; padding: 1rem; background: rgba(239, 68, 68, 0.1); border: 1px solid #ef4444; border-radius: 0.375rem; color: #ef4444; font-size: 0.875rem;">⚠️ This package appears to be abandoned. Consider finding an alternative.</div>' : ''}
      \`;
    }

    async function refreshData() {
      const btn = document.querySelector('.refresh-btn');
      btn.textContent = '⏳ Loading...';
      btn.disabled = true;
      
      try {
        const response = await fetch('/api/tree');
        const data = await response.json();
        treeData = data.tree;
        applyFilters();
      } catch (err) {
        alert('Failed to refresh data');
      } finally {
        btn.textContent = '🔄 Refresh Data';
        btn.disabled = false;
      }
    }

    function applyFilters() {
      const minHealth = parseInt(document.getElementById('healthFilter').value);
      const abandonedOnly = document.getElementById('abandonedOnly').checked;
      const search = document.getElementById('searchFilter').value;
      
      document.getElementById('healthValue').textContent = minHealth;
      
      let filtered = JSON.parse(JSON.stringify(treeData));
      
      if (abandonedOnly) {
        filtered = filtered.filter(n => n.healthCategory === 'abandoned' || n.children.some(c => c.healthCategory === 'abandoned'));
      }
      
      filtered = filtered.filter(n => n.healthScore >= minHealth);
      
      if (search) {
        const searchLower = search.toLowerCase();
        filtered = filtered.filter(n => n.name.toLowerCase().includes(searchLower));
      }
      
      const container = document.getElementById('treeContainer');
      container.innerHTML = filtered.map(node => renderNode(node, true)).join('');
    }

    document.getElementById('healthFilter').addEventListener('input', applyFilters);
    document.getElementById('abandonedOnly').addEventListener('change', applyFilters);
    document.getElementById('searchFilter').addEventListener('input', applyFilters);

    renderTree();
  </script>
</body>
</html>`;
}

/**
 * Create Hono app for the interactive viewer
 * @param options - Viewer configuration options
 * @returns Configured Hono application
 */
export async function createViewerApp(
  options: ViewerOptions
): Promise<Hono> {
  const app = new Hono();
  let cachedState: ViewerState | null = null;
  let cacheTime = 0;
  const CACHE_TTL = 30000; // 30 seconds

  const threshold =
    options.abandonmentThreshold ?? DEFAULT_ABANDONMENT_THRESHOLD;

  async function getTreeData(): Promise<ViewerState> {
    const now = Date.now();
    if (cachedState && now - cacheTime < CACHE_TTL) {
      return cachedState;
    }

    const tree = await scanDependencyTree(options);
    const enrichedTree = enrichTreeWithHealth(tree, threshold);
    const summary = summarizeTree(tree);
    const flatResult: Record<string, any> = {};
    
    // Convert tree to flat format for health calculation
    const flatten = (nodes: TreeNode[]) => {
      for (const node of nodes) {
        flatResult[node.name] = {
          name: node.name,
          currentVersion: node.version,
          publishedDate: new Date(Date.now() - node.ageInDays * 86400000),
          ageInDays: node.ageInDays,
          isAbandoned: node.isAbandoned,
        };
        flatten([...node.children]);
      }
    };
    flatten(tree);

    const health = calculateHealthScore(flatResult, threshold);

    cachedState = {
      tree: enrichedTree,
      summary,
      health,
      timestamp: now,
    };
    cacheTime = now;
    return cachedState;
  }

  app.get("/", async (c) => {
    const state = await getTreeData();
    return c.html(generateViewerHTML(state));
  });

  app.get("/api/tree", async (c) => {
    const state = await getTreeData();
    const minHealth = parseInt(c.req.query("minHealth") || "0");
    const abandonedOnly = c.req.query("abandonedOnly") === "true";
    const search = c.req.query("search") || "";

    let tree = state.tree;

    if (abandonedOnly) {
      tree = filterTreeByAbandoned(tree);
    }

    if (minHealth > 0) {
      tree = filterTreeByHealth(tree, minHealth);
    }

    if (search) {
      tree = searchTree(tree, search);
    }

    return c.json({
      tree,
      summary: state.summary,
      health: state.health,
      timestamp: state.timestamp,
    });
  });

  app.get("/api/health", async (c) => {
    const state = await getTreeData();
    return c.json(state.health);
  });

  return app;
}

/**
 * Start the interactive viewer server
 * @param options - Viewer configuration options
 * @returns Server instance
 */
export async function startViewer(
  options: ViewerOptions
): Promise<{ url: string; stop: () => void }> {
  const app = await createViewerApp(options);
  const port = options.port ?? 3000;

  const server = Bun.serve({
    fetch: app.fetch,
    port,
  });

  const url = `http://localhost:${port}`;

  if (options.openBrowser) {
    try {
      await Bun.spawn(["open", url]);
    } catch {
      // Ignore open errors
    }
  }

  return {
    url,
    stop: () => server.stop(),
  };
}
