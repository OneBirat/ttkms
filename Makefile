# TTK developer tasks. Every target uses the worktree's own .venv (no activation needed).
# `make dev` reads APP_PORT from .env so each worktree can run on its own port.
-include .env
export

APP_PORT ?= 8000
PY ?= .venv/bin/python
MODULES := stock attendance payroll admin

.PHONY: dev migrate test lint fmt seed create-admin

dev:
	$(PY) -m uvicorn app.main:app --reload --port $(APP_PORT)

## Upgrade core first, then every module that already has migration files.
migrate:
	$(PY) -m alembic -n core upgrade head
	@for m in $(MODULES); do \
	  if ls migrations/$$m/versions/*.py >/dev/null 2>&1; then \
	    echo "==> alembic -n $$m upgrade head"; \
	    $(PY) -m alembic -n $$m upgrade head || exit 1; \
	  else \
	    echo "==> $$m: no migrations yet, skipping"; \
	  fi; \
	done

test:
	$(PY) -m pytest

lint:
	$(PY) -m ruff check .
	$(PY) -m ruff format --check .

fmt:
	$(PY) -m ruff format .
	$(PY) -m ruff check --fix .

seed:
	$(PY) -m app.cli seed

create-admin:
	$(PY) -m app.cli create-admin
