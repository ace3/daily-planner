import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, GitBranch, Plus, AlertCircle } from 'lucide-react';
import { useProjectStore } from '../stores/projectStore';
import { useMobileStore } from '../stores/mobileStore';
import { getTasksByProject } from '../lib/tauri';
import type { Task } from '../types/task';
import { TaskCreationModal } from '../components/TaskCreationModal';
import { GitPanel } from '../components/projects/GitPanel';
import KanbanBoard from '../components/kanban/KanbanBoard';

export const ProjectDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { projects } = useProjectStore();
  const { mobileMode } = useMobileStore();

  const project = useMemo(
    () => projects.find((p) => p.id === id),
    [projects, id]
  );

  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showGit, setShowGit] = useState(false);

  const loadTasks = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const data = await getTasksByProject(id);
      setTasks(data);
    } catch (e) {
      console.error('Failed to load project board tasks:', e);
      setTasks([]);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    loadTasks();
  }, [loadTasks]);

  if (!project) {
    return (
      <div className={`${mobileMode ? 'p-3' : 'p-6'} flex h-full flex-col items-center justify-center gap-4`}>
        <AlertCircle size={32} className="text-gray-500 dark:text-gray-400" />
        <p className="text-sm text-gray-500 dark:text-gray-400">Project not found.</p>
        <button
          onClick={() => navigate('/projects')}
          className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
        >
          Back to Projects
        </button>
      </div>
    );
  }

  return (
    <>
      <TaskCreationModal
        isOpen={showCreateModal}
        defaultProjectId={project.id}
        onClose={() => {
          setShowCreateModal(false);
          loadTasks();
        }}
      />

      <div className="flex h-full flex-col overflow-hidden bg-[#F5F5F7] dark:bg-[#0F1117]">
        <div className={`${mobileMode ? 'px-3 py-2' : 'px-4 py-3'} shrink-0 border-b border-gray-200 bg-white dark:bg-[#161B22] dark:border-[#30363D]`}>
          <button
            onClick={() => navigate('/projects')}
            className="mb-2 flex items-center gap-1.5 text-sm text-gray-500 dark:text-gray-400 transition-colors hover:text-gray-800 dark:hover:text-gray-200"
          >
            <ArrowLeft size={15} />
            Back
          </button>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <h1 className={`${mobileMode ? 'text-base' : 'text-lg'} truncate font-semibold text-gray-800 dark:text-[#E6EDF3]`}>
                {project.name} Board
              </h1>
              <p className="truncate text-xs text-gray-500 dark:text-gray-500">{project.path}</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button
                onClick={() => setShowGit((prev) => !prev)}
                className={`${mobileMode ? 'h-9 px-3' : 'h-8 px-2.5'} inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white text-sm text-gray-600 transition-colors hover:bg-gray-50 dark:border-[#30363D] dark:bg-[#21262D] dark:text-gray-200 dark:hover:bg-[#30363D]`}
              >
                <GitBranch size={13} />
                Git
              </button>
              <button
                onClick={() => setShowCreateModal(true)}
                className={`${mobileMode ? 'h-9 px-3' : 'h-8 px-2.5'} inline-flex items-center gap-1.5 rounded-lg bg-blue-600 text-sm font-medium text-white transition-colors hover:bg-blue-500`}
              >
                <Plus size={14} />
                New Task
              </button>
            </div>
          </div>
        </div>

        {showGit && (
          <div className="shrink-0 border-b border-gray-200 bg-white px-4 py-3 dark:border-[#30363D] dark:bg-[#161B22]">
            <GitPanel projectPath={project.path} projectId={project.id} />
          </div>
        )}

        <div className="flex-1 overflow-hidden">
          {loading ? (
            <div className="p-4 text-sm text-gray-500 dark:text-gray-400">Loading board...</div>
          ) : (
            <KanbanBoard tasks={tasks} lockedProjectId={project.id} />
          )}
        </div>
      </div>
    </>
  );
};
