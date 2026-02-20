# Contributing to Night-Shift

Thank you for your interest in contributing to Night-Shift! This document covers
the essentials for getting started.

## Prerequisites

- **Node.js >= 20**
- **Claude CLI** — install from [claude.ai/download](https://claude.ai/download)
- **beads** (optional) — install from [github.com/steveyegge/beads](https://github.com/steveyegge/beads) if you want to work on bead-related features

## Setup

```bash
git clone https://github.com/julienderay/night-shift.git
cd night-shift
npm install
npm run build
```

To run the CLI locally without building each time:

```bash
npm run dev -- <command>
```

## Running Tests

```bash
npm test              # run all tests (vitest)
npm run test:watch    # run in watch mode
npm run typecheck     # type-check without emitting
```

All tests must pass before submitting a pull request.

## Project Conventions

- **ESM** — the project uses ES modules (`"type": "module"`). Use `.js` extensions in imports.
- **Strict TypeScript** — `strict: true` in `tsconfig.json`. No `any` unless absolutely necessary.
- **Semicolons** — always use semicolons.
- **Atomic writes** — state files and reports are written to a `.tmp` file first, then renamed. Follow this pattern for any new file I/O.
- **Spawn, not exec** — child processes use `child_process.spawn` with argument arrays. No shell interpolation.

## Pull Request Guidelines

1. Create a feature branch from `main`.
2. Keep changes focused — one logical change per PR.
3. Add or update tests for any new functionality.
4. Make sure `npm run typecheck`, `npm test`, and `npm run build` all pass.
5. Write a clear PR description explaining what changed and why.

## Areas Open for Contribution

Check the [What's Not Implemented Yet](README.md#whats-not-implemented-yet) section in the README for known gaps and feature ideas.
