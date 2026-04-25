export const DIMENSION_LABELS: Record<string, string> = {
  role_and_persona:               'Role & Persona',
  task_clarity:                   'Task Clarity',
  output_format:                  'Output Format',
  constraints_and_guardrails:     'Constraints & Guardrails',
  context_and_grounding:          'Context & Grounding',
  conciseness_and_signal_density: 'Conciseness & Signal Density',
  injection_robustness:           'Injection Robustness',
};

export function parseSeverity(item: string): { severity: string | null; text: string } {
  const m = item.match(/^\[([A-Z /]+)\]\s*/);
  if (!m) return { severity: null, text: item };
  const tag = m[1].trim();
  const severity = ['CRITICAL', 'MAJOR', 'MINOR'].includes(tag) ? tag : null;
  return { severity, text: item.slice(m[0].length) };
}

export function parseDimensionScore(value: string): { label: string; explanation: string } {
  const sep = value.indexOf(' — ');
  if (sep === -1) return { label: value.trim(), explanation: '' };
  return { label: value.slice(0, sep).trim(), explanation: value.slice(sep + 3).trim() };
}

export const SEVERITY_COLOR: Record<string, string> = {
  CRITICAL: '#ff6b7a',
  MAJOR:    '#ffb85c',
  MINOR:    '#7c9fff',
};

export const DIM_SCORE_COLOR: Record<string, string> = {
  STRONG:   '#5cffb1',
  ADEQUATE: '#7c5cff',
  WEAK:     '#ffb85c',
  MISSING:  '#ff6b7a',
};

export const ADVISORY_OVERALL_COLOR: Record<string, string> = {
  HIGH:     '#5cffb1',
  MODERATE: '#ffb85c',
  LOW:      '#ff6b7a',
};
