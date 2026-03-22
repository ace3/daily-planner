export interface PromptSourceInput {
  id: string;
  label: string;
  content: string;
  selected: boolean;
}

export type MergeWarningCode =
  | 'EMPTY_SOURCE'
  | 'SOURCE_TRUNCATED'
  | 'NO_SELECTED_SOURCES'
  | 'CONFLICT_RESOLVED';

export interface MergeWarning {
  code: MergeWarningCode;
  message: string;
  sourceId?: string;
}

export interface PromptSourceNormalized {
  id: string;
  label: string;
  content: string;
}

export interface PromptValidationResult {
  valid: PromptSourceNormalized[];
  warnings: MergeWarning[];
}

export interface MasterPromptResult {
  masterPrompt: string;
  warnings: MergeWarning[];
  usedSourceIds: string[];
  skippedSourceIds: string[];
}

const MAX_SOURCE_CHARS = 12000;
const MAX_DIRECTIVE_LINES = 80;
const MAX_SOURCE_COUNT = 20;

function normalizeWhitespace(value: string): string {
  return value.replace(/\r\n?/g, '\n').replace(/[ \t]+/g, ' ').trim();
}

function canonicalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[`*_#>\-]/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractDirectiveLines(text: string): string[] {
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => line.replace(/^[-*\d.)\s]+/, '').trim())
    .filter((line) => line.length > 0);

  const prioritized = lines.filter((line) => {
    const lower = line.toLowerCase();
    return (
      lower.includes('must') ||
      lower.includes('should') ||
      lower.includes('never') ||
      lower.includes('do not') ||
      lower.includes("don't") ||
      lower.includes('required') ||
      lower.includes('test') ||
      lower.includes('verify') ||
      lower.includes('implement') ||
      lower.includes('complete') ||
      lower.includes('production') ||
      lower.includes('loop') ||
      lower.includes('repeat') ||
      lower.includes('fix') ||
      lower.includes('plan')
    );
  });

  const selected = prioritized.length > 0 ? prioritized : lines;
  return selected.slice(0, MAX_DIRECTIVE_LINES);
}

function resolveConflictWarnings(allText: string): { directives: string[]; warnings: MergeWarning[] } {
  const normalized = allText.toLowerCase();
  const warnings: MergeWarning[] = [];
  const directives: string[] = [];

  const blocksClarifications = /never ask clarifying questions|do not ask clarifying questions|without clarifying questions/i.test(normalized);
  const asksClarifications =
    /ask clarifying questions|clarify before coding|ask questions before coding/.test(normalized) && !blocksClarifications;

  if (asksClarifications || blocksClarifications) {
    directives.push('Questions are allowed only for direct contradictions, critical security constraints, or blocking business-logic ambiguity.');
    if (asksClarifications && blocksClarifications) {
      warnings.push({
        code: 'CONFLICT_RESOLVED',
        message: 'Conflicting clarification rules detected and normalized to a strict execution-first policy with critical-question exceptions.',
      });
    }
  }

  const asksWorktreeAlways = /use git worktree for every change|always use git worktree|must use git worktree/i.test(normalized);
  const blocksWorktreeDefault = /do not use git worktree unless explicitly requested|don't use git worktree unless explicitly requested/i.test(normalized);

  if (asksWorktreeAlways || blocksWorktreeDefault) {
    directives.push('Do not use git worktrees unless explicitly requested.');
    if (asksWorktreeAlways && blocksWorktreeDefault) {
      warnings.push({
        code: 'CONFLICT_RESOLVED',
        message: 'Conflicting git-worktree guidance resolved to explicit-request-only behavior.',
      });
    }
  }

  return { directives, warnings };
}

export function validatePromptSources(sources: PromptSourceInput[]): PromptValidationResult {
  const warnings: MergeWarning[] = [];
  const valid: PromptSourceNormalized[] = [];

  const limitedSources = sources.slice(0, MAX_SOURCE_COUNT);

  for (const source of limitedSources) {
    if (!source.selected) continue;

    const normalized = normalizeWhitespace(source.content);
    if (!normalized) {
      warnings.push({
        code: 'EMPTY_SOURCE',
        message: `Skipped "${source.label}" because it is empty.`,
        sourceId: source.id,
      });
      continue;
    }

    if (normalized.length > MAX_SOURCE_CHARS) {
      const truncated = normalized.slice(0, MAX_SOURCE_CHARS);
      valid.push({ id: source.id, label: source.label, content: truncated });
      warnings.push({
        code: 'SOURCE_TRUNCATED',
        message: `Source "${source.label}" exceeded ${MAX_SOURCE_CHARS} characters and was truncated.`,
        sourceId: source.id,
      });
      continue;
    }

    valid.push({ id: source.id, label: source.label, content: normalized });
  }

  if (valid.length === 0) {
    warnings.push({
      code: 'NO_SELECTED_SOURCES',
      message: 'Select at least one non-empty selected prompt source.',
    });
  }

  return { valid, warnings };
}

function dedupeDirectives(lines: string[]): string[] {
  const seen = new Set<string>();
  const deduped: string[] = [];

  for (const line of lines) {
    const key = canonicalize(line);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    deduped.push(line);
  }

  return deduped;
}

function buildMasterPrompt(mergedDirectives: string[], conflictDirectives: string[], sourceLabels: string[]): string {
  const directives = dedupeDirectives([...mergedDirectives, ...conflictDirectives]);

  const lines: string[] = [];
  lines.push('# Task');
  lines.push(`Deliver a complete, production-ready result combining intent from: ${sourceLabels.join(', ')}.`);
  lines.push('');
  lines.push('## Constraints');

  if (directives.length === 0) {
    lines.push('- Complete implementation with full validation and passing tests.');
  } else {
    for (const directive of directives.slice(0, MAX_DIRECTIVE_LINES)) {
      lines.push(`- ${directive}`);
    }
  }

  lines.push('');
  lines.push('## Process');
  lines.push('Plan, implement, test, fix. Repeat until all criteria pass.');
  lines.push('');
  lines.push('## Done When');
  lines.push('- All requirements implemented and tested');
  lines.push('- No TODOs or placeholders');
  lines.push('- Tests pass');

  return lines.join('\n');
}

export function generateMasterPrompt(sources: PromptSourceInput[]): MasterPromptResult {
  const validation = validatePromptSources(sources);
  const usableSources = validation.valid;

  if (usableSources.length === 0) {
    const reason = validation.warnings.find((w) => w.code === 'NO_SELECTED_SOURCES')?.message
      ?? 'Select at least one non-empty selected prompt source.';
    throw new Error(reason);
  }

  const allText = usableSources.map((source) => source.content).join('\n');
  const mergedLines = dedupeDirectives(usableSources.flatMap((source) => extractDirectiveLines(source.content)));
  const conflictResolution = resolveConflictWarnings(allText);

  const masterPrompt = buildMasterPrompt(
    mergedLines,
    conflictResolution.directives,
    usableSources.map((source) => source.label),
  );

  const usedSourceIds = usableSources.map((source) => source.id);
  const skippedSourceIds = sources
    .filter((source) => source.selected && !usedSourceIds.includes(source.id))
    .map((source) => source.id);

  const warnings = [...validation.warnings.filter((w) => w.code !== 'NO_SELECTED_SOURCES'), ...conflictResolution.warnings];

  return {
    masterPrompt,
    warnings,
    usedSourceIds,
    skippedSourceIds,
  };
}
