# dep-age

[![CI](https://github.com/AdametherzLab/dep-age/actions/workflows/ci.yml/badge.svg)](https://github.com/AdametherzLab/dep-age/actions) [![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue)](https://www.typescriptlang.org/) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

**Detect abandoned npm dependencies** — health scores, CLI, GitHub Action. Zero runtime deps.

## Features

- Detect abandoned dependencies (configurable threshold, default: 730 days)
- **Custom Registry Support**: Use a private or alternative npm registry
- Health score calculation with letter grade
- Multiple output formats (text, JSON, markdown)
- Cache support for reduced registry requests
- Zero runtime dependencies

## Usage

```typescript
import { scanDependencies, createAbandonmentThreshold } from 'dep-age';

// Scan with custom registry
const results = await scanDependencies({
  packageJsonPath: './package.json',
  registryUrl: 'https://your.custom.registry/',
  abandonmentThreshold: createAbandonmentThreshold(365)
});
```

[Rest of README content...]