# 🧠 G0DM0D3 — Autonomous Terminal Agent & Intelligence Pipeline

An autonomous, liberated ReAct agent CLI and multi-model intelligence pipeline. Built for recursive task execution, security auditing, and unrestricted cognitive workflows directly in your terminal.

---

## ⚡ Quick Start

### Installation & Build

```bash
# Clone the repository
git clone https://github.com/Medamine-cheddadi/GODMOD3-AGENT.git
cd GODMOD3-AGENT

# Install dependencies and build
npm install
npm run build

# Link globally so you can run from any folder
npm link --force
```

### Running the Agent

Start the interactive terminal REPL:

```bash
godmode
# or
godmod3-agent
```

Or pass a task directly:

```bash
godmode "Audit git status and review changed files"
```

---

## 🎮 CLI Features & UX

- **Full-Width Responsive UI**: Borders, banners, and response cards adapt to your terminal width.
- **Continuous Timeline Stream**: Turn steps, thoughts, and tool executions flow downward cleanly via a left-rail timeline (`│`).
- **Interactive Command Palette**: Type `/` or `/help` and press Enter to view all commands grouped by domain.
- **Native Autocomplete**: Type `/` and press `Tab` for instant completions.
- **Persistent Shell History**: Press `↑` / `↓` arrows to cycle through previous commands across sessions (stored in `~/.godmod3/history`).
- **Collapsible Monitoring**: Use `/verbose` to toggle between collapsed summaries and full reasoning / tool outputs.

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
| `/model <profile>` | Switch model profile (`glm`, `deepseek`, `qwen`, `smart`, `cheap`, `local`) |
| `/models` | List all available model profiles and context windows |
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
├── src/
│   ├── lib/          # Parseltongue, AutoTune, OpenRouter integrations
│   └── stm/          # Behavioral & linguistic transformer modules
└── skills/           # 40+ Security auditing runbooks and pentest skills
```

---

## 🔐 Privacy & Telemetry

- **Zero CLI Telemetry**: No prompts, commands, tool arguments, or file contents are ever collected or sent to external telemetry services.
- **100% Local Storage**: Shell history and session checkpoints are stored strictly on your local disk under `~/.godmod3/`.
