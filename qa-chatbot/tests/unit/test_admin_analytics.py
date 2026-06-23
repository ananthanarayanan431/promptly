from promptly.admin.api.schemas import AnalyticsPoint, AnalyticsResponse, AnalyticsSeries


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
