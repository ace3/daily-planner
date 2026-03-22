import { describe, expect, it } from 'vitest';
import { generateMasterPrompt, validatePromptSources } from '../lib/masterPromptComposer';

describe('validatePromptSources', () => {
  it('reports selected empty inputs as recoverable warnings', () => {
    const validation = validatePromptSources([
      { id: 'a', label: 'A', content: '   ', selected: true },
      { id: 'b', label: 'B', content: 'Implement API and add tests', selected: true },
    ]);

    expect(validation.valid.length).toBe(1);
    expect(validation.warnings.some((w) => w.code === 'EMPTY_SOURCE')).toBe(true);
  });

  it('rejects when nothing usable is selected', () => {
    expect(() =>
      generateMasterPrompt([
        { id: 'a', label: 'A', content: '  ', selected: true },
      ]),
    ).toThrow(/at least one non-empty selected prompt/i);
  });
});

describe('generateMasterPrompt', () => {
  it('merges prompts and includes explicit iterative completion loop', () => {
    const result = generateMasterPrompt([
      {
        id: 'p1',
        label: 'Execution constraints',
        selected: true,
        content: `Implement complete, production-ready changes.\nDo not ask clarifying questions unless critical contradictions appear.\nRun tests and fix failures before finishing.`,
      },
      {
        id: 'p2',
        label: 'Style and quality',
        selected: true,
        content: `Write clean idiomatic code.\nPlan, execute, verify, fix, and repeat until done.\nNo TODOs.`,
      },
    ]);

    expect(result.masterPrompt).toContain('Execution Loop (Repeat Until Done)');
    expect(result.masterPrompt).toContain('Plan -> Execute -> Verify -> Fix -> Repeat');
    expect(result.masterPrompt).toContain('Completion Criteria (All Required)');
    expect(result.masterPrompt).toContain('No TODOs, placeholders, or partial implementations.');
    expect(result.warnings).toHaveLength(0);
  });

  it('resolves conflicting instructions into deterministic constraints', () => {
    const result = generateMasterPrompt([
      {
        id: 'p1',
        label: 'Strict mode',
        selected: true,
        content: 'Never ask clarifying questions. Execute directly.',
      },
      {
        id: 'p2',
        label: 'Question mode',
        selected: true,
        content: 'Ask clarifying questions before coding. Also use git worktree for every change.',
      },
      {
        id: 'p3',
        label: 'No worktree mode',
        selected: true,
        content: 'Do not use git worktree unless explicitly requested.',
      },
    ]);

    expect(result.masterPrompt).toContain('Questions are allowed only for direct contradictions, critical security constraints, or blocking business-logic ambiguity.');
    expect(result.masterPrompt).toContain('Do not use git worktrees unless explicitly requested.');
    expect(result.warnings.some((w) => w.code === 'CONFLICT_RESOLVED')).toBe(true);
  });

  it('handles very long prompts by truncating and warning', () => {
    const huge = 'A'.repeat(14000);

    const result = generateMasterPrompt([
      { id: 'big', label: 'Huge', selected: true, content: huge },
    ]);

    expect(result.masterPrompt.length).toBeGreaterThan(0);
    expect(result.warnings.some((w) => w.code === 'SOURCE_TRUNCATED')).toBe(true);
  });

  it('supports single prompt input while still producing task-loop structure', () => {
    const result = generateMasterPrompt([
      {
        id: 'single',
        label: 'Single',
        selected: true,
        content: 'Implement the feature with robust validation and tests.',
      },
    ]);

    expect(result.usedSourceIds).toEqual(['single']);
    expect(result.masterPrompt).toContain('Execution Loop (Repeat Until Done)');
  });
});
