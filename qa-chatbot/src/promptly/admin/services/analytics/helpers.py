from __future__ import annotations

from datetime import datetime, timedelta

from promptly.admin.api.schemas import AnalyticsPoint


def fill_days(
    cutoff: datetime, days: int, data_map: dict[str, int | float]
) -> list[AnalyticsPoint]:
    """Return one AnalyticsPoint per day from cutoff+1 to cutoff+days, zero-filling gaps."""
    result = []
    for i in range(1, days + 1):
        d = str((cutoff + timedelta(days=i)).date())
        result.append(AnalyticsPoint(date=d, value=float(data_map.get(d, 0))))
    return result
