import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Badge } from '@/components/ui/badge';
import { CouncilProposal } from '@/types/api';
import { Bot } from 'lucide-react';

// Maps OpenRouter model slugs to human-readable strategy labels
const STRATEGY_LABELS: Record<string, string> = {
  'openai/gpt-4o-mini': 'Analytical',
  'anthropic/claude-3.5-haiku': 'Creative',
  'google/gemini-2.0-flash-001': 'Concise',
  'x-ai/grok-2-1212': 'Structured',
};

function getStrategyLabel(model: string): string {
  return STRATEGY_LABELS[model] ?? model.split('/').pop() ?? model;
}

function getModelShortName(model: string): string {
  return model.split('/').pop()?.replace(/-/g, ' ') ?? model;
}

export function CouncilProposals({ proposals }: { proposals: CouncilProposal[] }) {
  if (!proposals || proposals.length === 0) return null;

  return (
    <div className="space-y-3 pt-2">
      <div className="flex items-center gap-2">
        <Bot className="h-4 w-4 text-muted-foreground" />
        <p className="text-sm font-medium">Council Proposals</p>
        <Badge variant="outline" className="text-xs">{proposals.length} models</Badge>
      </div>

      <Accordion className="w-full rounded-lg border divide-y overflow-hidden">
        {proposals.map((proposal, index) => (
          <AccordionItem key={index} value={`proposal-${index}`} className="border-0">
            <AccordionTrigger className="hover:no-underline px-4 py-3 hover:bg-muted/50 transition-colors">
              <div className="flex items-center gap-3 w-full">
                <Badge variant="secondary" className="text-xs shrink-0">
                  {getStrategyLabel(proposal.model)}
                </Badge>
                <span className="text-xs text-muted-foreground truncate">
                  {getModelShortName(proposal.model)}
                </span>
                <span className="ml-auto text-xs text-muted-foreground shrink-0 pr-2">
                  {proposal.usage?.total_tokens ?? 0} tokens
                </span>
              </div>
            </AccordionTrigger>
            <AccordionContent className="px-4 pb-4 pt-0">
              <div className="bg-muted/40 rounded-md p-3 text-sm whitespace-pre-wrap font-mono text-muted-foreground leading-relaxed border">
                {proposal.optimized_prompt}
              </div>
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </div>
  );
}
