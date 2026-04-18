import sentry_sdk
from celery import Celery
from sentry_sdk.integrations.celery import CeleryIntegration

from app.config.app import get_app_settings
from app.config.redis import get_redis_settings

redis_settings = get_redis_settings()
app_settings = get_app_settings()

celery_app = Celery(
    "qa_chatbot",
    broker=str(redis_settings.REDIS_URL),
    backend=str(redis_settings.REDIS_URL),
    include=["app.workers.tasks"],
)

celery_app.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    timezone="UTC",
    enable_utc=True,
    task_track_started=True,
    task_acks_late=True,  # re-queue on worker crash
    worker_prefetch_multiplier=1,  # fair task distribution
)

if app_settings.SENTRY_DSN:
    sentry_sdk.init(
        dsn=app_settings.SENTRY_DSN.get_secret_value(),
        environment=app_settings.ENVIRONMENT,
        integrations=[CeleryIntegration()],
        traces_sample_rate=0.0,
        send_default_pii=False,
    )
