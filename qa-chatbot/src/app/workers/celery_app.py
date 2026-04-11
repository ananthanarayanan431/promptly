from celery import Celery

from app.config.redis import get_redis_settings

redis_settings = get_redis_settings()

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
