# Tolowa Orchestrator

An iteration on **Polly**, the multi-agent coding orchestrator bundled with Omnigent. Tolowa Orchestrator is an Omnigent agent bundle (config + prompts + lane shims). Omnigent is the daily driver; this decides where work goes and how it's verified.

Runs across **Claude Code, Codex, Cursor, Hermes, Pi**, plus **DeepInfra** models (Gemma, GLM, Kimi, DeepSeek) as extra reviewers/reasoners.

## What changed vs. Polly

| Area | Polly | Tolowa Orchestrator |
|---|---|---|
| Own model | Unpinned (fell to subscription default) | Pinned `claude-sonnet-5` via `executor.model` |
| Model policy | none | `agent/model-policy.yaml`: tiers `execute` / `cheap` / `deep_think` / operator-approved `architect` |
| Pinning | n/a | Every dispatch pins `args.model`; unavailable model = fail closed, no silent substitution |
| Execution evidence | none | Executed model read from platform records (Cursor stream-json init event, lane event, Hermes `session_model_usage`), never from a model's self-report |
| Review | none | Every meaningful change reviewed by a *different model vendor*; mismatch/unknown = independence unverified |
| Lanes | claude_code, codex, cursor | + `cursor_cli` (headless, worktree-isolated), `hermes` (DeepInfra), `pi` |
| Spawning | `spawn: true`, 6 dispatches/turn cap | Spawn unlocked, no fixed cap; independent work never serialized |
| Follow-through | reactive | Timers + scheduled tasks watch CI/PRs/agents; auto-merge only if 6 explicit conditions hold |
| Guardrails | dispatch cap | Six explicit human gates (spend, prod deploy, credentials/IAM, DNS, destructive ops, self-config) |

## Layout

- `agent/config.yaml` - orchestrator prompt + config
- `agent/model-policy.yaml` - tiers and per-lane model pins
- `agent/agents/*/config.yaml` - worker lanes
- `lanes/omnigent-cursor-lane` - headless Cursor CLI lane (`cursor-agent -p --trust --output-format stream-json`) in an isolated git worktree; captures the executed model from the init event; refuses merge / protected push / force-push
- `lanes/omnigent-hermes-lane` - shim to a Hermes profile on a remote builder
- `tests/cursor-lane.test.mjs` - tests for the Cursor lane (`node --test tests/cursor-lane.test.mjs`)

## Why a Cursor CLI lane

The native Omnigent `cursor` lane is interactive and its approve buttons can disappear mid-run. The CLI lane is non-interactive, so there is nothing to approve.

## Omnigent issues we hit

First seen on 0.14; source re-checked against **0.15.0** on 2026-09-25.

1. Sub-agents stay on the parent's runner; a session can't place children on another machine. *(0.14; not re-checked on 0.15.0)*
2. `hermes-native`: per-session `HERMES_HOME` never gets `state.db`, and the forwarder's plain-connect fallback (`harnesses/hermes_native/forwarder.py:396-400`) silently creates an empty DB, so every query fails "no such table: sessions" (messages in, none out). *Fallback still present in 0.15.0.*
3. `hermes-native` isn't in `_PROVIDER_RESOLUTION_HARNESS` (`models/model_catalog.py:128`), so it warns there is no model-provider resolution; the warning is advisory and `harness_plugins.py` already declares `OWN_AUTH`. *Dict still present in 0.15.0; advisory behavior not re-tested.*
4. The catalog also has no entry for the `hermes` harness, so `sys_list_models` returns `source: none` for the `cursor_cli` and `hermes` lanes even when they are ready. Omnigent's own gate passes the model through unchanged; our §4 now treats this as a preflight gap and proves the pin by execution evidence instead of stopping. *(Observed on 0.15.0.)*
5. With subscription-only providers, `sys_list_models` returns empty and `args.model` is ignored. *(0.14 config-specific; not re-checked)*
6. `codex-native` writes its own per-session `config.toml`, overriding the configured Codex model. *(observed 0.14; not re-checked)*
7. `pi_native_executor.py` ignores the system prompt/tools and returns `TurnComplete(response=None)` (line 102); we use the headless `pi` harness. *Still present in 0.15.0.*

## Caveats

Shared as-is from a working personal setup: host names, secret *names* (never values), and paths are ours. Adapt before use. Not an official Omnigent project.
