import { AdvisoryResponse } from '@/types/api';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { CheckCircle, XCircle, Lightbulb, Presentation } from 'lucide-react';

export function AdvisoryDisplay({ advisory }: { advisory: AdvisoryResponse }) {
  return (
    <div className="space-y-6">
      <Card className="w-full border-blue-500/20 bg-blue-500/5">
        <CardHeader>
          <CardTitle className="text-xl flex items-center gap-2 text-blue-700 dark:text-blue-400">
            <Presentation className="h-6 w-6" />
            Overall Assessment
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground whitespace-pre-wrap">{advisory.assessment}</p>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card className="border-green-500/20">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2 text-green-700 dark:text-green-500">
              <CheckCircle className="h-5 w-5" />
              Strengths
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {advisory.strengths.map((item, idx) => (
                <li key={idx} className="flex gap-2">
                  <span className="text-green-500 shrink-0">•</span>
                  <span className="text-sm">{item}</span>
                </li>
              ))}
              {advisory.strengths.length === 0 && (
                <li className="text-sm text-muted-foreground italic">No specific strengths identified.</li>
              )}
            </ul>
          </CardContent>
        </Card>

        <Card className="border-red-500/20">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2 text-red-700 dark:text-red-500">
              <XCircle className="h-5 w-5" />
              Weaknesses
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {advisory.weaknesses.map((item, idx) => (
                <li key={idx} className="flex gap-2">
                  <span className="text-red-500 shrink-0">•</span>
                  <span className="text-sm">{item}</span>
                </li>
              ))}
              {advisory.weaknesses.length === 0 && (
                <li className="text-sm text-muted-foreground italic">No critical weaknesses identified.</li>
              )}
            </ul>
          </CardContent>
        </Card>

        <Card className="md:col-span-2 border-amber-500/20">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2 text-amber-700 dark:text-amber-500">
              <Lightbulb className="h-5 w-5" />
              Actionable Improvements
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {advisory.improvements.map((item, idx) => (
                <li key={idx} className="flex gap-2">
                  <span className="text-amber-500 shrink-0">→</span>
                  <span className="text-sm">{item}</span>
                </li>
              ))}
              {advisory.improvements.length === 0 && (
                <li className="text-sm text-muted-foreground italic">No further improvements suggested.</li>
              )}
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
