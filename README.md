# 🧠 G0DM0D3 — Autonomous Terminal Agent & Intelligence Pipeline

An autonomous, liberated ReAct agent CLI and multi-model intelligence pipeline. Built for recursive task execution, security auditing, and unrestricted cognitive workflows directly in your terminal.

---

## ⚡ Quick Start

### Installation & Build

```bash
# Clone the repository
git clone https://github.com/Medamine-cheddadi/GODMOD3-AGENT.git
cd GODMOD3-AGENT

# Install dependencies and compile
npm install
npm run build

# Link globally to run from any directory
npm link --force
```

### Running the Agent CLI

Launch the interactive terminal REPL:

```bash
godmode
# or
godmod3-agent
```

Or pass a task directly for single-command autonomous execution:

```bash
godmode "Audit git status, review changed files, and summarize branch health"
```

---

## 🎮 Terminal Experience & UX

- **Full-Width Responsive UI**: Headers, status bars, syntax boxes, and response cards dynamically adapt to your terminal width (`process.stdout.columns`).
- **Continuous Timeline Stream**: Step turns, model reasoning, and tool executions flow downward cleanly via a left-rail timeline (`│`) without nested box clutter.
- **Interactive Command Palette**: Type `/` or `/help` and press Enter to instantly display the categorized command palette.
- **Native Readline Autocomplete**: Type `/` and press `Tab` for instant completions without terminal screen flickering.
- **Persistent Shell History**: Press `↑` / `↓` arrows to navigate previous commands across sessions (persisted locally in `~/.godmod3/history`).
- **Collapsible Monitoring**: Use `/verbose` to toggle between compact summaries and expanded reasoning / full tool outputs.

---

## 🤖 Slash Commands

| Command | Action |
|---|---|
| `/stop`, `/cancel` | Stop active task execution immediately (or `Ctrl+C`) |
| `/steer <instructions>` | Inject new guidance on top of the active session |
| `/status`, `/explain` | Inspect live agent state, recent thoughts, and findings |
| `/verbose` | Toggle collapsed vs expanded thinking and tool output |
| `/clear`, `/reset` | Reset agent memory and start a fresh session |
| `/version` | Display agent engine version and runtime details |
| `/pentest <target>` | Launch offensive security pentesting specialist subagent |
| `/research <query>` | Launch deep research subagent to audit code and docs |
| `/code <task>` | Launch autonomous coding specialist subagent |
| `/plan <objective>` | Launch strategic planner subagent to decompose objectives |
| `/spawn <role> <task>` | Spawn a custom specialist subagent |
| `/subagents` | List all available specialist subagent roles |
| `/model <profile>` | Switch model profile (`glm`, `deepseek`, `qwen`, `smart`, `cheap`, `local`) |
| `/models` | List all available model profiles, pricing, and context windows |
| `/race <prompt>` | Race prompt across models with ULTRAPLINIAN |
| `/skills` | Browse and inspect 40+ security skill runbooks |
| `/todos` | View current plan checklist and subtask status |
| `/memory` | Inspect saved persistent session memory graph |
| `/diff` | View git diff of changes made during the session |
| `/undo` | Rollback file changes made in the last turn |
| `/checkpoints` | List turn snapshots in the active session |
| `/sessions` | List saved session checkpoints |
| `/resume [id]` | Resume a previous session |

---

## 🧠 Intelligence Pipeline Engines

G0DM0D3 includes the core post-training and red-teaming pipeline engines located in `api/` and `src/`:

1. **AutoTune**: Context-adaptive sampling parameter engine across 20 query domains (evaluates prompt intent and tunes temperature, top_p, and system prompts dynamically).
2. **Parseltongue**: Input perturbation and obfuscation engine for red-teaming with 33 techniques across 3 intensity tiers.
3. **State Transformer Modules (STM)**: Post-training output transformers (`hedge_reducer`, `direct_mode`) that eliminate canned AI refusals and disclaimers.
4. **ULTRAPLINIAN**: Multi-model racing and consensus engine that benchmarks and evaluates outputs across model tiers.

### Running the API Pipeline Standalone

The G0DM0D3 API pipeline can also be run as a standalone OpenAI-compatible server:

```bash
npm run api
# Starts the API server at http://localhost:7860/v1
```

---

## 📁 Repository Architecture

```text
GODMOD3-AGENT/
├── agent/            # Autonomous ReAct Agent engine, tools, terminal UI, and CLI
│   └── src/
│       ├── cli.ts            # Main CLI entrypoint and REPL loop
│       ├── terminal-ui.ts    # Full-width terminal rendering engine & singleton spinner
│       ├── agent/            # Agent state, context manager, checkpoints, cost tracking
│       ├── client/           # Backend API connector & process launcher
│       └── tools/            # Bash, filesystem, git, subagents, todos, skills, memory
├── api/              # Multi-model intelligence pipeline server (OpenAI-compatible)
│   ├── routes/       # Chat, completions, autotune, parseltongue, ultraplinian routes
│   └── lib/          # Consortium, tiers, and pipeline managers
├── src/
│   ├── lib/          # Parseltongue, AutoTune, OpenRouter integrations
│   └── stm/          # Behavioral & linguistic transformer modules
└── skills/           # 40+ Security auditing runbooks and pentest skills
```

---

## 🔐 Zero Telemetry & Privacy Guarantee

- **No Cloudflare Telemetry**: All Cloudflare Pages telemetry beacons, web functions, and tracking proxies have been completely removed.
- **Zero Remote Logging**: No prompts, commands, tool arguments, or file contents are ever collected, transmitted, or tracked by any external analytics service.
- **100% Local Storage**: Shell history and session checkpoints are stored strictly on your local disk under `~/.godmod3/`.
