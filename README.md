# dep-age 🕰️  
[![CI](https://github.com/AdametherzLab/dep-age/actions/workflows/ci.yml/badge.svg)](https://github.com/AdametherzLab/dep-age/actions) [![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue)](https://www.typescriptlang.org/) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)  

**Your npm dependency time machine** - Uncover ancient packages before they haunt your project!  

## Features ✅  
- 🚨 Detect abandoned dependencies (>2 years since update)  
- 📅 Show exact package age in days  
- 🔄 Smart alternative package suggestions  
- 📊 Multiple output formats (ASCII, Markdown, JSON)  
- 🔒 Zero runtime dependencies - pure TypeScript  

## Installation 💻  
```bash  
# npm users  
npm install @adametherzlab/dep-age  

# Bun enthusiasts  
bun add @adametherzlab/dep-age  
```

## Quick Start 🚀  
```typescript  
// REMOVED external import: import { scanDependencies, generateReport } from '@adametherzlab/dep-age';

async function checkDeps() {  
  const results = await scanDependencies({  
    packageJsonPath: './package.json',  
  });  

  console.log(generateReport(results, { format: 'ascii' }));  
}  

checkDeps();  
```  

Sample ASCII output:  
```
┌────────────────────┬────────────┬───────┬─────────────┬──────────────────────────┐  
│ Package            │ Current    │ Age   │ Status      │ Alternatives              │  
├────────────────────┼────────────┼───────┼─────────────┼──────────────────────────┤  
│ express            │ 4.18.2     │ 730   │ ❌ Abandoned │ fastify, koa, polka       │  
│ typescript         │ 5.2.2      │ 45    │ 🟢 Fresh     │ -                         │  
│ lodash             │ 3.10.1     │ 2155  │ 💀 Ancient   │ lodash-es, ramda, remeda  │  
└────────────────────┴────────────┴───────┴─────────────┴──────────────────────────┘  
```

## API Reference 📚  

### `scanDependencies(options: ScanOptions): Promise<ScanResult>`  
Analyzes dependencies from package.json against npm registry.  

**Options:**  
```typescript  
interface ScanOptions {  
  packageJsonPath: string;  
  registryUrl?: URL;  
  fields?: DependencyField[];  // Default: ['dependencies', 'devDependencies']  
  abandonmentThreshold?: AbandonmentThreshold;  
}  
```  

**Example:**  
```typescript  
const results = await scanDependencies({  
  packageJsonPath: './package.json',  
  abandonmentThreshold: {  
    daysSincePublish: 730,  
    daysSinceUpdate: 365  
  }  
});  
```  

### `generateReport(results: ScanResult, options: ReportOptions): string`  
**Options:**  
```typescript  
interface ReportOptions {  
  format?: 'ascii' | 'markdown' | 'json';  // Default: 'ascii'  
  showAlternatives?: boolean;              // Default: true  
  maxAlternatives?: number;                // Default: 3  
}  
```  

**Markdown example:**  
```typescript  
const mdReport = generateReport(results, {  
  format: 'markdown',  
  maxAlternatives: 2  
});  
```  

## Advanced Usage 🔧  

### Custom Abandonment Thresholds  
```typescript  
import {  
  scanDependencies,  
  createAbandonmentThreshold  
} from '@adametherzlab/dep-age';  

const strictThreshold = createAbandonmentThreshold({  
  daysSincePublish: 180,      // 6 months since initial publish  
  daysSinceUpdate: 90         // 3 months since last update  
});  

const results = await scanDependencies({  
  packageJsonPath: './package.json',  
  abandonmentThreshold: strictThreshold  
});  
```  

### Programmatic Access to Metadata  
```typescript  
// REMOVED external import: import { fetchPackageMetadata } from '@adametherzlab/dep-age';

const reactMeta = await fetchPackageMetadata('react');  
console.log(`React first published: ${reactMeta.initialRelease}`);  
```  

## How We Detect Alternatives 🔍  
1. **Registry Metadata** - Uses npm's `alternatives` field when available  
2. **Community Trends** - Popular replacement packages from ecosystem data  
3. **Manual Curation** - Maintenance status and API compatibility checks  

⚠️ **Rate Limiting Note:** Large dependency trees may trigger npm registry rate limits (100 requests/5 minutes). Consider splitting scans for monorepos.  

## Contributing 🤝  
Got ideas? Found a bug? We welcome contributions! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.  

## License 📄  
MIT © [AdametherzLab](https://github.com/AdametherzLab)  

*Made with ⌚️ by dependency archaeologists*