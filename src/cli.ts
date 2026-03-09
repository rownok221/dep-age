#!/usr/bin/env node
import { scanDependencies } from './scanner';
import { generateReport } from './reporter';
import { calculateHealthScore } from './health';
import { scanDependencyTree, summarizeTree, formatTree } from './tree-scanner';
import { createAbandonmentThreshold } from './types';

const ANSI = {
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  reset: '\x1b[0m',
} as const;

function printHelp(): void {
  console.log(`
${ANSI.bold}dep-age${ANSI.reset} — Detect abandoned npm dependencies

${ANSI.bold}USAGE${ANSI.reset}
  npx @adametherzlab/dep-age [options]

${ANSI.bold}OPTIONS${ANSI.reset}
  --path <dir>         Path to package.json (default: ./package.json)
  --threshold <days>   Days before marking abandoned (default: 730)
  --format <fmt>       Output format: text, json, markdown (default: text)
  --abandoned-only     Only show abandoned packages
  --sort <field>       Sort by: name, age, status (default: age)
  --no-color           Disable colored output
  --score-only         Only output the health score
  --tree               Analyze full dependency tree (transitive deps)
  --tree-depth <n>     Max depth for tree analysis (default: 5)
  --help               Show this help message

${ANSI.bold}EXAMPLES${ANSI.reset}
  ${ANSI.dim}# Scan current project${ANSI.reset}
  npx @adametherzlab/dep-age

  ${ANSI.dim}# Scan with 1-year threshold, markdown output${ANSI.reset}
  npx @adametherzlab/dep-age --threshold 365 --format markdown

  ${ANSI.dim}# Analyze full dependency tree${ANSI.reset}
  npx @adametherzlab/dep-age --tree --tree-depth 3

  ${ANSI.dim}# Just the health score${ANSI.reset}
  npx @adametherzlab/dep-age --score-only

  ${ANSI.dim}# CI check — exits non-zero if any abandoned deps${ANSI.reset}
  npx @adametherzlab/dep-age --abandoned-only && echo "All fresh!"
`);
}

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const args: Record<string, string | boolean> = {};
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') { args.help = true; continue; }
    if (arg === '--no-color') { args.color = false; continue; }
    if (arg === '--abandoned-only') { args.abandonedOnly = true; continue; }
    if (arg === '--score-only') { args.scoreOnly = true; continue; }
    if (arg === '--tree') { args.tree = true; continue; }
    if (arg.startsWith('--') && i + 1 < argv.length) {
      const key = arg.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      args[key] = argv[++i];
    }
  }
  return args;
}

function gradeColor(grade: string): string {
  if (grade === 'A') return ANSI.green;
  if (grade === 'B') return ANSI.green;
  if (grade === 'C') return ANSI.yellow;
  return ANSI.red;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);

  if (args.help) { printHelp(); return; }

  const packageJsonPath = (args.path as string) ?? './package.json';
  const threshold = args.threshold
    ? createAbandonmentThreshold(parseInt(args.threshold as string, 10))
    : undefined;
  const format = (args.format as 'text' | 'json' | 'markdown') ?? 'text';
  const useColor = args.color !== false && format === 'text';

  // Tree mode
  if (args.tree) {
    const maxDepth = args.treeDepth ? parseInt(args.treeDepth as string, 10) : 5;
    console.log(`${ANSI.dim}Scanning dependency tree (depth ${maxDepth})...${ANSI.reset}`);

    const tree = await scanDependencyTree({
      packageJsonPath,
      maxDepth,
      abandonmentThreshold: threshold,
    });

    const summary = summarizeTree(tree);
    const gc = gradeColor(summary.grade);

    if (format === 'json') {
      console.log(JSON.stringify({ tree, summary }, null, 2));
    } else {
      console.log(`\n${ANSI.bold}Dependency Tree Health: ${gc}${summary.healthScore}/100 (${summary.grade})${ANSI.reset}`);
      console.log(`${ANSI.dim}${summary.totalPackages} total | ${summary.uniquePackages} unique | depth ${summary.maxDepth} | ${summary.abandonedCount} abandoned${ANSI.reset}\n`);
      console.log(formatTree(tree, { color: useColor }));

      if (summary.abandonedCount > 0) {
        console.log(`\n${ANSI.yellow}Abandoned dependency paths:${ANSI.reset}`);
        for (const p of summary.abandonedPaths) {
          console.log(`  ${ANSI.red}${p.join(' → ')}${ANSI.reset}`);
        }
      }
    }

    if (summary.abandonedCount > 0) process.exit(1);
    return;
  }

  console.log(`${ANSI.dim}Scanning dependencies...${ANSI.reset}`);

  const result = await scanDependencies({
    packageJsonPath,
    abandonmentThreshold: threshold,
  });

  const depCount = Object.keys(result).length;
  if (depCount === 0) {
    console.log('No dependencies found.');
    return;
  }

  // Health score
  const health = calculateHealthScore(result, threshold);

  if (args.scoreOnly) {
    if (format === 'json') {
      console.log(JSON.stringify(health, null, 2));
    } else {
      const gc = gradeColor(health.grade);
      console.log(`\n${ANSI.bold}Dependency Health Score: ${gc}${health.score}/100 (${health.grade})${ANSI.reset}`);
      console.log(`${ANSI.dim}${health.summary}${ANSI.reset}\n`);
    }
    process.exit(health.abandonedCount > 0 ? 1 : 0);
    return;
  }

  // Full report
  const report = generateReport(result, {
    format,
    color: useColor,
    showOnlyAbandoned: args.abandonedOnly === true,
    sortBy: (args.sort as 'name' | 'age' | 'status') ?? 'age',
  });

  // Print score header
  if (format === 'text') {
    const gc = gradeColor(health.grade);
    console.log(`\n${ANSI.bold}Dependency Health: ${gc}${health.score}/100 (${health.grade})${ANSI.reset}`);
    console.log(`${ANSI.dim}${depCount} deps scanned | ${health.freshCount} fresh | ${health.agingCount} aging | ${health.abandonedCount} abandoned${ANSI.reset}\n`);
  }

  console.log(report);

  if (format === 'text' && health.abandonedCount > 0) {
    console.log(`\n${ANSI.yellow}${health.abandonedCount} package(s) may be abandoned. Consider alternatives.${ANSI.reset}`);
  }

  // Exit non-zero if abandoned deps found (useful for CI)
  if (args.abandonedOnly && health.abandonedCount > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
