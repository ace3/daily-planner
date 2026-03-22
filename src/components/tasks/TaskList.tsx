import React from 'react';
import { TaskItem } from './TaskItem';
import { TaskForm } from './TaskForm';
import { SessionBadge } from '../session/SessionBadge';
import { useTaskStore } from '../../stores/taskStore';
import type { Task } from '../../types/task';
import { getLocalDate } from '../../lib/time';
import { useSettingsStore } from '../../stores/settingsStore';
import { addDays, format } from 'date-fns';
import { toast } from '../ui/Toast';

interface TaskListProps {
  slot: number;
  onTaskSelect?: (task: Task) => void;
}

export const TaskList: React.FC<TaskListProps> = ({ slot, onTaskSelect }) => {
  const { tasks, createTask, updateTaskStatus, deleteTask, carryTaskForward, updateTask, activeDate } =
    useTaskStore();
  const { settings } = useSettingsStore();
  const slotTasks = tasks.filter((t) => t.session_slot === slot);

  const handleCreate = async (input: Parameters<typeof createTask>[0]) => {
    await createTask(input);
    toast.success('Task added');
  };

  const handleStatusChange = async (id: string, status: string) => {
    await updateTaskStatus(id, status);
  };

  const handleDelete = async (id: string) => {
    await deleteTask(id);
    toast.success('Task deleted');
  };

  const handleCarryForward = async (id: string) => {
    const tz = settings?.timezone_offset ?? 7;
    const today = getLocalDate(tz);
    const tomorrow = format(addDays(new Date(today + 'T00:00:00'), 1), 'yyyy-MM-dd');
    await carryTaskForward(id, tomorrow, slot);
    toast.success('Task carried to tomorrow');
  };

  const handleNotesUpdate = async (id: string, notes: string) => {
    await updateTask({ id, notes });
  };

  const doneTasks = slotTasks.filter((t) => t.status === 'done');
  const pendingTasks = slotTasks.filter((t) => t.status !== 'done' && t.status !== 'carried_over');

  const slotNames: Record<number, string> = {
    1: '9AM–2PM Planning & Coding',
    2: '2PM–7PM Afternoon',
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-[#8B949E] uppercase tracking-wide">
            {slotNames[slot] ?? `Session ${slot}`}
          </span>
          <SessionBadge slot={slot} />
        </div>
        <span className="text-xs text-[#484F58]">
          {doneTasks.length}/{slotTasks.filter((t) => t.status !== 'carried_over').length}
        </span>
      </div>

      <TaskForm date={activeDate} sessionSlot={slot} onSubmit={handleCreate} compact />

      <div className="space-y-1.5">
        {pendingTasks.map((task) => (
          <TaskItem
            key={task.id}
            task={task}
            onStatusChange={handleStatusChange}
            onDelete={handleDelete}
            onCarryForward={handleCarryForward}
            onNotesUpdate={handleNotesUpdate}
            onSelect={onTaskSelect}
          />
        ))}
        {pendingTasks.length === 0 && (
          <div className="text-xs text-[#484F58] text-center py-3 border border-dashed border-[#21262D] rounded-lg">
            No tasks yet. Add one above.
          </div>
        )}
      </div>

      {doneTasks.length > 0 && (
        <div className="space-y-1.5">
          <span className="text-xs text-[#484F58]">Completed ({doneTasks.length})</span>
          {doneTasks.map((task) => (
            <TaskItem
              key={task.id}
              task={task}
              onStatusChange={handleStatusChange}
              onDelete={handleDelete}
              onCarryForward={handleCarryForward}
              onNotesUpdate={handleNotesUpdate}
              onSelect={onTaskSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
};
