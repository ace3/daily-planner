import React, { useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import { Input } from '../ui/Input';
import type { PromptTemplate } from '../../types/task';
import { getPromptTemplates } from '../../lib/tauri';

interface PromptTemplatesProps {
  onSelect: (template: PromptTemplate) => void;
}

export const PromptTemplates: React.FC<PromptTemplatesProps> = ({ onSelect }) => {
  const [templates, setTemplates] = useState<PromptTemplate[]>([]);
  const [search, setSearch] = useState('');

  useEffect(() => {
    getPromptTemplates().then(setTemplates).catch(console.error);
  }, []);

  const filtered = templates.filter(
    (t) =>
      t.name.toLowerCase().includes(search.toLowerCase()) ||
      t.content.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-3">
      <Input
        prefix={<Search size={13} />}
        placeholder="Search templates..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      <div className="space-y-1.5">
        {filtered.map((t) => (
          <button
            key={t.id}
            onClick={() => onSelect(t)}
            className="w-full text-left p-3 rounded-lg border border-[#30363D] bg-[#161B22] hover:border-blue-500/40 hover:bg-blue-500/5 transition-colors cursor-pointer group"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium text-[#E6EDF3] group-hover:text-blue-400 transition-colors">
                {t.name}
              </span>
            </div>
            <p className="text-xs text-[#484F58] mt-1 line-clamp-2">
              {t.content.slice(0, 100)}...
            </p>
          </button>
        ))}
        {filtered.length === 0 && (
          <div className="text-xs text-[#484F58] text-center py-6">
            No templates found.
          </div>
        )}
      </div>
    </div>
  );
};
