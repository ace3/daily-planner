import React, { useState } from 'react';
import { X, Send } from 'lucide-react';
import { Textarea } from '../ui/Input';
import { Button } from '../ui/Button';
import { ClaudeResponse } from './ClaudeResponse';
import { useClaude } from '../../hooks/useClaude';

interface QuickPromptProps {
  onClose: () => void;
  initialPrompt?: string;
}

export const QuickPrompt: React.FC<QuickPromptProps> = ({ onClose, initialPrompt = '' }) => {
  const [prompt, setPrompt] = useState(initialPrompt);
  const { response, loading, error, send } = useClaude();

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-[#161B22] border border-[#30363D] rounded-xl shadow-2xl w-full max-w-lg">
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#30363D]">
          <span className="text-sm font-semibold text-[#E6EDF3]">Quick Claude Prompt</span>
          <button
            onClick={onClose}
            className="text-[#484F58] hover:text-[#E6EDF3] cursor-pointer transition-colors"
          >
            <X size={15} />
          </button>
        </div>
        <div className="p-4 space-y-3">
          <Textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Ask Claude anything..."
            rows={3}
            autoFocus
          />
          <Button
            variant="primary"
            icon={<Send size={13} />}
            onClick={() => send(prompt)}
            loading={loading}
            disabled={!prompt.trim()}
            className="w-full"
          >
            Send
          </Button>
          {(response || loading || error) && (
            <ClaudeResponse response={response} loading={loading} error={error} />
          )}
        </div>
      </div>
    </div>
  );
};
