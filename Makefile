# Algo Trading System - Development Commands

.PHONY: up down build logs backend-shell frontend-shell db-shell migrate seed test

# ── Docker ──
up:
	docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d

down:
	docker compose down

build:
	docker compose -f docker-compose.yml -f docker-compose.dev.yml build

logs:
	docker compose logs -f

logs-backend:
	docker compose logs -f backend

logs-frontend:
	docker compose logs -f frontend

# ── Shell Access ──
backend-shell:
	docker compose exec backend bash

frontend-shell:
	docker compose exec frontend sh

db-shell:
	docker compose exec postgres psql -U algotrader -d algo_trading

redis-shell:
	docker compose exec redis redis-cli

# ── Database ──
migrate:
	docker compose exec backend alembic upgrade head

migrate-create:
	docker compose exec backend alembic revision --autogenerate -m "$(msg)"

migrate-downgrade:
	docker compose exec backend alembic downgrade -1

seed:
	docker compose exec backend python -m scripts.seed_instruments
	docker compose exec backend python -m scripts.seed_historical_data

# ── Testing ──
test:
	docker compose exec backend pytest -v

test-cov:
	docker compose exec backend pytest --cov=app --cov-report=html

# ── Celery ──
celery-worker:
	docker compose exec backend celery -A app.tasks.celery_app worker --loglevel=info

celery-beat:
	docker compose exec backend celery -A app.tasks.celery_app beat --loglevel=info

# ── Utilities ──
create-superuser:
	docker compose exec backend python -m scripts.create_superuser

format:
	docker compose exec backend ruff format app/
	docker compose exec backend ruff check --fix app/

clean:
	docker compose down -v --remove-orphans
	docker system prune -f
