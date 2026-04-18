.PHONY: install install-web install-api \
        web api dev \
        lint lint-web lint-api \
        format format-api \
        test test-web test-api

# ── Setup ─────────────────────────────────────────────────────────────────────

install: install-web install-api

install-web:
	cd apps/web && npm install

install-api:
	cd apps/api && python3 -m venv .venv \
		&& .venv/bin/pip install --quiet --upgrade pip \
		&& .venv/bin/pip install -r requirements.txt -r requirements-dev.txt

# ── Dev servers ───────────────────────────────────────────────────────────────

web:
	cd apps/web && npm run dev

api:
	cd apps/api && .venv/bin/uvicorn main:app --reload --port 8000

dev:
	$(MAKE) -j2 web api

# ── Lint ──────────────────────────────────────────────────────────────────────

lint: lint-web lint-api

lint-web:
	cd apps/web && npm run lint

lint-api:
	cd apps/api && .venv/bin/ruff check .

# ── Format ────────────────────────────────────────────────────────────────────

format: format-api

format-api:
	cd apps/api && .venv/bin/ruff format .

# ── Tests ─────────────────────────────────────────────────────────────────────

test: test-web test-api

test-web:
	cd apps/web && npm test

test-api:
	cd apps/api && .venv/bin/pytest
