# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Common Commands

```bash
# Start both servers (recommended for dev)
bash scripts/start-dev.sh

# Stop dev servers
bash scripts/stop-dev.sh

# Backend (manual)
cd backend
pip install -r requirements.txt
PYTHONPATH=. python3 server.py

# Backend (uvicorn) — port 8765 to avoid conflict with other projects
cd backend && PYTHONPATH=. uvicorn server:app --host 0.0.0.0 --port 8765

# Frontend (manual, match backend port)
cd frontend && VITE_BACKEND_PORT=8765 npx vite --host 0.0.0.0 --port 3000

# TypeScript check
cd frontend && npx tsc -b

# Production build
cd frontend && npm run build

# Tests (all) — run from repo root
python3 -m pytest tests/ -v

# Single test file
python3 -m pytest tests/test_task_service.py -v

# Smoke test (requires running backend)
bash scripts/smoke_game_api.sh http://127.0.0.1:8765
```

**Port notes:** The backend runs on `:8765` (not `:8000` to avoid conflicts with other projects). Vite proxies `/api` to `127.0.0.1:8765`. WebSocket connects directly to the backend port (bypasses proxy). Requires `hermes-agent` installed at `~/.hermes/hermes-agent/`.

## Architecture

This is a **multi-Agent task management & orchestration platform** — the player manages AI agents collaborating on software projects. It's a full-stack app with task chain DAG, real-time WebSocket communication, and LLM-powered agent reasoning.

### Stack
- **Frontend:** React 18 + Vite + TypeScript + Zustand 5.x (pure React card UI, **Phaser removed**)
- **Backend:** Starlette + Uvicorn (Python, async)
- **Storage:** SQLite (`backend/data/`)

### Data Flow

```
Browser (React card UI)
    │
    ├── REST /api/*           → Starlette routes (server.py → task/service.py)
    ├── WS /ws/gateway        → GatewayHub broadcast (task events)
    └── SSE /api/task/multi-round/stream → Agent LLM streaming
```

1. **World state** is loaded via `GET /api/task/state` → returns `TaskWorldSnapshot` (agents, tasks, event_log).
2. **Agent chat** — Lord entry point via `POST /api/task/lord/chat`, peer delegation via `@agent | message` handoffs, idle agent social chat via `POST /api/task/agent/social-chat`.
3. **Task chain** — LLM outputs `[[GAME_EVENT:{"type":"task_chain_create",...}]]` for natural language project creation. Tasks support `depends_on` DAG and `locked` status.
4. **Message receipt** — Peer delegation replies are injected back into the invoker's Hermes session via `_inject_session_message()`.

### Key Frontend Structure

| Path | Role |
|------|------|
| `src/App.tsx` | Root component: loads state, connects WS gateway, auto-selects Lord agent |
| `src/store/taskStore.ts` | Zustand store for `TaskWorldSnapshot`, `loadState()`, `assignTask()`, gateway status |
| `src/store/uiStore.ts` | Zustand store for UI-only state: selected agent, inference stream entries, floating windows, docked panels |
| `src/services/gameApi.ts` | REST client re-export hub for all `/api/task/*` endpoints (delegates to agentApi, taskApi, chatApi, etc.) |
| `src/services/gameGateway.ts` | WebSocket client for `/ws/gateway` — subscribes to `task` channel |
| `src/services/multiAgentGateway.ts` | WebSocket client for `/ws/multi-agent` — per-agent LLM chat |
| `src/ui/CenterStage.tsx` | Main layout: TopBar + LeftStudioPanel + Agent card grid + RightPanel + BottomBar |
| `src/ui/AgentCard.tsx` | Agent card with avatar, profession, chat/detail buttons (React.memo) |
| `src/ui/ConversationCard.tsx` | Dual-agent conversation display |
| `src/ui/BottomBar.tsx` | Chat input bar (textarea, send, file upload, menus) |
| `src/ui/TaskMonitorPanel.tsx` | Left sidebar task management panel (collapsible) |
| `src/ui/AgentDetailPanel.tsx` | Agent detail/settings panel (profile, config, skills, tasks) |
| `src/ui/DockPanel.tsx` | Bottom dock with collapsible panels (agent list, new task, timelines) |
| `src/ui/FloatingWindowsHost.tsx` | Non-modal floating windows for agent chat/detail |
| `src/ui/theme.ts` | Visual tokens, colors, glass CSS, profession colors, task status labels |
| `src/ui/` remaining | `TopBar`, `RightPanel`, `AddAgentPanel`, `ClarifyModal`, `AgentAvatar`, etc. |
| `src/types/game.ts` | TypeScript types mirroring backend dataclasses (`Agent`, `TaskItem`, `TaskWorldSnapshot`) |
| `src/chat/` | Chat actions (`studioChatActions.ts`), orchestration UI + SSE |

### Key Backend Structure

| Path | Role |
|------|------|
| `server.py` | App factory (Starlette), route mounting (52 routes), orchestration SSE workers, CSRF/security |
| `api/routes.py` | Legacy HTTP route handlers for Hermes WebUI (GET/POST), chat, model listing, file uploads |
| `api/task/service.py` | Core task orchestration: task assignment, task chain DAG (`depends_on`, `locked`, `batch_create`, `_recompute_locked_tasks`), orchestration result processing, event logging |
| `api/task/models.py` | Dataclasses: `Agent`, `Task` (with `depends_on`, `parent_task_id`), `TaskWorld` |
| `api/task/persistence.py` | SQLite save/load: `save_world_to_db()`, `load_world_from_db()`, `world_from_dict()` |
| `api/task/orchestration.py` | LLM inference engine: `orchestrated_peer_turns_sync()` (with receipt injection), `multi_round_orchestrated_collaboration()`, `lord_orchestrated_turn()`, `run_recursive_peer_invokes()` |
| `api/task/events.py` | Parses `[[GAME_EVENT:...]]` tags from LLM responses: `task_chain_create`, `artifact_create`, `task_progress`, `task_workflow_plan` |
| `api/task/gateway_hub.py` | Pub/sub broadcast hub — sync threads enqueue events, async pump sends to WS clients |
| `api/task/context.py` | LLM context generation: `compose_project_creation_message()`, `compose_task_chain_context()`, `compose_team_status_context()` |
| `api/task/monitor_store.py` | Task monitor/tracker persistence (DDL + recorder) with GAME_EVENT tag scanning |
| `api/task/routes_chat.py` | Chat route handlers: lord, social, agent-relay, orchestrated-run, stream, multi-round |
| `api/task/routes_task.py` | Task route handlers: create, assign, update, delete, batch-create, claim, dependencies |
| `api/task/routes_agent.py` | Agent route handlers: create, update, delete, profile-files, sync-hermes |
| `api/task/routes_model_config.py` | Model config route handlers |
| `api/task/routes_monitor.py` | Monitor route handlers: work-orders, artifacts |
| `api/multi_agent_gateway.py` | Per-agent subprocess management (each agent = a Hermes profile process), session-to-agent routing |
| `api/streaming.py` | SSE streaming engine, agent thread runner, cancel support, AIAgent import via lazy retry |

### Task World Model

- **Agent** — `name`, `profession`, `profile`, `gender`, `personality`, `catchphrase`, `reasoning_model`, `current_task_id`, `hermes_session_id`, `skills`
- **Task** — `assignee_id`, `required_profession`, `difficulty`, `progress`, `status` (pending/in_progress/completed/failed/locked), `depends_on` (task-level DAG), `parent_task_id`, `workflow_steps`
- **TaskWorld** — agents, tasks, event_log

### Agent Orchestration

When the player sends a message (via Lord entry or directly to an agent):
1. Lord chat (`POST /api/task/lord/chat`) — auto-injects task chain context, uses `lord_orchestrated_turn()`
2. If prefixed with `@agent_name | message`, it's a **handoff** — routes to that peer agent
3. `@所有人` / `@all` broadcasts to all agents except sender
4. Otherwise, the primary agent responds, optionally delegating to peers via `@agent | message` lines in its reply
5. `run_recursive_peer_invokes()` handles multi-hop delegation (max depth 8)
6. **Receipt injection**: peer replies are compiled and injected back into the invoker's Hermes session
7. **Multi-round collaboration**: `multi_round_orchestrated_collaboration()` with `max_rounds` + artifact termination

### Task Chain DAG

- Tasks support `depends_on: list[int]` — task-level prerequisites
- Blocked tasks have `status = "locked"` until all dependencies complete
- `_recompute_locked_tasks()` walks all tasks after any dependency/status change
- `task_chain_create` GAME_EVENT from LLM creates parent + child tasks from natural language
- `POST /api/task/task/batch-create` for batch task creation with intra-batch dependency resolution
- `POST /api/task/task/claim` for lightweight task claiming (only unlocked pending tasks)

## Prerequisites

Requires **hermes-agent** installed at `~/.hermes/hermes-agent/` with a working venv. Install via:
```bash
cp -r /path/to/hermes-agent ~/.hermes/hermes-agent
cd ~/.hermes/hermes-agent && bash setup-hermes.sh
```

Set `HERMES_BUNGALOW_SKIP_HERMES_BOOTSTRAP=1` to bypass the hermes-agent check.

## Test Patterns

Tests live in `tests/` (repo root) and use pytest. The `test_task_service.py` pattern:
- Creates `TaskService(db_path=tmp_path / "t.db")` with a temp SQLite DB
- Sets `HERMES_BUNGALOW_SKIP_HERMES_AGENT_SYNC=1` and `HERMES_BUNGALOW_SKIP_HERMES_SESSION_INIT=1` to skip LLM calls
- Tests directly call service methods and assert on return values / world state
