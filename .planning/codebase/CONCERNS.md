# Codebase Concerns

**Analysis Date:** 2026-02-23

## Race Conditions and Concurrency Issues

**File-based queue claiming without atomicity:**
- Issue: Multiple daemon instances could simultaneously read the same task from the queue directory and both claim it, leading to duplicate execution. The file-based queue fallback uses read-then-write patterns with no locking mechanism.
- Files: `src/daemon/orchestrator.ts` (lines 180-200, 202-224), `src/daemon/scheduler.ts` (lines 123-130)
- Impact: In multi-daemon or restart scenarios, tasks could execute more than once, wasting budget and producing duplicate reports
- Fix approach: Implement file-based locking (e.g., atomic file renames with process IDs), or add a "claimed_by_pid" field that must be validated before claiming. Alternatively, strongly recommend beads as the production queue backend.

**Process termination may leave zombie runners:**
- Issue: In `src/daemon/orchestrator.ts` line 88, `drain()` calls `Promise.allSettled()` on running task promises, but if a runner's process doesn't respond to SIGTERM, it will become a zombie until SIGKILL is applied (10s later in `src/utils/process.ts` lines 64-66). If the daemon is forcefully killed before the 10s grace period, orphaned processes may remain.
- Files: `src/daemon/orchestrator.ts` (lines 71-101), `src/daemon/agent-runner.ts` (lines 93-97), `src/utils/process.ts` (lines 59-67)
- Impact: Accumulating zombie processes consuming system resources; cascading failures if too many accumulate
- Fix approach: Implement process group cleanup (use `process.kill(-pid)` to kill entire process group), add startup check to clean orphaned PID files, consider shorter force-kill timeout for production

**Config reload without synchronization:**
- Issue: In `src/daemon/orchestrator.ts` lines 124-133, the config is hot-reloaded on each tick without locking. Concurrent reads of `this.config` during reload could expose partially-updated state.
- Files: `src/daemon/orchestrator.ts` (lines 122-133), `src/daemon/scheduler.ts` (lines 26-28)
- Impact: Scheduler or pool could use inconsistent configuration (old timeout with new recurring tasks, or vice versa)
- Fix approach: Use a config version counter or read-copy-update pattern; ensure scheduler config updates are atomic with respect to schedule evaluation

## Error Handling Gaps

**Unhandled promise rejections in logger:**
- Issue: `src/core/logger.ts` lines 77-111 use `void this.write()` to ignore async write errors. If log file becomes unwritable (permissions, disk full), errors are silently swallowed and writes stop without warning.
- Files: `src/core/logger.ts` (lines 77-111)
- Impact: Silent log loss during critical failures; operators won't know daemon is unlogged; debugging later becomes impossible
- Fix approach: Implement error queuing with stderr fallback; at minimum, write one final error message to console when log persistence fails repeatedly

**Beads client timeout hard-coded to 30s:**
- Issue: `src/beads/client.ts` line 18 uses a fixed 30000ms timeout for all beads operations, including listing, creating, and updating. No configurability or backoff strategy.
- Files: `src/beads/client.ts` (lines 17-20)
- Impact: Slow beads operations (network issues, high system load) will consistently timeout; no way to tune without code change; no exponential backoff means retries hammer the system
- Fix approach: Make timeout configurable via config file; implement exponential backoff for retries; differentiate timeout by operation type (list vs. create)

**Missing validation on parsed metadata:**
- Issue: `src/beads/mapper.ts` lines 71-109 parse bead descriptions with a regex but don't validate parsed values. `parseFloat()` at line 94 can silently return `NaN`, and split operations at line 100 could produce empty strings.
- Files: `src/beads/mapper.ts` (lines 71-109)
- Impact: Corrupted bead descriptions could create tasks with invalid budgets (NaN), empty tool lists, or garbage timeouts; downstream code would fail unpredictably
- Fix approach: Add validation step after parsing; use `Number.isFinite()` for budget; validate timeout format matches pattern

**Orphaned temporary files on atomic write failure:**
- Issue: `src/utils/fs.ts` lines 5-14 use atomic write (write to `.tmp` then rename), but if rename fails after a successful write, the temp file remains. No cleanup mechanism.
- Files: `src/utils/fs.ts` (lines 5-14)
- Impact: Accumulating `.tmp.*` files in directories (inbox, queue, logs); disk space waste; potential confusion
- Fix approach: Add try-finally block to clean up temp file on rename failure; implement periodic cleanup of stale temp files

## Scalability Limits

**In-memory completed task queue unbounded:**
- Issue: `src/daemon/agent-pool.ts` line 24 uses `completedQueue: TaskResult[] = []` with no size limit. Tasks accumulate until collected on next tick. If collection is delayed or 30s poll interval is too long, high-concurrency setups could consume unbounded memory.
- Files: `src/daemon/agent-pool.ts` (lines 24, 97-101)
- Impact: Memory leak in long-running daemons with high task throughput (maxConcurrent=10+ tasks); eventual OOM
- Fix approach: Implement bounded queue with overflow handling; drop oldest or fail new tasks if queue exceeds threshold; add memory monitoring warnings

**Scheduler state loading/saving not batched:**
- Issue: `src/daemon/scheduler.ts` lines 30-39 load entire state file on startup, and line 60 saves after every batch of recurring tasks. No write coalescing or batching of multiple saves.
- Files: `src/daemon/scheduler.ts` (lines 30-39, 59-61)
- Impact: With dozens of recurring tasks, each creating multiple writes to disk; I/O pressure; potential slowdown at scale
- Fix approach: Implement dirty flag; batch saves to once per tick or every N updates; add async write queue

**No pagination for beads `listAll()`:**
- Issue: `src/beads/client.ts` line 89 calls `bd list --label nightshift` without limit. No pagination, so if tasks accumulate to thousands, the entire list loads into memory and takes minutes to parse JSON.
- Files: `src/beads/client.ts` (lines 89-91)
- Impact: Status command or reports freeze; memory spike; unusable system with large task histories
- Fix approach: Implement cursor-based pagination; add --limit flag when available in beads CLI; implement client-side filtering/streaming

## Test Coverage Gaps

**Orchestrator tick() not fully tested:**
- Issue: `src/daemon/orchestrator.ts` lines 122-161 (`tick()` method) is the core loop. Tests in `tests/unit/orchestrator.test.ts` focus on queue reading/claiming but don't test the full tick flow with scheduler, pool, and completion handling together.
- Files: `tests/unit/orchestrator.test.ts`, `src/daemon/orchestrator.ts` (lines 122-161)
- Impact: Changes to tick() sequence or state updates could introduce subtle bugs undetected by tests; race conditions in tick ordering not caught
- Risk: High — tick() is the most critical code path
- Priority: High

**Agent timeout behavior not tested:**
- Issue: `src/utils/process.ts` lines 59-66 implement timeout with SIGTERM and delayed SIGKILL, but no test verifies this flow works correctly, that timers are cleaned up, or that the rejection path in `src/daemon/agent-runner.ts` line 74-82 is exercised.
- Files: `tests/unit/process.test.ts`, `src/utils/process.ts` (lines 59-66), `src/daemon/agent-runner.ts` (lines 50-64)
- Impact: Timeout logic could fail silently or leave timers dangling; processes not actually killed on timeout
- Risk: Medium — affects all long-running tasks
- Priority: Medium

**Beads integration not tested:**
- Issue: Integration with beads CLI is untested. `src/beads/client.ts` spawns `bd` commands but tests don't verify these calls work or handle errors correctly. Fallback to file queue is tested, but beads path is dark.
- Files: `src/beads/client.ts`, `tests/` (no beads-specific tests)
- Impact: Beads mode could break without detection; discovered only in production
- Risk: High if beads is production primary
- Priority: High

**No test for config hot-reload consistency:**
- Issue: `src/daemon/orchestrator.ts` line 122-133 hot-reloads config during tick, but no test verifies that concurrent reads don't see partial updates or that scheduler updates take effect consistently.
- Files: `src/daemon/orchestrator.ts` (lines 122-133), `tests/` (no hot-reload test)
- Impact: Scheduler could skip tasks or use outdated timeouts after config reload
- Risk: Medium — happens on every tick
- Priority: Medium

**Reporter template rendering edge cases:**
- Issue: `src/inbox/reporter.ts` line 64 calls `renderTemplate(task.output, ...)` with no test for invalid templates, missing variables, or path traversal via template injection.
- Files: `src/inbox/reporter.ts` (lines 44-70), `tests/unit/reporter.test.ts` (likely incomplete)
- Impact: Malformed templates could write reports to unexpected locations or fail silently
- Risk: Medium
- Priority: Medium

## Type Safety Issues

**Loose typing on beads descriptions:**
- Issue: `src/beads/mapper.ts` line 36 casts `meta.origin` to `"one-off" | "recurring"` with a fallback, but `meta.origin` comes from parsed string with no type guard. If beads contains a corrupted description with `origin: invalid`, it silently becomes "one-off".
- Files: `src/beads/mapper.ts` (lines 31-57)
- Impact: Silent type mismatches; tasks classified incorrectly
- Fix approach: Use zod schema to validate parsed metadata; throw error on invalid origin

**Optional fields with fallback assumptions:**
- Issue: `src/core/logger.ts` line 31 and throughout use `options?.logFile ?? null`, then later assume logFile is either string or null. But if a function accidentally passes wrong type, there's no validation. Similarly, `src/beads/mapper.ts` line 51 uses `meta.timeout ?? "30m"` which assumes timeout is always string-compatible.
- Files: `src/core/logger.ts`, `src/beads/mapper.ts`
- Impact: Type errors could emerge at runtime; narrowing assumptions not enforced
- Fix approach: Use explicit type guards or runtime validation for critical paths

## Dependency & Environment Risks

**Claude CLI version compatibility not verified:**
- Issue: `src/daemon/agent-runner.ts` lines 100-131 build CLI args for `claude -p` but don't verify CLI version or available flags. If user has old Claude CLI, args like `--output-format json` might not exist, causing mysterious failures.
- Files: `src/daemon/agent-runner.ts` (lines 99-131)
- Impact: Silent failures when Claude CLI version is incompatible; difficult to debug
- Fix approach: On daemon startup, run `claude --version` and validate minimum version; warn if unsupported flags are used

**Beads availability not checked before operations:**
- Issue: `src/beads/client.ts` line 102 has `isAvailable()` but it's only called once in tests. The orchestrator enables beads mode based on config (line 39) without checking if `bd` command actually exists, and fails only when first operation runs.
- Files: `src/daemon/orchestrator.ts` (lines 39), `src/beads/client.ts` (lines 102-109)
- Impact: Daemon starts with beads enabled but fails on first task because `bd` command is not installed; confusing error message
- Fix approach: Call `isAvailable()` on startup and fall back to file queue automatically, or exit with clear error message

**No Node.js version runtime check:**
- Issue: `package.json` line 28 specifies `"engines": {"node": ">=20"}` but there's no runtime check in code. If user runs with Node 18, it will fail with cryptic errors deep in dependencies.
- Files: `bin/nightshift.ts` (no version check), `package.json`
- Impact: Incompatible runtime silently fails; users don't know why
- Fix approach: Add version check in entry point (bin/nightshift.ts) that exits early with helpful message

## Security Considerations

**Shell-like injection in process utilities:**
- Issue: `src/utils/process.ts` and `src/daemon/agent-runner.ts` use `spawn` (not `exec`), which is safe from shell injection, BUT `src/daemon/agent-runner.ts` line 102 passes `task.prompt` directly as part of system prompt string without escaping. If prompt contains special characters or quotes, could cause CLI to misinterpret.
- Files: `src/daemon/agent-runner.ts` (lines 126-129)
- Impact: Potential argument injection if task prompt contains backticks or quotes (though limited by spawn safety)
- Fix approach: Quote system prompt string properly; validate prompt doesn't contain newlines that could inject new flags

**No validation of output paths:**
- Issue: `src/inbox/reporter.ts` line 64 resolves `task.output` as a template, but doesn't validate it's within the configured workspace or inbox directory. A task with `output: ../../../etc/passwd` could write outside the intended directory.
- Files: `src/inbox/reporter.ts` (lines 63-67), `src/utils/template.ts` (unclear escaping)
- Impact: Path traversal vulnerability; untrusted task definitions could write to arbitrary locations
- Fix approach: Normalize and validate output path is within allowed directory; reject paths containing `..`

**Daemon PID file race condition:**
- Issue: `src/daemon/health.ts` lines 8-11 and 21-29 read/write PID file without atomic operations. Two daemon starts could both read old stale PID and both claim to be the daemon.
- Files: `src/daemon/health.ts` (lines 8-11, 21-29)
- Impact: Two daemons could run simultaneously, duplicating tasks and creating queue corruption
- Fix approach: Use atomic CAS (compare-and-swap) or flock for PID file; implement leader election logic

## Known Operational Issues

**Daemon drains on SIGTERM but doesn't persist unfinished state:**
- Issue: `src/daemon/orchestrator.ts` line 88 drains tasks on stop, but only writes reports for completed tasks. If daemon is interrupted during drain, partially-completed tasks lose their final status update.
- Files: `src/daemon/orchestrator.ts` (lines 71-101)
- Impact: Task status lost on abrupt shutdown; misleading reports
- Fix approach: Checkpoint task state before processing; implement write-ahead logging for task progress

**Log files grow unbounded:**
- Issue: `src/core/logger.ts` line 73 uses `appendFile` without rotation or truncation. Daemon logs to `daemon-{date}.log` but there's no mechanism to delete old logs or compress them.
- Files: `src/core/logger.ts` (lines 59-75), `src/core/config.ts` (line 34: `logRetentionDays` defined but never used)
- Impact: Long-running daemons accumulate gigabytes of logs; disk fills up silently
- Fix approach: Implement log rotation based on size or date; implement retention cleanup using `logRetentionDays` config value

**Incomplete error messages in JSON output:**
- Issue: `src/daemon/agent-runner.ts` line 147 truncates error message at 200 chars. If JSON parse fails due to large output, error context is lost.
- Files: `src/daemon/agent-runner.ts` (lines 134-151)
- Impact: Debugging failed agent output requires manual inspection; error message unhelpful
- Fix approach: Log full stdout/stderr to file separately; return hash or file reference in error; increase context window

---

*Concerns audit: 2026-02-23*
