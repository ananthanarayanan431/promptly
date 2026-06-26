from datetime import UTC, datetime, timedelta

from promptly.admin.api.schemas import AnalyticsPoint, AnalyticsResponse, AnalyticsSeries
from promptly.admin.services.analytics.helpers import fill_days as _fill_days


def test_fill_days_pads_missing_dates() -> None:
    now = datetime(2026, 6, 23, tzinfo=UTC)
    cutoff = now - timedelta(days=3)
    data_map = {"2026-06-21": 5, "2026-06-23": 2}
    result = _fill_days(cutoff, 3, data_map)
    assert len(result) == 3
    assert result[0].date == "2026-06-21"
    assert result[0].value == 5.0
    assert result[1].value == 0.0  # gap filled
    assert result[2].date == "2026-06-23"
    assert result[2].value == 2.0


def test_analytics_point_schema() -> None:
    p = AnalyticsPoint(date="2026-06-01", value=42.0)
    assert p.date == "2026-06-01"
    assert p.value == 42.0


def test_analytics_series_defaults() -> None:
    s = AnalyticsSeries(
        key="dau",
        label="Daily Active Users",
        total=8.0,
        time_range="Last 30 Days",
        data=[AnalyticsPoint(date="2026-06-01", value=3.0)],
    )
    assert s.chart_type == "line"
    assert s.color is None


def test_analytics_response_schema() -> None:
    r = AnalyticsResponse(
        view="platform_engagement",
        generated_at="2026-06-23T10:00:00Z",
        statics={"total_users": 42},
        series=[],
    )
    assert r.view == "platform_engagement"
