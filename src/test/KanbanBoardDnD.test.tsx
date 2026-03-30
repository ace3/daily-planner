import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { invoke } from '@tauri-apps/api/core';
import KanbanBoard from '../components/kanban/KanbanBoard';
import { useProjectStore } from '../stores/projectStore';
import type { Task } from '../types/task';

let dndHandlers: {
  onDragStart?: (event: any) => void;
  onDragOver?: (event: any) => void;
  onDragEnd?: (event: any) => void | Promise<void>;
  onDragCancel?: () => void;
} = {};

vi.mock('@dnd-kit/core', () => ({
  DndContext: (props: any) => {
    dndHandlers = {
      onDragStart: props.onDragStart,
      onDragOver: props.onDragOver,
      onDragEnd: props.onDragEnd,
      onDragCancel: props.onDragCancel,
    };
    return props.children;
  },
  DragOverlay: (props: any) => props.children ?? null,
  PointerSensor: class {},
  useSensor: () => ({}),
  useSensors: () => ([]),
  closestCenter: () => null,
  useDroppable: () => ({ setNodeRef: () => {}, isOver: false }),
}));

vi.mock('@dnd-kit/sortable', () => ({
  SortableContext: (props: any) => props.children,
  verticalListSortingStrategy: {},
  useSortable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: () => {},
    transform: null,
    transition: undefined,
    isDragging: false,
  }),
  arrayMove: (arr: any[], from: number, to: number) => {
    const next = [...arr];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    return next;
  },
}));

vi.mock('@dnd-kit/utilities', () => ({
  CSS: { Transform: { toString: () => '' } },
}));

function makeTask(overrides: Partial<Task>): Task {
  return {
    id: 't1',
    title: 'Task One',
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

beforeEach(() => {
  vi.clearAllMocks();
  dndHandlers = {};
  useProjectStore.setState({
    projects: [],
    trashedProjects: [],
    selectedProject: null,
    loading: false,
    projectPrompt: null,
  } as any);
});

describe('KanbanBoard drag and drop', () => {
  it('persists status update on cross-column drop after drag-over optimistic move', async () => {
    const mockInvoke = vi.mocked(invoke);
    mockInvoke.mockResolvedValue(undefined);

    render(
      <MemoryRouter>
        <KanbanBoard
          tasks={[
            makeTask({ id: 't1', status: 'todo', title: 'Move me' }),
            makeTask({ id: 't2', status: 'planned', title: 'Target', position: 1 }),
          ]}
        />
      </MemoryRouter>
    );

    act(() => {
      dndHandlers.onDragStart?.({ active: { id: 't1' } });
      dndHandlers.onDragOver?.({ active: { id: 't1' }, over: { id: 'planned' } });
    });

    await act(async () => {
      await dndHandlers.onDragEnd?.({ active: { id: 't1' }, over: { id: 'planned' } });
    });

    expect(mockInvoke).toHaveBeenCalledWith('update_task_status', { id: 't1', status: 'planned' });
  });
});
