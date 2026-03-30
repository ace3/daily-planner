import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMobileStore } from '../stores/mobileStore';
import { useProjectStore } from '../stores/projectStore';
import { useJobStore } from '../stores/jobStore';
import { useTaskStore } from '../stores/taskStore';
import { PromptJob } from '../types/job';
import { Plus, X, Loader2, Clock } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { TaskCreationModal } from '../components/TaskCreationModal';
import KanbanBoard from '../components/kanban/KanbanBoard';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function elapsedTime(job: PromptJob): string {
  const start = job.started_at ?? job.created_at;
  try {
    return formatDistanceToNow(new Date(start), { addSuffix: false });
  } catch {
    return '—';
  }
}

function providerBadgeClass(provider: string): string {
  const p = provider.toLowerCase();
  if (p.includes('claude')) return 'bg-purple-900/50 text-purple-300';
  if (p.includes('opencode') || p.includes('openai')) return 'bg-blue-900/50 text-blue-300';
  return 'bg-gray-700/60 text-gray-300';
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface ActiveJobRowProps {
  job: PromptJob;
  projectName?: string;
  onCancel: (id: string) => void;
  mobile: boolean;
}

const ActiveJobRow: React.FC<ActiveJobRowProps> = ({ job, projectName, onCancel, mobile }) => (
  <div className="flex items-center gap-3 dark:bg-[#161B22] rounded-lg px-3 py-2.5 border border-white/5">
    <Loader2 size={14} className="animate-spin text-green-400 shrink-0" />
    <div className="flex-1 min-w-0">
      <p className={`truncate dark:text-[#E6EDF3] ${mobile ? 'text-sm' : 'text-sm'}`}>
        {job.prompt?.slice(0, 60) ?? 'Running…'}
      </p>
      <div className="flex items-center gap-2 mt-0.5">
        {projectName && (
          <span className="text-xs dark:text-gray-500 truncate">{projectName}</span>
        )}
        <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${providerBadgeClass(job.provider)}`}>
          {job.provider}
        </span>
        <span className="text-xs dark:text-gray-500 flex items-center gap-1">
          <Clock size={10} />
          {elapsedTime(job)}
        </span>
      </div>
    </div>
    <button
      onClick={() => onCancel(job.id)}
      className="shrink-0 w-9 h-9 flex items-center justify-center rounded-lg dark:hover:bg-red-900/30 dark:text-gray-400 dark:hover:text-red-400 transition-colors"
      aria-label="Cancel job"
    >
      <X size={14} />
    </button>
  </div>
);

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

export const Dashboard: React.FC = () => {
  const { mobileMode: m } = useMobileStore();
  const { projects, fetchProjects } = useProjectStore();
  const { activeJobs, fetchActiveJobs, cancelJob } = useJobStore();
  const { tasks, fetchTasks } = useTaskStore();
  const navigate = useNavigate();

  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);

  useEffect(() => {
    fetchProjects();
    fetchActiveJobs();
    fetchTasks();
  }, []);

  // Cmd+N / Ctrl+N — open create modal
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'n') {
        e.preventDefault();
        setIsCreateModalOpen(true);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  const handleCancelJob = async (jobId: string) => {
    try {
      await cancelJob(jobId);
    } catch (e) {
      console.error('Failed to cancel job:', e);
    }
  };

  return (
    <>
      <TaskCreationModal
        isOpen={isCreateModalOpen}
        onClose={() => {
          setIsCreateModalOpen(false);
          fetchTasks();
        }}
      />

      <div className="flex flex-col h-full overflow-hidden" style={{ backgroundColor: '#F5F5F7' }}>
        {/* Top bar */}
        <div className={`${m ? 'px-3 py-2' : 'px-4 py-3'} flex items-center justify-between shrink-0 bg-white border-b border-gray-200`}>
          <div className="flex items-center gap-3">
            <h1 className={`font-semibold text-gray-800 ${m ? 'text-base' : 'text-lg'}`}>
              Board
            </h1>
            {/* Running jobs indicator */}
            {activeJobs.length > 0 && (
              <span className="flex items-center gap-1.5 text-xs bg-green-50 text-green-600 border border-green-200 px-2 py-0.5 rounded-full">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                {activeJobs.length} running
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => navigate('/projects')}
              className="text-sm text-blue-600 hover:underline px-2 py-1"
            >
              Projects
            </button>
            <button
              onClick={() => setIsCreateModalOpen(true)}
              className={`flex items-center gap-1.5 px-3 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium transition-colors ${m ? 'h-9' : 'h-8'}`}
            >
              <Plus size={14} />
              New Task
            </button>
          </div>
        </div>

        {/* Active Jobs banner (collapsed list) */}
        {activeJobs.length > 0 && (
          <div className={`${m ? 'px-3' : 'px-4'} pt-3 shrink-0`}>
            <div className="space-y-2">
              {activeJobs.map((job) => {
                const project = projects.find((p) => p.id === job.project_id);
                return (
                  <ActiveJobRow
                    key={job.id}
                    job={job}
                    projectName={project?.name}
                    onCancel={handleCancelJob}
                    mobile={m}
                  />
                );
              })}
            </div>
          </div>
        )}

        {/* Kanban board — takes remaining height */}
        <div className="flex-1 overflow-hidden">
          <KanbanBoard tasks={tasks} />
        </div>
      </div>
    </>
  );
};
