import { usePromptQueueStore, PromptJob } from '../stores/promptQueueStore';

interface UsePromptQueueResult {
  queue: PromptJob[];
  enqueue: (input: Pick<PromptJob, 'prompt' | 'projectPath' | 'provider'>) => void;
  activeJob: PromptJob | null;
  pendingCount: number;
}

export function usePromptQueue(): UsePromptQueueResult {
  const queue = usePromptQueueStore((s) => s.queue);
  const enqueue = usePromptQueueStore((s) => s.enqueue);
  const activeJob = queue.find((j) => j.status === 'running') ?? null;
  const pendingCount = queue.filter((j) => j.status === 'pending').length;
  return { queue, enqueue, activeJob, pendingCount };
}
