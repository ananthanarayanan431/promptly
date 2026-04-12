'use client';

import { useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { CheckCheck, Copy, Sparkles, ExternalLink, ChevronDown, ChevronUp } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Button, buttonVariants } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { CouncilProposals } from './council-proposals';
import { JobResult } from '@/types/api';

export function ResultCard({ result }: { result: JobResult }) {
  const [copied, setCopied] = useState(false);
  const [showOriginal, setShowOriginal] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(result.optimized_prompt);
    setCopied(true);
    toast.success('Copied to clipboard');
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Card className="w-full border-green-500/30">
      <CardHeader className="pb-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle className="text-xl flex items-center gap-2 text-green-600 dark:text-green-400">
              <Sparkles className="h-5 w-5" />
              Optimization Complete
            </CardTitle>
            <CardDescription className="mt-1">
              Synthesized by the chairman from {result.council_proposals?.length ?? 0} council proposals.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {result.version && (
              <Badge variant="outline" className="text-xs">
                v{result.version}
              </Badge>
            )}
            <Badge variant="secondary" className="text-xs">
              {result.token_usage?.total_tokens ?? 0} tokens
            </Badge>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Optimized result */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-foreground">Optimized Prompt</p>
            <Button variant="outline" size="sm" onClick={handleCopy} className="h-8 gap-1.5">
              {copied
                ? <><CheckCheck className="h-3.5 w-3.5 text-green-500" /> Copied</>
                : <><Copy className="h-3.5 w-3.5" /> Copy</>
              }
            </Button>
          </div>
          <div className="bg-muted/50 p-4 rounded-lg border text-sm whitespace-pre-wrap font-mono leading-relaxed">
            {result.optimized_prompt}
          </div>
        </div>

        {/* Original prompt toggle */}
        <div>
          <button
            onClick={() => setShowOriginal(v => !v)}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            {showOriginal ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            {showOriginal ? 'Hide' : 'Show'} original prompt
          </button>
          {showOriginal && (
            <div className="mt-2 bg-muted/30 p-4 rounded-lg border border-dashed text-sm whitespace-pre-wrap font-mono text-muted-foreground leading-relaxed">
              {result.original_prompt}
            </div>
          )}
        </div>

        {/* Council proposals */}
        <CouncilProposals proposals={result.council_proposals} />
      </CardContent>

      {result.prompt_id && (
        <CardFooter className="bg-muted/20 border-t flex items-center justify-between px-6 py-3">
          <p className="text-sm text-muted-foreground">
            Saved as version {result.version} in your prompt history.
          </p>
          <Link
            href={`/versions/${result.prompt_id}`}
            className={buttonVariants({ variant: 'outline', size: 'sm' })}
          >
            View History
            <ExternalLink className="ml-1.5 h-3.5 w-3.5" />
          </Link>
        </CardFooter>
      )}
    </Card>
  );
}
