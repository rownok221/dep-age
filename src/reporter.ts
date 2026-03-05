import type { ScanResult, ReportOptions, ReportRow, DependencyInfo } from './types';

const ANSI_COLORS = {
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  reset: '\x1b[0m',
} as const;

/**
 * Formats a dependency row for display in various output formats.
 * @param info - Dependency information to format
 * @param options - Reporter configuration options
 * @returns Formatted string representation of the dependency row
 */
export function formatDependencyRow(info: ReportRow, options: ReportOptions): string {
  const { format = 'text', color = false } = options;
  
  const statusBadge = formatStatus(info.status, color);
  const alternatives = info.alternatives?.join(', ') ?? '';

  switch (format) {
    case 'text':
      return `${info.name.padEnd(20)} ${info.currentVersion.padEnd(15)} ${info.age.toString().padEnd(10)} ${statusBadge.padEnd(15)} ${alternatives}`;
    case 'markdown':
      return `| ${info.name} | ${info.currentVersion} | ${info.age} | ${info.status} | ${alternatives} |`;
    default:
      return JSON.stringify(info);
  }
}

/**
 * Generates a formatted report from scan results.
 * @param result - Scan results containing dependency metadata
 * @param options - Configuration for report formatting and filtering
 * @returns Formatted report string in requested output format
 * @throws {TypeError} When input parameters are invalid
 */
export function generateReport(result: ScanResult, options: ReportOptions = {}): string {
  if (!result || typeof result !== 'object') {
    throw new TypeError('Invalid scan result: Expected object');
  }

  const dependencies = Object.values(result);
  const filtered = options.showOnlyAbandoned ? dependencies.filter(dep => dep.isAbandoned) : dependencies;
  const sorted = sortDependencies(filtered, options.sortBy);
  const reportRows = sorted.map(dependencyToRow);

  switch (options.format) {
    case 'json':
      return renderJson(reportRows);
    case 'markdown':
      return renderMarkdownTable(reportRows, options.color);
    default:
      return renderTable(reportRows, options.color);
  }
}

function dependencyToRow(dep: DependencyInfo): ReportRow {
  return {
    name: dep.name,
    currentVersion: dep.currentVersion,
    publishedDate: dep.publishedDate.toISOString().split('T')[0],
    age: dep.ageInDays,
    status: dep.isAbandoned ? 'abandoned' : 'active',
    alternatives: dep.alternatives,
  };
}

function sortDependencies(
  dependencies: DependencyInfo[],
  sortBy?: ReportOptions['sortBy']
): DependencyInfo[] {
  const sorted = [...dependencies];
  
  switch (sortBy) {
    case 'name':
      return sorted.sort((a, b) => a.name.localeCompare(b.name));
    case 'age':
      return sorted.sort((a, b) => b.ageInDays - a.ageInDays);
    case 'status':
      return sorted.sort((a, b) => 
        (b.isAbandoned ? 1 : 0) - (a.isAbandoned ? 1 : 0)
      );
    default:
      return sorted;
  }
}

function renderTable(rows: ReportRow[], colorize = false): string {
  const header = `${'Name'.padEnd(20)} ${'Version'.padEnd(15)} ${'Age'.padEnd(10)} ${'Status'.padEnd(15)} Alternatives`;
  const separator = '-'.repeat(header.length);
  const body = rows.map(row => formatDependencyRow(row, { format: 'text', color: colorize }));

  return [header, separator, ...body].join('\n');
}

function renderMarkdownTable(rows: ReportRow[], colorize: boolean): string {
  const headers = ['Name', 'Version', 'Age', 'Status', 'Alternatives'];
  const separator = headers.map(() => '---').join(' | ');
  const headerRow = `| ${headers.join(' | ')} |`;
  const separatorRow = `| ${separator} |`;
  const body = rows.map(row => formatDependencyRow(row, { format: 'markdown', color: colorize }));

  return [headerRow, separatorRow, ...body].join('\n');
}

function renderJson(rows: ReportRow[]): string {
  return JSON.stringify(rows, null, 2);
}

function formatStatus(status: 'active' | 'abandoned', colorize: boolean): string {
  if (!colorize) return status.toUpperCase();

  switch (status) {
    case 'abandoned':
      return `${ANSI_COLORS.red}ABANDONED${ANSI_COLORS.reset}`;
    case 'active':
      return `${ANSI_COLORS.green}ACTIVE${ANSI_COLORS.reset}`;
    default:
      return status.toUpperCase();
  }
}