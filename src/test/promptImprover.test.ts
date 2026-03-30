import { describe, expect, it } from 'vitest';
import { detectIntent, buildImprovementPrompt } from '../lib/promptImprover';
import type { PromptIntent } from '../lib/promptImprover';

describe('detectIntent', () => {
  it('detects fix intent from keywords', () => {
    expect(detectIntent('fix the login bug')).toBe('fix');
    expect(detectIntent('resolve crash on startup')).toBe('fix');
    expect(detectIntent('This is broken')).toBe('fix');
    expect(detectIntent('there is a regression in auth')).toBe('fix');
  });

  it('detects feature intent', () => {
    expect(detectIntent('implement dark mode')).toBe('feature');
    expect(detectIntent('add export to CSV')).toBe('feature');
    expect(detectIntent('create a new dashboard')).toBe('feature');
    expect(detectIntent('build the payment flow')).toBe('feature');
  });

  it('detects refactor intent', () => {
    expect(detectIntent('refactor the auth module')).toBe('refactor');
    expect(detectIntent('simplify the query builder')).toBe('refactor');
    expect(detectIntent('extract helper functions')).toBe('refactor');
    expect(detectIntent('rename the component')).toBe('refactor');
  });

  it('detects debug intent', () => {
    expect(detectIntent('debug the memory leak')).toBe('debug');
    expect(detectIntent('investigate why tests fail')).toBe('debug');
    expect(detectIntent('diagnose the slow query')).toBe('debug');
  });

  it('detects test intent', () => {
    expect(detectIntent('write tests for auth')).toBe('test');
    expect(detectIntent('improve test coverage')).toBe('test');
    expect(detectIntent('run spec for the parser')).toBe('test');
  });

  it('detects review intent', () => {
    expect(detectIntent('review the PR changes')).toBe('review');
    expect(detectIntent('audit the security module')).toBe('review');
    expect(detectIntent('inspect the configuration')).toBe('review');
  });

  it('uses taskType as hint', () => {
    expect(detectIntent('handle this', 'review')).toBe('review');
    expect(detectIntent('do the thing', 'test')).toBe('test');
  });

  it('falls back to general for unrecognized prompts', () => {
    expect(detectIntent('do the thing')).toBe('general');
    expect(detectIntent('hello world')).toBe('general');
  });

  it('prompt keywords take precedence when taskType has no match', () => {
    expect(detectIntent('fix the login bug', 'other')).toBe('fix');
  });
});

describe('buildImprovementPrompt', () => {
  it('includes intent-specific structure for fix', () => {
    const result = buildImprovementPrompt('fix login', undefined, 'fix');
    expect(result).toContain('symptom');
    expect(result).toContain('reproduction steps');
  });

  it('includes intent-specific structure for feature', () => {
    const result = buildImprovementPrompt('add dark mode', undefined, 'feature');
    expect(result).toContain('acceptance criteria');
    expect(result).toContain('technical constraints');
  });

  it('includes intent-specific structure for refactor', () => {
    const result = buildImprovementPrompt('refactor auth', undefined, 'refactor');
    expect(result).toContain('current state');
    expect(result).toContain('target state');
    expect(result).toContain('invariants');
  });

  it('auto-detects intent when not explicitly provided', () => {
    const result = buildImprovementPrompt('fix the crash in the parser');
    expect(result).toContain('symptom');
  });

  it('uses general structure for unrecognized prompts', () => {
    const result = buildImprovementPrompt('do something cool');
    expect(result).toContain('goal');
    expect(result).toContain('success criteria');
  });

  it('includes task context when provided', () => {
    const result = buildImprovementPrompt('fix it', {
      title: 'Auth bug',
      notes: 'crashes on login',
    });
    expect(result).toContain('Auth bug');
    expect(result).toContain('crashes on login');
  });

  it('includes project path in context', () => {
    const result = buildImprovementPrompt('fix it', {
      title: 'Auth bug',
      notes: '',
      project: { name: 'MyApp', path: '/projects/myapp', id: '123' } as any,
    });
    expect(result).toContain('/projects/myapp');
  });

  it('always includes the raw prompt under Rough Prompt heading', () => {
    const result = buildImprovementPrompt('my specific task here');
    expect(result).toContain('## Rough Prompt');
    expect(result).toContain('my specific task here');
  });

  it('includes universal rules', () => {
    const result = buildImprovementPrompt('do something');
    expect(result).toContain('Be specific');
    expect(result).toContain('acceptance criteria');
    expect(result).toContain('Omit pleasantries');
  });

  it('explicitly forbids executing the task in the rewrite step', () => {
    const result = buildImprovementPrompt('implement dark mode');
    expect(result).toContain('Do NOT execute the task');
    expect(result).toContain('Do NOT claim implementation is done');
  });

  it('requires structured output sections for execution-ready prompts', () => {
    const result = buildImprovementPrompt('fix task detail cancellation issue');
    expect(result).toContain('Objective');
    expect(result).toContain('Context');
    expect(result).toContain('Requirements');
    expect(result).toContain('Acceptance Criteria');
    expect(result).toContain('Verification');
  });

  it('produces output under 1000 characters for simple prompts', () => {
    const result = buildImprovementPrompt('fix the bug');
    expect(result.length).toBeLessThan(1000);
  });

  it('starts with the role instruction', () => {
    const result = buildImprovementPrompt('something');
    expect(result.startsWith('You are a prompt rewriter')).toBe(true);
  });

  it('contains only the rewritten prompt instruction', () => {
    const result = buildImprovementPrompt('something');
    expect(result).toContain('Return ONLY the rewritten prompt');
  });
});
