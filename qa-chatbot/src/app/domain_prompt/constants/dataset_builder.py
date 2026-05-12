"""
Acceptance thresholds for the AutoData-inspired dataset builder.

Adapted from AutoData (Facebook Research, 2026):
  AutoData uses: weak_avg ≤ 65%, strong_avg − weak_avg ≥ 20%
  We use a stricter gap (30%) because weak/strong differ only by system prompt,
  not by model size — a smaller gap lets trivially easy questions through.
"""

WEAK_MAX_SCORE = 0.65  # weak solver must score AT or BELOW this
STRONG_MIN_SCORE = 0.5  # strong solver must score AT or ABOVE this
GAP_THRESHOLD = 0.30  # strong − weak gap must be at least this
