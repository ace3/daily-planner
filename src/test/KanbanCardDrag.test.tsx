import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { Task } from '../types/task';
import { SortableKanbanCard } from '../components/kanban/KanbanCard';

const pointerDownMock = vi.fn();

vi.mock('@dnd-kit/sortable', () => ({
  useSortable: () => ({
    attributes: { 'data-drag-enabled': '1' },
    listeners: { onPointerDown: pointerDownMock },
    setNodeRef: () => {},
    transform: null,
    transition: undefined,
    isDragging: false,
  }),
}));

vi.mock('@dnd-kit/utilities', () => ({
  CSS: { Transform: { toString: () => '' } },
}));

function makeTask(overrides: Partial<Task>): Task {
  return {
    id: 't1',
    title: 'Drag me',
    description: '',
    notes: '',
    task_type: 'other',
    priority: 2,
    status: 'todo',
    estimated_min: null,
    actual_min: null,
    raw_prompt: null,
    improved_prompt: null,
    prompt_output: null,
    job_status: 'idle',
    job_id: null,
    provider: null,
    carried_from: null,
    position: 0,
    created_at: 'now',
    updated_at: 'now',
    completed_at: null,
    project_id: null,
    worktree_path: null,
    worktree_branch: null,
    worktree_status: null,
    deadline: null,
    plan: null,
    review_output: null,
    review_status: 'none',
    git_workflow: false,
    agent: null,
    ...overrides,
  };
}

describe('SortableKanbanCard', () => {
  beforeEach(() => {
    pointerDownMock.mockClear();
  });

  it('starts drag from anywhere on the card surface', () => {
    render(<SortableKanbanCard id="t1" task={makeTask({})} />);

    fireEvent.pointerDown(screen.getByTestId('kanban-card-t1'));
    expect(pointerDownMock).toHaveBeenCalledTimes(1);
  });
});
