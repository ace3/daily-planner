import React, { useState } from 'react';
import { Send, RefreshCw, BookOpen } from 'lucide-react';
import { Button } from '../ui/Button';
import { Textarea } from '../ui/Input';
import { PromptTemplates } from './PromptTemplates';
import { Modal } from '../ui/Modal';
import type { PromptTemplate } from '../../types/task';
import { useClaude } from '../../hooks/useClaude';
import { ClaudeResponse } from './ClaudeResponse';

interface PromptBuilderProps {
  initialPrompt?: string;
  onResponseSave?: (prompt: string, response: string) => Promise<void>;
}

export const PromptBuilder: React.FC<PromptBuilderProps> = ({
  initialPrompt = '',
  onResponseSave,
}) => {
  const [prompt, setPrompt] = useState(initialPrompt);
  const [showTemplates, setShowTemplates] = useState(false);
  const { response, loading, error, send, reset } = useClaude();

  const handleTemplateSelect = (template: PromptTemplate) => {
    // Replace {{variable}} placeholders with [variable] for user filling
    let filled = template.template;
    try {
      const vars: string[] = JSON.parse(template.variables);
      vars.forEach((v) => {
        filled = filled.replace(new RegExp(`\\{\\{${v}\\}\\}`, 'g'), `[${v}]`);
      });
    } catch {
      // variables field may be empty or malformed — use template as-is
    }
    setPrompt(filled);
    setShowTemplates(false);
  };

  const handleSend = async () => {
    if (!prompt.trim()) return;
    await send(prompt);
  };

  const handleSave = async () => {
    if (onResponseSave && response) {
      await onResponseSave(prompt, response);
    }
  };

  return (
    <div className="flex flex-col gap-3 h-full">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-[#E6EDF3]">Prompt Builder</h3>
        <Button
          variant="ghost"
          size="sm"
          icon={<BookOpen size={13} />}
          onClick={() => setShowTemplates(true)}
        >
          Templates
        </Button>
      </div>

      <Textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder="Write your prompt here... or pick a template above."
        rows={6}
        className="flex-1"
      />

      <div className="flex gap-2">
        <Button
          variant="primary"
          icon={<Send size={13} />}
          onClick={handleSend}
          loading={loading}
          disabled={!prompt.trim()}
          className="flex-1"
        >
          Send to Claude
        </Button>
        {(response || error) && (
          <Button variant="ghost" size="md" icon={<RefreshCw size={13} />} onClick={reset}>
            Reset
          </Button>
        )}
      </div>

      {(response || loading || error) && (
        <ClaudeResponse
          response={response}
          loading={loading}
          error={error}
          onSave={onResponseSave ? handleSave : undefined}
        />
      )}

      <Modal
        open={showTemplates}
        onClose={() => setShowTemplates(false)}
        title="Prompt Templates"
        size="lg"
      >
        <PromptTemplates onSelect={handleTemplateSelect} />
      </Modal>
    </div>
  );
};
