import React, { useState, useMemo } from 'react';
import {
  DndContext,
  DragEndEvent,
  DragOverEvent,
  DragStartEvent,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
  DragOverlay,
} from '@dnd-kit/core';
import { arrayMove } from '@dnd-kit/sortable';
import { useNavigate } from 'react-router-dom';
import { Task, KANBAN_STATUSES, TaskStatus } from '../../types/task';
import { useTaskStore } from '../../stores/taskStore';
import { useProjectStore } from '../../stores/projectStore';
import KanbanColumn from './KanbanColumn';
import { SortableKanbanCard, KanbanCard } from './KanbanCard';
import KanbanFilters, { KanbanFilters as KanbanFiltersType } from './KanbanFilters';

interface KanbanBoardProps {
  tasks: Task[];
}

const KanbanBoard: React.FC<KanbanBoardProps> = ({ tasks }) => {
  const navigate = useNavigate();
  const { updateTaskStatus, reorderTasks } = useTaskStore();
  const { projects } = useProjectStore();

  const [filters, setFilters] = useState<KanbanFiltersType>({});
  const [activeTask, setActiveTask] = useState<Task | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  // Apply filters
  const filteredTasks = useMemo(() => {
    return tasks.filter((t) => {
      if (!KANBAN_STATUSES.includes(t.status as TaskStatus)) return false;
      if (filters.projectId && t.project_id !== filters.projectId) return false;
      if (filters.priority && t.priority !== filters.priority) return false;
      if (filters.agent && t.agent !== filters.agent) return false;
      if (filters.search) {
        const q = filters.search.toLowerCase();
        if (!t.title.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [tasks, filters]);

  // Tasks grouped by status, sorted by position
  const tasksByStatus = useMemo(() => {
    const map: Record<TaskStatus, Task[]> = {
      todo: [], improved: [], planned: [], in_progress: [], review: [],
      skipped: [], carried_over: [],
    };
    for (const t of filteredTasks) {
      if (map[t.status as TaskStatus]) {
        map[t.status as TaskStatus].push(t);
      }
    }
    // Sort each column by position
    for (const status of KANBAN_STATUSES) {
      map[status].sort((a, b) => a.position - b.position);
    }
    return map;
  }, [filteredTasks]);

  function findTaskById(id: string): Task | undefined {
    return tasks.find((t) => t.id === id);
  }

  function findColumnOfTask(id: string): TaskStatus | undefined {
    for (const status of KANBAN_STATUSES) {
      if (tasksByStatus[status].some((t) => t.id === id)) return status;
    }
    return undefined;
  }

  function handleDragStart(event: DragStartEvent) {
    const task = findTaskById(String(event.active.id));
    setActiveTask(task ?? null);
  }

  function handleDragOver(event: DragOverEvent) {
    const { active, over } = event;
    if (!over) return;

    const activeId = String(active.id);
    const overId = String(over.id);

    const activeColumn = findColumnOfTask(activeId);
    // over.id can be a status column or a task id
    const overColumn = KANBAN_STATUSES.includes(overId as TaskStatus)
      ? (overId as TaskStatus)
      : findColumnOfTask(overId);

    if (!activeColumn || !overColumn || activeColumn === overColumn) return;

    // Optimistically move the task to the new column in local store
    // The actual persistence happens on DragEnd
    useTaskStore.setState((state) => ({
      tasks: state.tasks.map((t) =>
        t.id === activeId ? { ...t, status: overColumn } : t
      ),
    }));
  }

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setActiveTask(null);

    if (!over) return;

    const activeId = String(active.id);
    const overId = String(over.id);

    const activeColumn = findColumnOfTask(activeId);
    const overColumn = KANBAN_STATUSES.includes(overId as TaskStatus)
      ? (overId as TaskStatus)
      : findColumnOfTask(overId);

    if (!activeColumn || !overColumn) return;

    if (activeColumn !== overColumn) {
      // Cross-column drop — status update
      try {
        await updateTaskStatus(activeId, overColumn);
      } catch (e) {
        console.error('Failed to update task status:', e);
      }
      return;
    }

    // Same column — reorder
    const colTasks = tasksByStatus[activeColumn];
    const oldIndex = colTasks.findIndex((t) => t.id === activeId);
    const newIndex = colTasks.findIndex((t) => t.id === overId);
    if (oldIndex === newIndex) return;

    const reordered = arrayMove(colTasks, oldIndex, newIndex);
    try {
      await reorderTasks(reordered.map((t) => t.id));
    } catch (e) {
      console.error('Failed to reorder tasks:', e);
    }
  }

  return (
    <div className="flex flex-col h-full" style={{ backgroundColor: '#F5F5F7' }}>
      {/* Filter bar */}
      <div className="px-4 shrink-0">
        <KanbanFilters projects={projects} onFilterChange={setFilters} />
      </div>

      {/* Board — horizontal scroll */}
      <div className="flex-1 overflow-x-auto overflow-y-hidden px-4 pb-4">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
        >
          <div className="flex gap-3 h-full" style={{ minWidth: 'max-content' }}>
            {KANBAN_STATUSES.map((status) => {
              const colTasks = tasksByStatus[status];
              return (
                <KanbanColumn
                  key={status}
                  status={status}
                  tasks={colTasks}
                >
                  {colTasks.map((task) => (
                    <SortableKanbanCard
                      key={task.id}
                      id={task.id}
                      task={task}
                      onClick={() => navigate(`/tasks/${task.id}`)}
                    />
                  ))}
                </KanbanColumn>
              );
            })}
          </div>

          {/* Drag overlay — renders the card floating under the pointer */}
          <DragOverlay>
            {activeTask ? (
              <KanbanCard task={activeTask} isDragging />
            ) : null}
          </DragOverlay>
        </DndContext>
      </div>
    </div>
  );
};

export default KanbanBoard;
