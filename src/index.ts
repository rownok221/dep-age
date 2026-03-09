import type {
  PackageJson,
  DependencyInfo,
  ScanOptions,
  DependencyField,
  ScanResult,
  ReportOptions,
  ReportRow,
  AbandonmentThreshold,
  HealthScore,
  TreeNode,
  TreeSummary,
  TreeScanOptions,
} from "./types";
export type {
  PackageJson,
  DependencyInfo,
  ScanOptions,
  DependencyField,
  ScanResult,
  ReportOptions,
  ReportRow,
  AbandonmentThreshold,
  HealthScore,
  TreeNode,
  TreeSummary,
  TreeScanOptions,
};

export { DEFAULT_ABANDONMENT_THRESHOLD, createAbandonmentThreshold } from "./types";
export { scanDependencies } from "./scanner";
export { formatDependencyRow, generateReport } from "./reporter";
export { calculateHealthScore } from "./health";
export { scanDependencyTree, summarizeTree, formatTree } from "./tree-scanner";
