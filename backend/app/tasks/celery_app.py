from celery import Celery

celery_app = Celery(
    "algo_trading",
    broker="redis://redis:6379/0",
    backend="redis://redis:6379/1",
)

celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="Asia/Kolkata",
    enable_utc=True,
    task_track_started=True,
    task_time_limit=3600,
    task_soft_time_limit=3300,
    worker_max_tasks_per_child=50,
)

# Explicitly register task modules
celery_app.conf.include = ["app.tasks.backtest_tasks"]
