# TTK developer tasks. Every target uses the worktree's own .venv (no activation needed).
# `make dev` reads APP_PORT from .env so each worktree can run on its own port; the Next.js app
# (web/) runs on WEB_PORT and proxies /api to the backend on APP_PORT.
-include .env
export

APP_PORT ?= 8000
WEB_PORT ?= 3000
PY ?= .venv/bin/python
# Only enabled modules are migrated (ENABLED_MODULES in .env, comma-separated; same default as
# app/config.py). A paused module's schema is never upgraded, downgraded or dropped here.
# Order: core, admin (payroll's tables reference admin.payment_modes), payroll, attendance, rest.
ENABLED_MODULES ?= attendance,payroll,admin
comma := ,
ENABLED_LIST := $(subst $(comma), ,$(ENABLED_MODULES))
MODULES := $(filter admin,$(ENABLED_LIST)) $(filter payroll,$(ENABLED_LIST)) \
	$(filter attendance,$(ENABLED_LIST)) $(filter-out admin payroll attendance,$(ENABLED_LIST))

.PHONY: dev migrate test lint fmt seed seed-demo create-admin web-install web-dev web-build web-lint web-test

dev:  ## FastAPI JSON API with reload on $APP_PORT
	$(PY) -m uvicorn app.main:app --reload --port $(APP_PORT)

## Upgrade core first, then every *enabled* module that already has migration files.
migrate:
	$(PY) -m alembic -n core upgrade head
	@echo "==> enabled modules: $(MODULES)"
	@for m in $(MODULES); do \
	  if ls migrations/$$m/versions/*.py >/dev/null 2>&1; then \
	    echo "==> alembic -n $$m upgrade head"; \
	    $(PY) -m alembic -n $$m upgrade head || exit 1; \
	  else \
	    echo "==> $$m: no migrations yet, skipping"; \
	  fi; \
	done

## pytest, then the web tests (web/test/README.md) when node_modules is installed.
test:
	$(PY) -m pytest
	@if [ -d web/node_modules ]; then $(MAKE) web-test; \
	 else echo "web/node_modules missing: skipping web tests (run make web-install)"; fi

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

## Sample employees, salaries and a month of payments into the real tables (refuses unless APP_ENV=dev).
seed-demo:
	$(PY) -m app.cli seed-demo

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

web-test:
	cd web && npm test
