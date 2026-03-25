import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FolderOpen, Plus, Trash2, FolderSearch, ChevronUp, Save, MessageSquare, GitBranch, RotateCcw } from 'lucide-react';
import { GitPanel } from '../components/projects/GitPanel';
import { useProjectStore } from '../stores/projectStore';
import { openFolderDialog } from '../lib/tauri';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { ConfirmModal } from '../components/ui/ConfirmModal';
import { toast } from '../components/ui/Toast';

export const ProjectsPage: React.FC = () => {
  const navigate = useNavigate();
  const {
    projects,
    trashedProjects,
    loading,
    fetchProjects,
    fetchTrashedProjects,
    createProject,
    deleteProject,
    restoreProject,
    hardDeleteProject,
    setProjectPrompt,
  } = useProjectStore();
  const [draft, setDraft] = useState({
    selectedPath: '',
    projectName: '',
    expandedPrompt: null as string | null,
    promptDrafts: {} as Record<string, string>,
  });
  const [adding, setAdding] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [hardDeleteTarget, setHardDeleteTarget] = useState<string | null>(null);
  const [promptSaving, setPromptSaving] = useState<string | null>(null);
  const [expandedGit, setExpandedGit] = useState<string | null>(null);
  const { selectedPath, projectName, expandedPrompt, promptDrafts } = draft;

  useEffect(() => {
    fetchProjects();
    fetchTrashedProjects();
  }, []);

  // Initialize prompt drafts from fetched projects
  useEffect(() => {
    setDraft((prev) => {
      const nextDrafts: Record<string, string> = {};
      projects.forEach((project) => {
        nextDrafts[project.id] = prev.promptDrafts[project.id] ?? project.prompt ?? '';
      });

      return {
        ...prev,
        promptDrafts: nextDrafts,
        expandedPrompt:
          prev.expandedPrompt && projects.some((project) => project.id === prev.expandedPrompt)
            ? prev.expandedPrompt
            : null,
      };
    });
  }, [projects, setDraft]);

  const handleBrowse = async () => {
    const path = await openFolderDialog();
    if (path) {
      setDraft((prev) => ({ ...prev, selectedPath: path }));
      if (!projectName) {
        const parts = path.replace(/\\/g, '/').split('/');
        setDraft((prev) => ({ ...prev, projectName: parts[parts.length - 1] || path }));
      }
    }
  };

  const handleAdd = async () => {
    if (!selectedPath) return;
    const name = projectName.trim() || selectedPath.split('/').pop() || selectedPath;
    setAdding(true);
    try {
      await createProject({ name, path: selectedPath });
      setDraft((prev) => ({ ...prev, selectedPath: '', projectName: '' }));
    } finally {
      setAdding(false);
    }
  };

  const handleSavePrompt = async (projectId: string) => {
    setPromptSaving(projectId);
    try {
      await setProjectPrompt(projectId, promptDrafts[projectId] ?? '');
      toast.success('Project prompt saved');
    } catch {
      toast.error('Failed to save project prompt');
    } finally {
      setPromptSaving(null);
    }
  };

  const sectionClass = "rounded-xl border border-gray-200 bg-white overflow-hidden dark:border-[#30363D] dark:bg-[#161B22]";
  const inputClass = "w-full bg-white border border-gray-200 rounded-lg text-gray-900 text-sm placeholder-gray-400 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 transition-colors px-3 py-2 dark:bg-[#0F1117] dark:border-[#30363D] dark:text-[#E6EDF3] dark:placeholder-[#484F58]";

  return (
    <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <FolderOpen size={16} className="text-gray-500 dark:text-[#8B949E]" />
        <h1 className="text-base font-semibold text-gray-900 dark:text-[#E6EDF3]">Projects</h1>
      </div>

      {/* Add project */}
      <div className={`${sectionClass} p-4 flex flex-col gap-3`}>
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide dark:text-[#8B949E]">Add Project</h3>

        <div className="flex gap-2">
          <input
            value={selectedPath}
            readOnly
            placeholder="Select a folder..."
            className={inputClass}
          />
          <Button variant="ghost" size="sm" icon={<FolderSearch size={14} />} onClick={handleBrowse}>
            Browse
          </Button>
        </div>

        {selectedPath && (
          <Input
            label="Project name (optional)"
            value={projectName}
            onChange={(e) => setDraft((prev) => ({ ...prev, projectName: e.target.value }))}
            placeholder="Defaults to folder name"
          />
        )}

        {selectedPath && (
          <Button
            variant="primary"
            size="sm"
            icon={<Plus size={14} />}
            onClick={handleAdd}
            loading={adding}
            disabled={!selectedPath}
          >
            Add Project
          </Button>
        )}
      </div>

      {/* Project list */}
      <div className={sectionClass}>
        {loading && (
          <div className="p-4 text-sm text-gray-500 dark:text-[#8B949E]">Loading...</div>
        )}
        {!loading && projects.length === 0 && (
          <div className="p-6 text-center text-sm text-gray-400 dark:text-[#484F58]">
            No projects yet. Add one above.
          </div>
        )}
        {projects.map((project, i) => (
          <div key={project.id}>
            <div
              role="button"
              tabIndex={0}
              onClick={() => navigate(`/projects/${project.id}`)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  navigate(`/projects/${project.id}`);
                }
              }}
              className={`flex items-center gap-3 px-4 py-3 ${i < projects.length - 1 || expandedGit === project.id || expandedPrompt === project.id ? 'border-b border-gray-100 dark:border-[#21262D]' : ''}`}
            >
              <FolderOpen size={15} className="text-blue-400 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-gray-900 dark:text-[#E6EDF3] truncate">{project.name}</div>
                <div className="text-xs text-gray-400 dark:text-[#484F58] truncate">{project.path}</div>
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setExpandedGit((prev) => (prev === project.id ? null : project.id));
                }}
                className="text-gray-400 hover:text-blue-400 dark:text-[#484F58] dark:hover:text-blue-400 transition-colors p-1 cursor-pointer"
                title="Git panel"
              >
                <GitBranch size={14} />
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setDraft((prev) => ({
                    ...prev,
                    expandedPrompt: prev.expandedPrompt === project.id ? null : project.id,
                  }));
                }}
                className="text-gray-400 hover:text-gray-600 dark:text-[#484F58] dark:hover:text-[#8B949E] transition-colors p-1 cursor-pointer"
                title="Edit project prompt"
              >
                {expandedPrompt === project.id ? <ChevronUp size={14} /> : <MessageSquare size={14} />}
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setDeleteTarget(project.id);
                }}
                className="text-gray-400 hover:text-red-400 transition-colors p-1 cursor-pointer"
                title="Remove project"
              >
                <Trash2 size={14} />
              </button>
            </div>

            {/* Git panel */}
            {expandedGit === project.id && (
              <GitPanel projectPath={project.path} projectId={project.id} />
            )}

            {/* Project prompt editor */}
            {expandedPrompt === project.id && (
              <div className="px-4 py-3 bg-gray-50 dark:bg-[#0F1117] border-b border-gray-100 dark:border-[#21262D] space-y-2">
                <div className="flex items-center gap-1.5">
                  <MessageSquare size={12} className="text-gray-500 dark:text-[#8B949E]" />
                  <span className="text-xs font-medium text-gray-500 dark:text-[#8B949E]">Project Prompt</span>
                  <span className="text-xs text-gray-400 dark:text-[#484F58]">— appended to Global Prompt</span>
                </div>
                <textarea
                  value={promptDrafts[project.id] ?? ''}
                  onChange={(e) =>
                    setDraft((prev) => ({
                      ...prev,
                      promptDrafts: { ...prev.promptDrafts, [project.id]: e.target.value },
                    }))
                  }
                  rows={4}
                  placeholder="e.g. This is a Next.js 14 project using App Router. All new routes go in src/app/."
                  className={`${inputClass} resize-none`}
                />
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-400 dark:text-[#484F58]">
                    {(promptDrafts[project.id] ?? '').length} chars
                  </span>
                  <Button
                    variant="secondary"
                    size="sm"
                    icon={<Save size={12} />}
                    onClick={() => handleSavePrompt(project.id)}
                    loading={promptSaving === project.id}
                  >
                    Save
                  </Button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Trash section */}
      <div className={sectionClass}>
        <div className="px-4 py-3 border-b border-gray-100 dark:border-[#21262D]">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide dark:text-[#8B949E]">
            Trash
          </h3>
        </div>
        {trashedProjects.length === 0 ? (
          <div className="p-4 text-sm text-gray-400 dark:text-[#484F58]">Trash is empty.</div>
        ) : (
          trashedProjects.map((project, i) => (
            <div
              key={project.id}
              className={`flex items-center gap-3 px-4 py-3 ${i < trashedProjects.length - 1 ? 'border-b border-gray-100 dark:border-[#21262D]' : ''}`}
            >
              <FolderOpen size={15} className="text-gray-400 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-gray-700 dark:text-[#C9D1D9] truncate">{project.name}</div>
                <div className="text-xs text-gray-400 dark:text-[#484F58] truncate">{project.path}</div>
              </div>
              <button
                onClick={async () => {
                  await restoreProject(project.id);
                  toast.success('Project restored');
                }}
                className="text-gray-400 hover:text-blue-400 transition-colors p-1 cursor-pointer"
                title="Restore project"
              >
                <RotateCcw size={14} />
              </button>
              <button
                onClick={() => setHardDeleteTarget(project.id)}
                className="text-gray-400 hover:text-red-400 transition-colors p-1 cursor-pointer"
                title="Delete permanently"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))
        )}
      </div>

      <ConfirmModal
        open={!!deleteTarget}
        title="Move Project To Trash"
        description="Move this project to trash? You can restore it later from the Trash section."
        confirmLabel="Move To Trash"
        variant="warning"
        onConfirm={async () => {
          if (deleteTarget) await deleteProject(deleteTarget);
          toast.success('Project moved to trash');
          setDeleteTarget(null);
        }}
        onCancel={() => setDeleteTarget(null)}
      />

      <ConfirmModal
        open={!!hardDeleteTarget}
        title="Delete Project Permanently"
        description="Delete this project permanently? All tasks and prompt jobs linked to it will be deleted forever."
        confirmLabel="Delete Permanently"
        variant="danger"
        onConfirm={async () => {
          if (hardDeleteTarget) await hardDeleteProject(hardDeleteTarget);
          toast.success('Project deleted permanently');
          setHardDeleteTarget(null);
        }}
        onCancel={() => setHardDeleteTarget(null)}
      />
    </div>
  );
};
