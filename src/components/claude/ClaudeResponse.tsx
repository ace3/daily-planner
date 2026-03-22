import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Copy, Save, AlertCircle } from 'lucide-react';
import { Button } from '../ui/Button';
import { toast } from '../ui/Toast';

interface ClaudeResponseProps {
  response: string;
  loading: boolean;
  error: string | null;
  onSave?: () => Promise<void>;
}

export const ClaudeResponse: React.FC<ClaudeResponseProps> = ({ response, loading, error, onSave }) => {
  const handleCopy = () => {
    navigator.clipboard.writeText(response);
    toast.success('Copied to clipboard');
  };

  if (error) {
    return (
      <div className="flex items-start gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/30">
        <AlertCircle size={14} className="text-red-400 mt-0.5 shrink-0" />
        <span className="text-xs text-red-400">{error}</span>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-[#30363D] bg-[#161B22] overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-[#21262D]">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-blue-400" />
          <span className="text-xs text-[#8B949E]">Claude</span>
          {loading && (
            <span className="text-xs text-[#484F58] animate-pulse">thinking...</span>
          )}
        </div>
        <div className="flex gap-1">
          {response && (
            <Button variant="ghost" size="sm" icon={<Copy size={12} />} onClick={handleCopy}>
              Copy
            </Button>
          )}
          {onSave && response && (
            <Button variant="ghost" size="sm" icon={<Save size={12} />} onClick={onSave}>
              Save to task
            </Button>
          )}
        </div>
      </div>
      <div className="p-3 max-h-64 overflow-y-auto prose prose-invert prose-sm max-w-none text-xs text-[#E6EDF3]">
        {response ? (
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{response}</ReactMarkdown>
        ) : loading ? (
          <div className="flex gap-1 items-center text-[#484F58]">
            <span className="animate-bounce">▋</span>
          </div>
        ) : null}
      </div>
    </div>
  );
};
