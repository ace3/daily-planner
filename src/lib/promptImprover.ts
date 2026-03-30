import type { TaskContext } from '../components/claude/PromptBuilder';

export type PromptIntent = 'fix' | 'feature' | 'refactor' | 'debug' | 'test' | 'review' | 'general';

const INTENT_PATTERNS: Array<{ intent: PromptIntent; pattern: RegExp }> = [
  {
    intent: 'fix',
    pattern: /\b(fix|bug|broken|crash|error|regression|resolve)\b/i,
  },
  {
    intent: 'feature',
    pattern: /\b(implement|add|create|build|new feature)\b/i,
  },
  {
    intent: 'refactor',
    pattern: /\b(refactor|clean up|restructure|simplify|extract|rename)\b/i,
  },
  {
    intent: 'debug',
    pattern: /\b(debug|investigate|trace|diagnose|why)\b/i,
  },
  {
    intent: 'test',
    pattern: /\b(tests?|spec|coverage|assert)\b/i,
  },
  {
    intent: 'review',
    pattern: /\b(review|audit|check|inspect)\b/i,
  },
];

const INTENT_STRUCTURE: Record<PromptIntent, string> = {
  fix: 'Structure: symptom → expected behavior → reproduction steps → constraints',
  feature: 'Structure: goal → acceptance criteria → technical constraints → affected areas',
  refactor: 'Structure: current state → target state → invariants to preserve',
  debug: 'Structure: observed vs expected behavior → what was tried → relevant code',
  test: 'Structure: component under test → scenarios → framework/patterns',
  review: 'Structure: scope → quality dimensions → context',
  general: 'Structure: goal → context → constraints → success criteria',
};

/**
 * Detect intent from keywords in the user's prompt and optional task type.
 * taskType is checked first as an explicit hint before scanning the prompt text.
 */
export function detectIntent(prompt: string, taskType?: string): PromptIntent {
  if (taskType) {
    const normalised = taskType.toLowerCase().trim();
    for (const { intent, pattern } of INTENT_PATTERNS) {
      if (pattern.test(normalised)) return intent;
    }
  }

  for (const { intent, pattern } of INTENT_PATTERNS) {
    if (pattern.test(prompt)) return intent;
  }

  return 'general';
}

/**
 * Build an intent-aware meta-prompt that instructs the AI to rewrite the user's
 * rough prompt into a precise coding agent instruction.
 *
 * The meta-prompt section is kept to ~400-600 chars; the user's raw prompt is
 * appended verbatim under a "## Rough Prompt" heading.
 */
export function buildImprovementPrompt(
  userPrompt: string,
  ctx?: TaskContext,
  intent?: PromptIntent,
): string {
  const resolvedIntent = intent ?? detectIntent(userPrompt, undefined);
  const structure = INTENT_STRUCTURE[resolvedIntent];

  const lines: string[] = [
    'You are a prompt rewriter for coding agents.',
    'Your only job is to rewrite the rough prompt into a precise execution prompt.',
    'Do NOT execute the task. Do NOT claim implementation is done.',
    'Return ONLY the rewritten prompt text, with no explanations before or after it.',
    '',
  ];

  // Compact task context block — only include fields that carry information.
  if (ctx) {
    const ctxParts: string[] = [];
    if (ctx.title) ctxParts.push(`Task: ${ctx.title}`);
    if (ctx.notes) ctxParts.push(`Notes: ${ctx.notes}`);
    if (ctx.project?.path) ctxParts.push(`Project: ${ctx.project.path}`);
    if (ctxParts.length > 0) {
      lines.push('## Context');
      lines.push(ctxParts.join('\n'));
      lines.push('');
    }
  }

  lines.push('## Instructions');
  lines.push(structure);
  lines.push('');
  lines.push('Rules:');
  lines.push('- Be specific: reference files, functions, components, or APIs by name when possible');
  lines.push('- Include concrete acceptance criteria and verification commands');
  lines.push('- Include constraints, edge cases, and non-goals if implied by context');
  lines.push('- Prefer execution-ready wording for engineering work (not analysis-only wording)');
  lines.push("- Never output implementation progress reports like \"Done\" or \"Here's what changed\"");
  lines.push('- Omit pleasantries and meta-commentary');
  lines.push('');
  lines.push('Output format (use these headings):');
  lines.push('Objective');
  lines.push('Context');
  lines.push('Requirements');
  lines.push('Acceptance Criteria');
  lines.push('Verification');
  lines.push('');
  lines.push('## Rough Prompt');
  lines.push(userPrompt);

  return lines.join('\n');
}
