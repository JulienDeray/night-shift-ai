import { z } from "zod";

/**
 * Known Claude tool names. Used to validate allowedTools at schema level.
 * Per locked CONTEXT.md decision: reject unknown tools at load time.
 */
export const KNOWN_CLAUDE_TOOLS = [
  'Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep',
  'WebFetch', 'WebSearch', 'Task', 'NotebookEdit',
] as const;

/** Helper to validate allowedTools entries against KNOWN_CLAUDE_TOOLS */
function validateAllowedTools(tools: string[] | undefined, ctx: z.RefinementCtx, pathPrefix: string[]): void {
  if (!tools) return;
  const knownSet = new Set<string>(KNOWN_CLAUDE_TOOLS);
  const unknown = tools.filter((t) => !knownSet.has(t) && !t.startsWith('mcp__'));
  for (const tool of unknown) {
    ctx.addIssue({
      code: 'custom',
      path: [...pathPrefix, 'allowedTools'],
      message: `Unknown tool "${tool}". Known tools: ${KNOWN_CLAUDE_TOOLS.join(', ')}, or any mcp__* tool`,
    });
  }
}

export const EnvVarSchema = z.union([
  z.string().min(1),
  z.object({ name: z.string().min(1), value: z.string() }).strict(),
]);

const RetrySchema = z.object({
  maxAttempts: z.number().int().positive().max(10),
  retryFrom: z.string().min(1),
}).strict();

export const BeadSchema = z.object({
  name: z.string().min(1),
  type: z.string().min(1),
  prompt: z.string().min(1),
  model: z.string().optional(),
  allowedTools: z.array(z.string()).optional(),
  env: z.array(EnvVarSchema).optional(),
  timeout: z.string().optional(),
  outputSchema: z.record(z.string(), z.unknown()),
  mcpConfig: z.string().optional(),     // relative path to MCP config file (or template variable)
  retry: RetrySchema.optional(),         // bead-level retry config
}).strict().superRefine((bead, ctx) => {
  if (bead.prompt.startsWith('/')) {
    ctx.addIssue({
      code: 'custom',
      path: ['prompt'],
      message: 'must be a relative path (no leading slash)',
    });
  }
  validateAllowedTools(bead.allowedTools, ctx, []);
  if (bead.mcpConfig && bead.mcpConfig.startsWith('/') && !bead.mcpConfig.startsWith('{{')) {
    ctx.addIssue({
      code: 'custom',
      path: ['mcpConfig'],
      message: 'must be a relative path or a template variable (no leading slash)',
    });
  }
});

export const ManifestSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  model: z.string().optional(),
  allowedTools: z.array(z.string()).optional(),
  env: z.array(EnvVarSchema).optional(),
  timeout: z.string().optional(),
  variables: z.record(z.string(), z.string()).optional(),
  beads: z.array(BeadSchema).min(1).superRefine((beads, ctx) => {
    const names = beads.map((b) => b.name);
    const dupes = names.filter((n, i) => names.indexOf(n) !== i);
    if (dupes.length > 0) {
      ctx.addIssue({
        code: 'custom',
        message: `Duplicate bead names: ${[...new Set(dupes)].join(', ')}`,
      });
    }
    // Validate retry.retryFrom references a preceding bead name
    for (let i = 0; i < beads.length; i++) {
      const bead = beads[i];
      if (bead.retry) {
        const precedingNames = names.slice(0, i);
        if (!precedingNames.includes(bead.retry.retryFrom)) {
          ctx.addIssue({
            code: 'custom',
            path: [i, 'retry', 'retryFrom'],
            message: `"${bead.retry.retryFrom}" is not a preceding bead name. Preceding beads: [${precedingNames.join(', ')}]`,
          });
        }
      }
    }
  }),
}).strict().superRefine((manifest, ctx) => {
  validateAllowedTools(manifest.allowedTools, ctx, []);
});

export type Manifest = z.infer<typeof ManifestSchema>;
