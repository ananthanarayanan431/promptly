'use client';

import { useState } from 'react';
import { X, Copy, CheckCheck } from 'lucide-react';
import { toast } from 'sonner';

interface ResultPanelProps {
  content: string;
  onClose: () => void;
}

export function ResultPanel({ content, onClose }: ResultPanelProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(content);
    setCopied(true);
    toast.success('Copied');
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="w-[420px] shrink-0 border-l bg-card flex flex-col h-full">
      {/* Header */}
      <div className="shrink-0 flex items-center justify-between px-5 py-4 border-b">
        <span className="text-sm font-semibold text-foreground">Optimized Prompt</span>
        <button
          onClick={onClose}
          className="h-7 w-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          aria-label="Close panel"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-5 py-4">
        <p className="text-sm leading-7 whitespace-pre-wrap text-foreground">{content}</p>
      </div>

      {/* Footer */}
      <div className="shrink-0 border-t px-5 py-3">
        <button
          onClick={handleCopy}
          className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors border border-border"
        >
          {copied ? (
            <><CheckCheck className="h-3.5 w-3.5 text-green-500" /> Copied</>
          ) : (
            <><Copy className="h-3.5 w-3.5" /> Copy</>
          )}
        </button>
      </div>
    </div>
  );
}
