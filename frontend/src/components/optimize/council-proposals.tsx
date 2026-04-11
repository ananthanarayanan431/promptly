import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { CouncilProposal } from '@/types/api';
import { Badge } from '@/components/ui/badge';
import { Bot } from 'lucide-react';

export function CouncilProposals({ proposals }: { proposals: CouncilProposal[] }) {
  if (!proposals || proposals.length === 0) return null;

  return (
    <div className="mt-6 space-y-4">
      <h3 className="text-sm font-medium flex items-center gap-2">
        <Bot className="h-4 w-4" />
        Council Proposals
      </h3>
      {/* @ts-expect-error Accordion type definition discrepancy from radix-ui */}
      <Accordion type="single" collapsible className="w-full border rounded-md px-4">
        {proposals.map((proposal, index) => (
          <AccordionItem key={index} value={`item-${index}`} className="last:border-0 border-b">
            <AccordionTrigger className="hover:no-underline py-4">
              <div className="flex items-center justify-between w-full pr-4">
                <span className="font-medium text-sm">{proposal.model}</span>
                <Badge variant="secondary" className="text-xs">
                  {proposal.usage?.total_tokens || 0} tokens
                </Badge>
              </div>
            </AccordionTrigger>
            <AccordionContent className="text-sm text-muted-foreground whitespace-pre-wrap pt-2 pb-4 bg-muted/30 p-4 rounded-md mb-2 border">
              {proposal.optimized_prompt}
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </div>
  );
}
