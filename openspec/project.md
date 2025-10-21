# Project Context

## Purpose
Deliver a self-hostable and deployable Bilibili live-stream chat overlay that mimics YouTube’s chat styling for use in OBS and browser sources. The project focuses on low-latency message rendering, extensive customization (themes, templates, plugins), and optional backend-mediated features such as translation, gift aggregation, and account-specific tooling for streamers.

## Tech Stack
- Python 3.12+, Tornado 6.x application server, SQLAlchemy ORM, cachetools, circuitbreaker, and custom service layer modules.
- Vue 2.7 SPA built with Vue CLI 5, Element UI component library, axios for API calls, and supporting tooling (Babel, ESLint, webpack via vue-cli-service).
- Packaging & ops: Docker image, npm scripts (`serve`, `build`, `build_common_server`), pip-managed backend dependencies, optional aiohttp-based translation providers, OBS/browser embedding assets under `frontend/dist/`.

## Project Conventions

### Code Style
- Backend Python follows PEP 8 with explicit type hints, module-level loggers, and async Tornado handlers; avoid wildcard imports outside of package `__init__`.
- Frontend enforces `eslint:recommended` + `plugin:vue/essential` with two-space indentation, no semicolons, single quotes, arrow functions without parens when possible, and strict spacing rules defined in `frontend/.eslintrc.js`.
- Use descriptive, snake_case names for Python modules/functions and kebab-case for Vue single-file components; keep translation/provider identifiers aligned with config keys.

### Architecture Patterns
- Tornado web application bootstrapped in `main.py` wires route collections from `api/*` modules; business logic resides in `services/*`, with persistence & models in `models/`.
- Frontend is a single-page app served from the backend’s static web root, communicating via JSON APIs; themes/templates are generated client-side and persisted through REST endpoints.
- Plugin system exposes hooks through `plugins/` and `services.plugin`, allowing dynamic capability loading without server restarts when admin plugins are enabled.
- Configuration is centralized in `config.py` and `data/config.ini`, supporting command-line overrides and hot-reload-friendly `config.reload`.

### Testing Strategy
- No formal automated test suite yet; rely on manual smoke testing by running `python main.py` plus `frontend/npm run serve` for iterative UI checks.
- Frontend linting via `npm run lint` acts as a static safety net; backend validation performed through targeted manual exercises (room connection, gift aggregation, translation queue).
- New work should include targeted unit or integration tests where feasible (e.g., service-level async tests) and update manual verification steps in `openspec/changes/*/tasks.md`.

### Git Workflow
- Trunk-based around `main`; contributors create feature branches per OpenSpec change-id (e.g., `add-theme-preset-switcher`), keep commits focused, and open PRs referencing the approved proposal.
- Rebase onto `main` before merge, run `npm run build` for frontend releases, and include any generated assets in release/tag commits when required.
- Specs must be approved via OpenSpec before implementation; do not push implementation code until associated proposal in `openspec/changes/<change-id>/` is accepted.

## Domain Context
- Integrates with Bilibili直播 (Live) ecosystem, consuming WebSocket danmaku feeds (`blivedm` submodule) and optionally Bilibili Open Live APIs for authenticated endpoints.
- Supports OBS/browser overlays, streamer-focused features (gift collapsing, highlight tiers), multilingual translation queues, and template customization reminiscent of YouTube/WeChat styles.
- User base includes bilingual streamers and operators needing reliable overlays under network constraints (CN vs overseas nodes).

## Important Constraints
- Preserve smooth playback inside OBS/browser sources, keeping bundles lean enough for typical streaming setups while retaining theme richness.
- Avoid blocking operations on the Tornado IOLoop so chat delivery stays low latency; leverage async services and caches instead of synchronous calls.
- Treat the plugin API as stable; breaking changes need explicit specs, migration plans, and versioning guidance.
- Translation and Open Live integrations rely on user-supplied credentials—never log secrets, honor provider quotas, and make queue sizes configurable.

## External Dependencies
- Bilibili danmaku WebSocket APIs via `blivedm`, plus optional Bilibili Open Live REST endpoints (requires access key/app id).
- Third-party translation providers configured in `data/config.ini` (Tencent Cloud Translate, Baidu Translate, OpenAI-compatible APIs).
- CDN/browser embedding in OBS, optional hosting via Docker (`xfgryujk/blivechat:latest`) or static hosting platforms (e.g., Vercel node configuration).
