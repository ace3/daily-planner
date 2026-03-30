import React, { useEffect, useState } from 'react';
import { FolderOpen, Plus, Trash2, FolderSearch, ChevronUp, Save, MessageSquare, GitBranch } from 'lucide-react';
import { GitPanel } from '../components/projects/GitPanel';
import { useProjectStore } from '../stores/projectStore';
import { checkProjectPath, openFolderDialog } from '../lib/tauri';
import { deriveProjectName, isTauriRuntime, normalizeProjectPath, validateProjectPathLocally } from '../lib/projectPath';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { ConfirmModal } from '../components/ui/ConfirmModal';
import { toast } from '../components/ui/Toast';
import { useSessionDraftState } from '../hooks/useSessionDraftState';

export const ProjectsPage: React.FC = () => {
  const { projects, loading, fetchProjects, createProject, deleteProject, setProjectPrompt } = useProjectStore();
  const [draft, setDraft] = useSessionDraftState('projects-page-draft', {
    selectedPath: '',
    projectName: '',
    expandedPrompt: null as string | null,
    promptDrafts: {} as Record<string, string>,
  });
  const [adding, setAdding] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [promptSaving, setPromptSaving] = useState<string | null>(null);
  const [expandedGit, setExpandedGit] = useState<string | null>(null);
  const [checkingPath, setCheckingPath] = useState(false);
  const [pathValidation, setPathValidation] = useState<{ valid: boolean; message: string } | null>(null);
  const { selectedPath, projectName, expandedPrompt, promptDrafts } = draft;
  const tauriRuntime = isTauriRuntime();
  const addDisabled = !selectedPath.trim() || checkingPath || (!!pathValidation && !pathValidation.valid);

  useEffect(() => {
    fetchProjects();
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
    if (!tauriRuntime) {
      toast.info('Browse is only available in the desktop app. Enter the path manually.');
      return;
    }
    const path = await openFolderDialog();
    if (path) {
      const normalized = normalizeProjectPath(path);
      setDraft((prev) => ({ ...prev, selectedPath: normalized }));
      setPathValidation(null);
      if (!projectName) {
        setDraft((prev) => ({ ...prev, projectName: deriveProjectName(normalized) }));
      }
    }
  };

  const runPathCheck = async (showSuccessToast = false): Promise<boolean> => {
    const localValidation = validateProjectPathLocally(selectedPath);
    if (!localValidation.isValid) {
      setPathValidation({ valid: false, message: localValidation.message });
      toast.error(localValidation.message);
      return false;
    }

    if (!tauriRuntime) {
      const message = 'Path format looks valid. Folder existence can only be verified in the desktop app.';
      setPathValidation({ valid: true, message });
      if (showSuccessToast) toast.info(message);
      setDraft((prev) => ({ ...prev, selectedPath: localValidation.normalizedPath }));
      return true;
    }

    setCheckingPath(true);
    try {
      const result = await checkProjectPath(localValidation.normalizedPath);
      setPathValidation({ valid: result.is_valid, message: result.message });
      if (!result.is_valid) {
        toast.error(result.message);
        return false;
      }
      setDraft((prev) => ({ ...prev, selectedPath: result.normalized_path }));
      if (!projectName.trim()) {
        setDraft((prev) => ({ ...prev, projectName: deriveProjectName(result.normalized_path) }));
      }
      if (showSuccessToast) toast.success(result.message);
      return true;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to validate the project path';
      setPathValidation({ valid: false, message });
      toast.error(message);
      return false;
    } finally {
      setCheckingPath(false);
    }
  };

  const handleAdd = async () => {
    if (!selectedPath) return;
    const validPath = await runPathCheck(false);
    if (!validPath) return;

    const normalizedPath = normalizeProjectPath(selectedPath);
    const name = projectName.trim() || deriveProjectName(normalizedPath) || normalizedPath;
    setAdding(true);
    try {
      await createProject({ name, path: normalizedPath });
      setDraft((prev) => ({ ...prev, selectedPath: '', projectName: '' }));
      setPathValidation(null);
      toast.success('Project added');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to add project';
      toast.error(message);
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
            onChange={(e) => {
              setDraft((prev) => ({ ...prev, selectedPath: e.target.value }));
              setPathValidation(null);
            }}
            placeholder={tauriRuntime ? 'Select a folder or paste an absolute path...' : 'Paste an absolute path...'}
            className={inputClass}
          />
          <Button
            variant="ghost"
            size="sm"
            icon={<FolderSearch size={14} />}
            onClick={handleBrowse}
            disabled={!tauriRuntime}
            title={!tauriRuntime ? 'Browse is only available in the desktop app' : 'Browse'}
          >
            Browse
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => runPathCheck(true)}
            loading={checkingPath}
            disabled={!selectedPath.trim()}
            title="Validate path"
          >
            Check Path
          </Button>
        </div>

        {!tauriRuntime && (
          <p className="text-xs text-amber-500 dark:text-amber-400">
            Web mode: the Browse button is unavailable. Paste the absolute path manually, then run Check Path.
          </p>
        )}

        {pathValidation && (
          <p className={`text-xs ${pathValidation.valid ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500 dark:text-red-400'}`}>
            {pathValidation.message}
          </p>
        )}

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
            disabled={addDisabled}
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
              className={`flex items-center gap-3 px-4 py-3 ${i < projects.length - 1 || expandedGit === project.id || expandedPrompt === project.id ? 'border-b border-gray-100 dark:border-[#21262D]' : ''}`}
            >
              <FolderOpen size={15} className="text-blue-400 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-gray-900 dark:text-[#E6EDF3] truncate">{project.name}</div>
                <div className="text-xs text-gray-400 dark:text-[#484F58] truncate">{project.path}</div>
              </div>
              <button
                onClick={() => setExpandedGit((prev) => (prev === project.id ? null : project.id))}
                className="text-gray-400 hover:text-blue-400 dark:text-[#484F58] dark:hover:text-blue-400 transition-colors p-1 cursor-pointer"
                title="Git panel"
              >
                <GitBranch size={14} />
              </button>
              <button
                onClick={() =>
                  setDraft((prev) => ({
                    ...prev,
                    expandedPrompt: prev.expandedPrompt === project.id ? null : project.id,
                  }))
                }
                className="text-gray-400 hover:text-gray-600 dark:text-[#484F58] dark:hover:text-[#8B949E] transition-colors p-1 cursor-pointer"
                title="Edit project prompt"
              >
                {expandedPrompt === project.id ? <ChevronUp size={14} /> : <MessageSquare size={14} />}
              </button>
              <button
                onClick={() => setDeleteTarget(project.id)}
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

      <ConfirmModal
        open={!!deleteTarget}
        title="Remove Project"
        description="Remove this project? Tasks linked to it will be unlinked but not deleted."
        confirmLabel="Remove"
        variant="warning"
        onConfirm={async () => {
          if (deleteTarget) await deleteProject(deleteTarget);
          setDeleteTarget(null);
        }}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
};
