# TTK developer tasks. Every target uses the worktree's own .venv (no activation needed).
# `make dev` reads APP_PORT from .env so each worktree can run on its own port; the Next.js app
# (web/) runs on WEB_PORT and proxies /api to the backend on APP_PORT.
-include .env
export

APP_PORT ?= 8000
WEB_PORT ?= 3000
PY ?= .venv/bin/python
MODULES := stock attendance payroll admin

.PHONY: dev migrate test lint fmt seed create-admin web-install web-dev web-build web-lint

dev:  ## FastAPI JSON API with reload on $APP_PORT
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
	@if [ -d web/node_modules ]; then $(MAKE) web-lint; \
	 else echo "web/node_modules missing: skipping web lint (run make web-install)"; fi

fmt:
	$(PY) -m ruff format .
	$(PY) -m ruff check --fix .

seed:
	$(PY) -m app.cli seed

create-admin:
	$(PY) -m app.cli create-admin

# ---- Next.js frontend -------------------------------------------------------------------
web-install:
	cd web && npm install

web-dev:  ## Next.js dev server on $WEB_PORT, proxying /api to the backend on $APP_PORT
	cd web && API_URL=http://localhost:$(APP_PORT) npm run dev -- --port $(WEB_PORT)

web-build:
	cd web && API_URL=http://localhost:$(APP_PORT) npm run build

web-lint:
	cd web && npm run lint && npx tsc --noEmit
