import { describe, it, expect } from 'vitest';
import { taskToMarkdown } from '../lib/markdown';
import type { Task } from '../types/task';

const makeTask = (overrides: Partial<Task> = {}): Task => ({
  id: 'test-id',
  date: '2026-03-22',
  session_slot: 1,
  title: 'Test task',
  notes: '',
  task_type: 'code',
  priority: 2,
  status: 'pending',
  estimated_min: null,
  actual_min: null,
  prompt_used: null,
  prompt_result: null,
  carried_from: null,
  position: 0,
  created_at: '2026-03-22T02:00:00Z',
  updated_at: '2026-03-22T02:00:00Z',
  completed_at: null,
  ...overrides,
});

describe('taskToMarkdown', () => {
  it('renders pending task', () => {
    const md = taskToMarkdown(makeTask());
    expect(md).toContain('[ ]');
    expect(md).toContain('Test task');
  });

  it('renders done task with checkbox', () => {
    const md = taskToMarkdown(makeTask({ status: 'done' }));
    expect(md).toContain('[x]');
  });

  it('includes estimated time when set', () => {
    const md = taskToMarkdown(makeTask({ estimated_min: 30 }));
    // markdown.ts appends `_(est. 30m)_` directly using estimated_min value
    expect(md).toContain('30m');
  });

  it('includes notes when present', () => {
    const md = taskToMarkdown(makeTask({ notes: 'Important context' }));
    expect(md).toContain('Important context');
  });

  it('renders high priority indicator', () => {
    const md = taskToMarkdown(makeTask({ priority: 1 }));
    expect(md).toContain('🔴');
  });

  it('renders medium priority indicator', () => {
    const md = taskToMarkdown(makeTask({ priority: 2 }));
    expect(md).toContain('🟡');
  });

  it('renders low priority indicator', () => {
    const md = taskToMarkdown(makeTask({ priority: 3 }));
    expect(md).toContain('🟢');
  });
});
