# Technology Stack

**Analysis Date:** 2026-02-23

## Languages

**Primary:**
- TypeScript 5.7.0 - Entire codebase, strict mode enabled
- JavaScript - ES2022 compilation target, ES modules (`type: "module"`)

**Secondary:**
- YAML - Configuration files (nightshift.yaml)
- JSON - Data serialization (config, task state, daemon state)
- Bash - CLI scripts, CI/CD workflows

## Runtime

**Environment:**
- Node.js >= 20 (as specified in `engines` field in `package.json`)
- Tested against Node.js 20 and 22 in CI pipeline

**Package Manager:**
- npm (7+, from package-lock.json structure)
- Lockfile: Present at `/Users/julienderay/code/night-shift/package-lock.json`

## Frameworks

**Core:**
- Commander.js 14.0.0 - CLI framework with full type safety
- @commander-js/extra-typings 14.0.0 - TypeScript bindings for Commander

**Scheduling & Time:**
- croner 10.0.0 - Cron expression parsing and evaluation (cron schedules for recurring tasks)
- date-fns 4.1.0 - Date formatting for reports and template variable substitution

**Configuration & Validation:**
- zod 4.3.0 - Schema validation with runtime type safety
- yaml 2.8.0 - YAML parsing and serialization for config loading

**UI & Formatting:**
- chalk 5.4.0 - Terminal colors and formatting (status display, error messages)

**Testing:**
- vitest 3.1.0 - Unit and integration test runner
- Test config: `vitest.config.ts` with 30s timeout
- 134 tests across 15 test files

**Build/Dev:**
- tsx 4.19.0 - TypeScript execution for development (`npm run dev`)
- TypeScript 5.7.0 - Compilation to ES2022 with source maps and declaration files

## Key Dependencies

**Critical:**
- commander - CLI command parsing and routing (`src/cli/index.ts`)
- croner - Core scheduling engine for recurring task evaluation (`src/daemon/scheduler.ts`)
- zod - Config validation ensuring all settings are type-safe before runtime (`src/core/config.ts`)
- yaml - Config file parsing and YAML frontmatter generation for reports

**Infrastructure:**
- date-fns - Date/time manipulation for template variables and report timestamps
- chalk - Terminal formatting for daemon status, task status, cost display

## Configuration

**Environment:**
- No `.env` files detected - configuration is entirely YAML-based
- All settings in `nightshift.yaml` with sensible defaults
- Secret management: External (via Claude CLI's existing MCP/auth config)
- Configuration location: Project root as `nightshift.yaml`

**Build:**
- TypeScript compiler config: `tsconfig.json`
  - Strict mode enabled
  - ES2022 target, Node16 module resolution
  - Source maps and declaration files generated
  - Output directory: `dist/`
  - ESM import extensions required

- Test config: `vitest.config.ts`
  - Test pattern: `tests/**/*.test.ts`
  - Test timeout: 30 seconds

## Platform Requirements

**Development:**
- Node.js 20+
- npm 7+
- TypeScript 5.7+ (included in devDependencies)
- For local testing: vitest 3.1.0, tsx 4.19.0

**Production:**
- Node.js 20+ (single runtime requirement)
- Claude CLI installed and configured (external dependency, not npm package)
- beads CLI tool (optional, falls back to file-based queue)
- Published as npm package; distributed via GitHub releases

**Deployment:**
- CLI distributed as npm package (`night-shift`)
- Installed globally via `npm install -g night-shift` or `npm link`
- Binary entry point: `dist/bin/nightshift.js`
- Runs on macOS, Linux, Windows (any OS with Node.js 20+)

## Project Conventions

**Module System:**
- ESM throughout: all imports use `.js` extensions
- `type: "module"` in package.json
- No CommonJS fallback
- Path aliases: None configured

**Compilation:**
- TypeScript strict mode enforced
- All async operations handled via Promise/async-await
- No callback-style APIs

---

*Stack analysis: 2026-02-23*
