import React, { useEffect, useState } from 'react';
import { FileText, Plus, Pencil, Trash2, Save, X, Check, Copy } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { Input, Textarea } from '../components/ui/Input';
import { ConfirmModal } from '../components/ui/ConfirmModal';
import { usePromptTemplateStore } from '../stores/promptTemplateStore';
import type { PromptTemplate } from '../types/task';

export const TemplatesPage: React.FC = () => {
  const {
    promptTemplates,
    loading,
    error,
    fetchPromptTemplates,
    createTemplate,
    updateTemplate,
    deleteTemplate,
  } = usePromptTemplateStore();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [formName, setFormName] = useState('');
  const [formContent, setFormContent] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<PromptTemplate | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    fetchPromptTemplates().catch(() => null);
  }, [fetchPromptTemplates]);

  const filtered = promptTemplates.filter(
    (t) =>
      t.name.toLowerCase().includes(search.toLowerCase()) ||
      t.content.toLowerCase().includes(search.toLowerCase()),
  );

  const resetForm = () => {
    setEditingId(null);
    setIsCreating(false);
    setFormName('');
    setFormContent('');
    setFormError(null);
  };

  const startCreate = () => {
    resetForm();
    setIsCreating(true);
  };

  const startEdit = (t: PromptTemplate) => {
    setIsCreating(false);
    setEditingId(t.id);
    setFormName(t.name);
    setFormContent(t.content);
    setFormError(null);
  };

  const handleSave = async () => {
    const name = formName.trim();
    const content = formContent.trim();
    if (!name) { setFormError('Name is required.'); return; }
    if (!content) { setFormError('Content is required.'); return; }

    setSaving(true);
    setFormError(null);
    try {
      if (editingId) {
        await updateTemplate(editingId, name, content);
      } else {
        await createTemplate(name, content);
      }
      resetForm();
    } catch (e) {
      setFormError(String(e));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteTemplate(deleteTarget.id);
      if (editingId === deleteTarget.id) resetForm();
    } finally {
      setDeleteTarget(null);
    }
  };

  const handleCopy = async (t: PromptTemplate) => {
    await navigator.clipboard.writeText(t.content);
    setCopiedId(t.id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const showForm = isCreating || editingId !== null;

  return (
    <div className="flex-1 overflow-y-auto flex flex-col p-4 gap-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FileText size={16} className="text-gray-500 dark:text-[#8B949E]" />
          <h1 className="text-base font-semibold text-gray-900 dark:text-[#E6EDF3]">Templates</h1>
          {promptTemplates.length > 0 && (
            <span className="px-1.5 py-0.5 rounded text-[10px] font-medium border border-[#30363D] bg-[#161B22] text-[#8B949E]">
              {promptTemplates.length}
            </span>
          )}
        </div>
        <Button variant="primary" size="sm" icon={<Plus size={13} />} onClick={startCreate}>
          New Template
        </Button>
      </div>

      <div className="flex-1 lg:overflow-hidden grid grid-cols-1 lg:grid-cols-[1fr_420px] gap-4">
        {/* Template list */}
        <div className="flex flex-col gap-3">
          {/* Search */}
          <Input
            prefix={<FileText size={13} />}
            placeholder="Search templates..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />

          {loading && (
            <div className="text-xs text-[#8B949E] text-center py-8">Loading templates…</div>
          )}
          {error && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-400">
              {error}
            </div>
          )}

          {!loading && filtered.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 text-[#484F58]">
              <FileText size={28} className="mb-3 opacity-40" />
              {search ? (
                <p className="text-sm">No templates match "{search}"</p>
              ) : (
                <>
                  <p className="text-sm">No templates yet</p>
                  <p className="text-xs mt-1">Click "New Template" to create your first one.</p>
                </>
              )}
            </div>
          )}

          <div className="space-y-2">
            {filtered.map((t) => (
              <div
                key={t.id}
                className={`rounded-xl border p-4 transition-colors
                  ${editingId === t.id
                    ? 'border-blue-500/40 bg-blue-500/5'
                    : 'border-[#30363D] bg-[#161B22]'
                  }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-semibold text-[#E6EDF3] truncate">{t.name}</h3>
                    <p className="text-xs text-[#8B949E] mt-1 line-clamp-3 whitespace-pre-wrap leading-relaxed">
                      {t.content}
                    </p>
                  </div>
                  <div className="shrink-0 flex items-center gap-1">
                    <button
                      onClick={() => handleCopy(t)}
                      className="p-1.5 rounded-lg text-[#484F58] hover:text-[#8B949E] hover:bg-[#21262D] transition-colors cursor-pointer"
                      title="Copy content"
                    >
                      {copiedId === t.id ? (
                        <Check size={13} className="text-emerald-400" />
                      ) : (
                        <Copy size={13} />
                      )}
                    </button>
                    <button
                      onClick={() => startEdit(t)}
                      className="p-1.5 rounded-lg text-[#484F58] hover:text-[#8B949E] hover:bg-[#21262D] transition-colors cursor-pointer"
                      title="Edit"
                    >
                      <Pencil size={13} />
                    </button>
                    <button
                      onClick={() => setDeleteTarget(t)}
                      className="p-1.5 rounded-lg text-[#484F58] hover:text-red-400 hover:bg-red-500/10 transition-colors cursor-pointer"
                      title="Delete"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Editor panel */}
        {showForm && (
          <div className="rounded-xl border border-[#30363D] bg-[#161B22] p-4 flex flex-col gap-3 self-start">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-[#E6EDF3]">
                {editingId ? 'Edit Template' : 'New Template'}
              </h3>
              <button
                onClick={resetForm}
                className="text-[#484F58] hover:text-[#8B949E] cursor-pointer"
              >
                <X size={14} />
              </button>
            </div>

            <Input
              label="Name"
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
              placeholder="Template name"
            />

            <Textarea
              label="Content"
              value={formContent}
              onChange={(e) => setFormContent(e.target.value)}
              rows={10}
              placeholder="Template content — use {{variable}} for placeholders"
            />

            {formError && (
              <div className="text-xs text-red-400 whitespace-pre-wrap">{formError}</div>
            )}

            <div className="flex gap-2">
              <Button
                variant="primary"
                size="sm"
                icon={<Save size={12} />}
                onClick={handleSave}
                loading={saving}
                className="flex-1"
              >
                {editingId ? 'Save Changes' : 'Create Template'}
              </Button>
              <Button variant="ghost" size="sm" onClick={resetForm}>
                Cancel
              </Button>
            </div>
          </div>
        )}
      </div>

      <ConfirmModal
        open={deleteTarget !== null}
        title="Delete Template"
        description={deleteTarget ? `Delete "${deleteTarget.name}"? This cannot be undone.` : ''}
        confirmLabel="Delete template"
        variant="danger"
        onCancel={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
      />
    </div>
  );
};
