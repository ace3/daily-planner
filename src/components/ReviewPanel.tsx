import React, { useState } from 'react';
import { Loader2, ThumbsUp, Wrench, Copy, Check } from 'lucide-react';

interface ReviewPanelProps {
  taskId: string;
  reviewOutput: string | null | undefined;
  reviewStatus: string | null | undefined;
  onReviewRequested: () => void;
  onApproved: () => void;
  onFixRequested: () => void;
  reviewing: boolean;
  approving: boolean;
  fixing: boolean;
  error: string | null;
}

export const ReviewPanel: React.FC<ReviewPanelProps> = ({
  reviewOutput,
  reviewStatus,
  onReviewRequested,
  onApproved,
  onFixRequested,
  reviewing,
  approving,
  fixing,
  error,
}) => {
  const [copied, setCopied] = useState(false);

  const isApproved = reviewStatus === 'approved';

  return (
    <div className="dark:bg-[#161B22] rounded-xl p-4 space-y-3 border dark:border-[#30363D]">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h3 className="font-semibold dark:text-[#E6EDF3] text-sm uppercase tracking-wide">
          AI Review
        </h3>
        {reviewStatus && reviewStatus !== 'none' && (
          <span
            className={`px-2 py-0.5 rounded text-xs font-medium ${
              isApproved
                ? 'bg-green-500/20 text-green-400'
                : reviewStatus === 'pending'
                ? 'bg-yellow-500/20 text-yellow-400'
                : 'bg-red-500/20 text-red-400'
            }`}
          >
            {isApproved ? 'Approved' : reviewStatus === 'pending' ? 'Needs Review' : 'Needs Fix'}
          </span>
        )}
      </div>

      {/* Request review button */}
      {!isApproved && (
        <button
          onClick={onReviewRequested}
          disabled={reviewing || fixing}
          className="flex items-center gap-2 px-4 py-2 rounded-lg dark:bg-blue-700 hover:dark:bg-blue-600 disabled:opacity-50 text-white text-sm min-h-[44px]"
        >
          {reviewing ? <Loader2 size={16} className="animate-spin" /> : null}
          {reviewing ? 'Reviewing...' : 'Request AI Review'}
        </button>
      )}

      {/* Review output */}
      {reviewOutput && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs dark:text-gray-500 uppercase tracking-wide font-medium">
              Review Feedback
            </span>
            <button
              onClick={() => {
                navigator.clipboard.writeText(reviewOutput);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
              className="flex items-center gap-1 text-xs px-2 py-1 rounded dark:bg-[#21262D] dark:hover:bg-[#30363D] min-h-[32px]"
            >
              {copied ? <Check size={12} className="text-green-400" /> : <Copy size={12} />}
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <pre className="p-3 rounded-lg dark:bg-[#0D1117] text-xs font-mono dark:text-[#E6EDF3] whitespace-pre-wrap max-h-[300px] overflow-y-auto border dark:border-[#30363D] leading-5">
            {reviewOutput}
          </pre>

          {/* Actions */}
          {!isApproved && (
            <div className="flex gap-2 flex-wrap">
              <button
                onClick={onApproved}
                disabled={approving}
                className="flex items-center gap-2 px-4 py-2 rounded-lg dark:bg-green-700 hover:dark:bg-green-600 disabled:opacity-50 text-white text-sm min-h-[44px]"
              >
                {approving ? <Loader2 size={16} className="animate-spin" /> : <ThumbsUp size={16} />}
                {approving ? 'Approving...' : 'Approve'}
              </button>
              <button
                onClick={onFixRequested}
                disabled={fixing}
                className="flex items-center gap-2 px-4 py-2 rounded-lg dark:bg-orange-700 hover:dark:bg-orange-600 disabled:opacity-50 text-white text-sm min-h-[44px]"
              >
                {fixing ? <Loader2 size={16} className="animate-spin" /> : <Wrench size={16} />}
                {fixing ? 'Re-running...' : 'Fix The Feedback'}
              </button>
            </div>
          )}

          {isApproved && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-green-500/10 border border-green-500/30 text-green-400 text-sm">
              <ThumbsUp size={14} />
              Task approved — implementation accepted.
            </div>
          )}
        </div>
      )}

      {error && (
        <p className="text-xs text-red-400 whitespace-pre-wrap">Error: {error}</p>
      )}
    </div>
  );
};
