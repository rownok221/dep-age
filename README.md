# dep-age

[![CI](https://github.com/AdametherzLab/dep-age/actions/workflows/ci.yml/badge.svg)](https://github.com/AdametherzLab/dep-age/actions) [![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue)](https://www.typescriptlang.org/) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

**Detect abandoned npm dependencies** — health scores, dependency tree analysis, CLI, and GitHub Action. Zero runtime deps.

## Features

- Detect abandoned dependencies (configurable threshold, default: 730 days)
- **Dependency Tree Analysis**: Visualize and analyze the abandonment status of your entire dependency tree, including transitive dependencies
- Custom registry support for private or alternative npm registries
- Health score calculation with letter grade (A-F)
- Multiple output formats (text, JSON, markdown)
- Cache support for reduced registry requests
- Circular dependency detection
- Zero runtime dependencies

## Installation

bash
# npm
npm install @adametherzlab/dep-age

# bun
bun add @adametherzlab/dep-age

# pnpm
pnpm add @adametherzlab/dep-age

# Or run directly with npx
npx @adametherzlab/dep-age


## Usage

### CLI

bash
# Scan current project
npx @adametherzlab/dep-age

# Analyze full dependency tree (transitive deps)
npx @adametherzlab/dep-age --tree

# Tree analysis with limited depth
npx @adametherzlab/dep-age --tree --tree-depth 3

# Custom threshold (1 year) with markdown output
npx @adametherzlab/dep-age --threshold 365 --format markdown

# Just the health score
npx @adametherzlab/dep-age --score-only

# CI check — exits non-zero if any abandoned deps
npx @adametherzlab/dep-age --abandoned-only


### Programmatic API


import {
  scanDependencies,
  scanDependencyTree,
  summarizeTree,
  formatTree,
  calculateHealthScore,
  generateReport,
  createAbandonmentThreshold,
} from '@adametherzlab/dep-age';

// Scan direct dependencies
const results = await scanDependencies({
  packageJsonPath: './package.json',
  abandonmentThreshold: createAbandonmentThreshold(365),
});

// Calculate health score
const health = calculateHealthScore(results);
console.log(`Health: ${health.score}/100 (${health.grade})`);

// Generate a report
const report = generateReport(results, { format: 'markdown' });
console.log(report);

// Analyze full dependency tree
const tree = await scanDependencyTree({
  packageJsonPath: './package.json',
  maxDepth: 3,
  abandonmentThreshold: createAbandonmentThreshold(365),
});

const summary = summarizeTree(tree);
console.log(`Tree health: ${summary.healthScore}/100 (${summary.grade})`);
console.log(`${summary.totalPackages} total, ${summary.uniquePackages} unique, ${summary.abandonedCount} abandoned`);

// Print tree visualization
console.log(formatTree(tree, { color: true }));

// Show abandoned dependency paths
for (const path of summary.abandonedPaths) {
  console.log(`Abandoned: ${path.join(' → ')}`);
}


### Custom Registry


const results = await scanDependencies({
  registryUrl: 'https://your.private.registry/',
});


### Ignore Specific Packages


const results = await scanDependencies({
  ignore: ['legacy-pkg', 'internal-tool'],
});

const tree = await scanDependencyTree({
  ignore: ['legacy-pkg'],
});


## API Reference

### `scanDependencyTree(options?: TreeScanOptions): Promise<TreeNode[]>`

Scans the full dependency tree including transitive dependencies.

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `packageJsonPath` | `string` | `./package.json` | Path to package.json |
| `maxDepth` | `number` | `5` | Maximum tree traversal depth |
| `registryUrl` | `string` | npm registry | Custom registry URL |
| `abandonmentThreshold` | `AbandonmentThreshold` | `730` days | Days before marking abandoned |
| `ignore` | `string[]` | `[]` | Package names to skip |
| `concurrency` | `number` | `8` | Max concurrent registry requests |

### `summarizeTree(tree: TreeNode[]): TreeSummary`

Returns summary statistics: total/unique package counts, max depth, abandoned count, abandoned paths, health score, and letter grade.

### `formatTree(tree: TreeNode[], options?): string`

Renders the tree as an indented string with connectors for terminal display.

### `scanDependencies(options): Promise<ScanResult>`

Scans direct dependencies for freshness and abandonment status.

### `calculateHealthScore(result, threshold?): HealthScore`

Calculates a 0-100 health score with letter grade.

### `generateReport(result, options?): string`

Generates formatted reports in text, JSON, or markdown.

## License

MIT
