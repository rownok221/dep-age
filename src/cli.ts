#!/usr/bin/env node
import { initHealthHistory } from "./history";
import { startViewer } from "./viewer";
import { scanDependencies } from "./scanner";
import { generateReport } from "./reporter";
import { calculateHealthScore } from "./health";
import {
  scanDependencyTree,
  summarizeTree,
  formatTree,
} from "./tree-scanner";
import {
  createAbandonmentThreshold,
  DEFAULT_ABANDONMENT_THRESHOLD,
} from "./types";
import type { ReportOptions, TreeScanOptions } from "./types";

const ANSI = {
  bold: "\x1b[1m",
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
};

function gradeColor(grade: string): string {
  switch (grade) {
    case "A":
      return `${ANSI.green}${grade}${ANSI.reset}`;
    case "B":
      return `${ANSI.green}${grade}${ANSI.reset}`;
    case "C":
      return `${ANSI.yellow}${grade}${ANSI.reset}`;
    case "D":
      return `${ANSI.red}${grade}${ANSI.reset}`;
    case "F":
      return `${ANSI.red}${ANSI.bold}${grade}${ANSI.reset}`;
    default:
      return grade;
  }
}

function parseArgs(argv: string[]): Record<string, string | boolean | number> {
  const args: Record<string, string | boolean | number> = {};
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else if (arg === "--version" || arg === "-v") {
      args.version = true;
    } else if (arg === "--json") {
      args.format = "json";
    } else if (arg === "--markdown") {
      args.format = "markdown";
    } else if (arg === "--color") {
      args.color = true;
    } else if (arg === "--abandoned-only") {
      args.showOnlyAbandoned = true;
    } else if (arg === "--threshold" || arg === "-t") {
      args.threshold = parseInt(argv[++i], 10);
    } else if (arg === "--registry" || arg === "-r") {
      args.registryUrl = argv[++i];
    } else if (arg === "--ignore" || arg === "-i") {
      const ignoreList = argv[++i];
      args.ignore = ignoreList ? ignoreList.split(",") : [];
    } else if (arg === "--tree") {
      args.tree = true;
    } else if (arg === "--max-depth" || arg === "-d") {
      args.maxDepth = parseInt(argv[++i], 10);
    } else if (arg === "--serve" || arg === "--view") {
      args.serve = true;
    } else if (arg === "--port" || arg === "-p") {
      args.port = parseInt(argv[++i], 10);
    } else if (arg === "--open") {
      args.open = true;
    } else if (arg === "--save-history") {
      args.saveHistory = true;
    } else if (arg === "--view-history") {
      args.viewHistory = true;
    } else if (arg === "--start") {
      args.start = argv[++i];
    } else if (arg === "--end") {
      args.end = argv[++i];
    } else if (arg === "--db-path") {
      args.dbPath = argv[++i];
    } else if (arg === "--cache") {
      args.useCache = true;
    } else if (arg === "--cache-path") {
      args.cachePath = argv[++i];
    } else if (!arg.startsWith("-")) {
      args.packageJsonPath = arg;
    }
  }
  return args;
}

function printHelp(): void {
  console.log(`
${ANSI.bold}dep-age${ANSI.reset} - Detect abandoned npm dependencies

${ANSI.bold}Usage:${ANSI.reset}
  dep-age [options] [package.json path]

${ANSI.bold}Options:${ANSI.reset}
  -h, --help              Show this help message
  -v, --version           Show version number
  --json                  Output as JSON
  --markdown              Output as Markdown table
  --color                 Enable colored output
  --abandoned-only        Show only abandoned packages
  -t, --threshold <days>  Abandonment threshold in days (default: 730)
  -r, --registry <url>    Custom npm registry URL
  -i, --ignore <pkgs>     Comma-separated list of packages to ignore
  --tree                  Show dependency tree analysis
  -d, --max-depth <n>     Maximum depth for tree analysis (default: 10)
  --serve, --view         Start interactive web viewer
  -p, --port <number>     Port for web viewer (default: 3000)
  --open                  Open browser automatically
  --cache                 Enable registry caching
  --cache-path <path>     Custom cache directory
  --save-history          Save health snapshot to history database
  --view-history          View historical health trends
  --start <date>          Start date for history (ISO format)
  --end <date>            End date for history (ISO format)
  --db-path <path>        Custom history database path

${ANSI.bold}Examples:${ANSI.reset}
  dep-age
  dep-age --tree --max-depth 3
  dep-age --serve --open
  dep-age --threshold 365 --json
  dep-age --ignore "lodash,moment" --tree
`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);

  if (args.help) {
    printHelp();
    return;
  }

  if (args.version) {
    console.log("2.3.0");
    return;
  }

  // Handle interactive viewer
  if (args.serve) {
    const port = (args.port as number) || 3000;
    console.log(`${ANSI.dim}Starting interactive viewer...${ANSI.reset}`);
    
    const viewer = await startViewer({
      packageJsonPath: args.packageJsonPath as string,
      port,
      openBrowser: args.open as boolean,
      abandonmentThreshold: args.threshold
        ? createAbandonmentThreshold(args.threshold as number)
        : undefined,
      ignore: (args.ignore as string[]) || [],
      maxDepth: (args.maxDepth as number) || 10,
    });

    console.log(`${ANSI.green}Viewer running at ${viewer.url}${ANSI.reset}`);
    console.log(`${ANSI.dim}Press Ctrl+C to stop${ANSI.reset}`);

    // Keep process alive
    process.on("SIGINT", () => {
      console.log("\nShutting down...");
      viewer.stop();
      process.exit(0);
    });

    return;
  }

  // Handle history view
  if (args.viewHistory) {
    const healthHistory = initHealthHistory(args.dbPath as string);
    const start = new Date(
      (args.start as string) || Date.now() - 30 * 86400000
    );
    const end = new Date((args.end as string) || Date.now());

    const history = await healthHistory.getHistory(start, end);

    if (args.format === "json") {
      console.log(JSON.stringify(history, null, 2));
    } else {
      console.log(
        `\n${ANSI.bold}Health History (${start
          .toISOString()
          .slice(0, 10)} to ${end.toISOString().slice(0, 10)})${ANSI.reset}`
      );
      history.forEach((entry) => {
        const gc = gradeColor(entry.grade);
        console.log(
          `[${new Date(entry.timestamp).toISOString().slice(0, 10)}] ${gc}${
            entry.score
          }%${ANSI.reset} - ${entry.abandonedCount} abandoned`
        );
      });
    }
    return;
  }

  const packageJsonPath =
    (args.packageJsonPath as string) ||
    require("path").join(process.cwd(), "package.json");

  const threshold = args.threshold
    ? createAbandonmentThreshold(args.threshold as number)
    : DEFAULT_ABANDONMENT_THRESHOLD;

  try {
    if (args.tree) {
      // Tree analysis mode
      const treeOptions: TreeScanOptions = {
        packageJsonPath,
        maxDepth: (args.maxDepth as number) || 10,
        abandonmentThreshold: threshold,
        ignore: (args.ignore as string[]) || [],
        registryUrl: args.registryUrl as string,
      };

      const tree = await scanDependencyTree(treeOptions);
      const summary = summarizeTree(tree);

      if (args.format === "json") {
        console.log(JSON.stringify({ tree, summary }, null, 2));
      } else {
        console.log(
          `${ANSI.bold}Dependency Tree Analysis${ANSI.reset}\n`
        );
        console.log(`Total Packages: ${summary.totalPackages}`);
        console.log(`Unique Packages: ${summary.uniquePackages}`);
        console.log(`Max Depth: ${summary.maxDepth}`);
        console.log(
          `Abandoned: ${ANSI.red}${summary.abandonedCount}${ANSI.reset}`
        );
        console.log(
          `Health Score: ${gradeColor(summary.grade)} ${summary.healthScore}%${ANSI.reset}\n`
        );

        if (summary.abandonedPaths.length > 0) {
          console.log(`${ANSI.bold}Abandoned Dependency Paths:${ANSI.reset}`);
          summary.abandonedPaths.forEach((path) => {
            console.log(`  ${path.join(" → ")}`);
          });
        }

        console.log("\n" + formatTree(tree, { color: args.color as boolean }));
      }
    } else {
      // Standard scan mode
      const result = await scanDependencies({
        packageJsonPath,
        registryUrl: args.registryUrl as string,
        abandonmentThreshold: threshold,
        ignore: (args.ignore as string[]) || [],
        useCache: args.useCache as boolean,
        cachePath: args.cachePath as string,
      });

      const health = calculateHealthScore(result, threshold);

      // Save history if requested
      if (args.saveHistory) {
        const healthHistory = initHealthHistory(args.dbPath as string);
        await healthHistory.saveSnapshot(health);
        if (args.format !== "json") {
          console.log(
            `${ANSI.dim}Saved health snapshot to history${ANSI.reset}\n`
          );
        }
      }

      const reportOptions: ReportOptions = {
        format: (args.format as "text" | "json" | "markdown") || "text",
        color: args.color as boolean,
        showOnlyAbandoned: args.showOnlyAbandoned as boolean,
        sortBy: "age",
      };

      if (reportOptions.format === "json") {
        console.log(
          JSON.stringify(
            {
              dependencies: result,
              health,
            },
            null,
            2
          )
        );
      } else if (reportOptions.format === "markdown") {
        console.log(generateReport(result, reportOptions));
        console.log(
          `\n**Health Score:** ${health.score}% (${health.grade})`
        );
      } else {
        console.log(generateReport(result, reportOptions));
        console.log(`\n${ANSI.bold}Health Summary:${ANSI.reset}`);
        console.log(`  Score: ${gradeColor(health.grade)} ${health.score}%${ANSI.reset}`);
        console.log(`  Grade: ${gradeColor(health.grade)}${health.grade}${ANSI.reset}`);
        console.log(`  Total: ${health.totalDeps} dependencies`);
        console.log(
          `  Abandoned: ${health.abandonedCount > 0 ? ANSI.red : ANSI.green}${health.abandonedCount}${ANSI.reset}`
        );
        if (health.explanation && health.explanation.length > 0) {
          console.log(`\n${ANSI.bold}Issues:${ANSI.reset}`);
          health.explanation.slice(0, 5).forEach((ex) => {
            console.log(`  • ${ex}`);
          });
          if (health.explanation.length > 5) {
            console.log(
              `  ${ANSI.dim}... and ${health.explanation.length - 5} more${ANSI.reset}`
            );
          }
        }
      }

      // Exit with error code if abandoned packages found
      if (health.abandonedCount > 0 && !args.showOnlyAbandoned) {
        process.exit(1);
      }
    }
  } catch (error) {
    console.error(
      `${ANSI.red}Error:${ANSI.reset}`,
      error instanceof Error ? error.message : String(error)
    );
    process.exit(2);
  }
}

main();
