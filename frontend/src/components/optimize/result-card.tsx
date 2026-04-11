import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { buttonVariants, Button } from '@/components/ui/button';
import { JobResult } from '@/types/api';
import { CouncilProposals } from './council-proposals';
import { CheckCheck, Copy, Sparkles, ExternalLink } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import Link from 'next/link';

export function ResultCard({ result }: { result: JobResult }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(result.optimized_prompt);
    setCopied(true);
    toast.success('Copied to clipboard');
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Card className="w-full border-green-500/20 shadow-md">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-xl flex items-center gap-2 text-green-600 dark:text-green-500">
              <Sparkles className="h-5 w-5" />
              Optimization Complete
            </CardTitle>
            <CardDescription className="mt-1">
              Your prompt has been successfully optimized by the council.
            </CardDescription>
          </div>
          <Badge variant="outline" className="bg-green-50 text-green-700 hover:bg-green-100 dark:bg-green-900/30 dark:text-green-400 border-green-200 dark:border-green-800">
            {result.token_usage.total_tokens} tokens used
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        <div className="relative group">
          <div className="absolute right-2 top-2 opacity-0 group-hover:opacity-100 transition-opacity">
            <Button variant="secondary" size="icon" className="h-8 w-8" onClick={handleCopy}>
              {copied ? <CheckCheck className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
            </Button>
          </div>
          <div className="bg-muted/50 p-4 rounded-lg border text-sm whitespace-pre-wrap font-mono min-h-[100px]">
            {result.optimized_prompt}
          </div>
        </div>

        <CouncilProposals proposals={result.council_proposals} />
      </CardContent>
      {result.prompt_id && (
        <CardFooter className="bg-muted/30 border-t flex justify-between p-4">
          <p className="text-sm text-muted-foreground">
            Version saved to family history.
          </p>
          <Link href={`/versions/${result.prompt_id}`} className={buttonVariants({ variant: 'outline', size: 'sm', className: 'flex items-center gap-2' })}>
            View History
            <ExternalLink className="h-3 w-3" />
          </Link>
        </CardFooter>
      )}
    </Card>
  );
}

// Ensure the Badge is imported
import { Badge } from '@/components/ui/badge';
