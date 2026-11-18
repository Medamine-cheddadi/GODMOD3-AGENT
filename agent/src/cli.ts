#!/usr/bin/env node

import fs from 'fs'
import path from 'path'
import os from 'os'
import { Command } from 'commander'
import readline from 'readline'
import chalk from 'chalk'
import ora from 'ora'
import { search } from '@inquirer/prompts'
import { GodModeAgent } from './agent/agent'
import { GodModeClient } from './client/godmode-client'
import { AGENT_SYSTEM_PROMPT, resolveFileMentions } from './agent/prompt'
import { config, MODEL_PROFILES, ModelProfileName } from './config'
import { listSessions, loadSession } from './agent/session-manager'
import { getActiveTodos } from './tools/todos'
import { getActiveMemory } from './tools/memory'
import { gitDiffHandler, undoChangesHandler } from './tools/git'
import { spawnSubagentHandler, SUBAGENT_PROMPTS } from './tools/subagent'
import { ultraplinianRaceHandler } from './tools/ultraplinian'
import { manageSkillsHandler } from './tools/skills'

const banner = `
${chalk.bold.magenta(' ▄████  ██████  ██████  ███▄ ▄███  ██████  ██████  ██████ ')}
${chalk.bold.magenta('██      ██  ██  ██   ██ ██ ███ ██  ██  ██  ██   ██      ██ ')}
${chalk.bold.cyan('██ ▄███ ██  ██  ██   ██ ██  █  ██  ██  ██  ██   ██  █████ ')}
${chalk.bold.cyan('██  ██  ██  ██  ██   ██ ██     ██  ██  ██  ██   ██      ██ ')}
${chalk.bold.green(' ██████  ████   ██████  ██     ██   ████   ██████  ██████ ')}
${chalk.gray('─────────────────────────────────────────────────────────────')}
${chalk.bold.white(' ░▒▓█  G0DM0D3 AUTONOMOUS AGENT v1.3.0 // LIBERATED TERMINAL ENGINE  █▓▒░')}
${chalk.gray('─────────────────────────────────────────────────────────────')}
`

const CLI_HISTORY_FILE = path.join(os.homedir(), '.godmod3', 'history')
const MAX_HISTORY_LINES = 1000

function loadCliHistory(): string[] {
  try {
    if (fs.existsSync(CLI_HISTORY_FILE)) {
      const lines = fs
        .readFileSync(CLI_HISTORY_FILE, 'utf-8')
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
      // Node readline stores history in reverse chronological order (most recent at index 0)
      return lines.reverse().slice(0, MAX_HISTORY_LINES)
    }
  } catch {
    // ignore
  }
  return []
}

function appendCliHistory(line: string) {
  const trimmed = line.trim()
  if (!trimmed) return
  try {
    const dir = path.dirname(CLI_HISTORY_FILE)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
    fs.appendFileSync(CLI_HISTORY_FILE, `${trimmed}\n`, 'utf-8')
  } catch {
    // ignore
  }
}

const program = new Command()

program
  .name('godmod3-agent')
  .description('Autonomous ReAct agent powered by G0DM0D3 API')
  .version('1.3.0')
  .argument('[task...]', 'Task or objective for the agent to execute')
  .option('-p, --profile <profile>', 'Model cost profile (glm, deepseek, qwen, cheap, smart, local)', 'glm')
  .option('-m, --model <model>', 'Direct model ID override')
  .option('-d, --direct', 'Direct response mode without workspace tools (fastest for questions & payloads)')
  .option('-r, --race [tier]', 'Run ULTRAPLINIAN multi-model race directly (fast, standard, smart, ultra)')
  .option('-R, --resume [sessionId]', 'Resume the latest session or a specific session ID')
  .option('--sessions', 'List all saved agent sessions')
  .option('-s, --subagent <role>', 'Execute task directly using a specialist subagent (researcher, coder, pentester, planner, general)')
  .option('-a, --ask', 'Require human approval before running commands or modifying files')
  .option('-u, --url <url>', 'G0DM0D3 API base URL', config.godmodeApiUrl)
  .option('-k, --key <openrouterKey>', 'OpenRouter API key override')
  .option('-w, --workdir <path>', 'Working directory for the agent execution')
  .option('-v, --verbose', 'Expand full thinking reasoning and tool execution outputs in terminal')
  .option('-t, --max-turns <turns>', 'Maximum turns before pausing (default: unlimited, pass a number to cap)', '0')
  .option('--unlimited', 'Run without any turn ceiling (runs until task is completely finished)')
  .option('--no-auto-backend', 'Do not auto-launch backend API if offline')
  .option('--launch', 'Launch G0DM0D3 backend API if offline')
  .option('--list-profiles', 'List all available cost/context profiles')
  .option('--check', 'Check connection to G0DM0D3 API backend')
  .action(async (taskArgs: string[], options) => {
    console.log(banner)

    if (options.listProfiles) {
      console.log(chalk.bold.cyan('Available Model & Cost Profiles:\n'))
      for (const [key, val] of Object.entries(MODEL_PROFILES)) {
        console.log(`  ${chalk.bold.green(key.padEnd(10))} ${chalk.yellow(val.model.padEnd(35))} ${chalk.dim(`(Ctx: ${val.contextWindow})`)}`)
        console.log(`             ${chalk.gray(val.description)}\n`)
      }
      process.exit(0)
    }

    if (options.sessions) {
      const sessions = listSessions()
      if (sessions.length === 0) {
        console.log(chalk.yellow('No saved agent sessions found in .godmod3/sessions.'))
      } else {
        console.log(chalk.bold.cyan(`Saved Agent Sessions (${sessions.length}):\n`))
        for (const s of sessions) {
          const dateStr = new Date(s.updatedAt).toLocaleString()
          const statusColor = s.status === 'completed' ? chalk.green : s.status === 'active' ? chalk.blue : chalk.yellow
          console.log(`  ${chalk.bold.white(s.id)}  ${statusColor(`[${s.status.toUpperCase()}]`)}  ${chalk.gray(dateStr)}`)
          console.log(`    ${chalk.dim('Goal:')} ${chalk.yellow(s.goal.slice(0, 80))}${s.goal.length > 80 ? '...' : ''}`)
          console.log(`    ${chalk.dim('Model:')} ${s.model} | ${chalk.dim('Turns:')} ${s.turnsTaken} | ${chalk.dim('Todos:')} ${s.todoCount}\n`)
        }
        console.log(chalk.gray(`Resume a session using: godmod3-agent --resume <sessionId>\n`))
      }
      process.exit(0)
    }

    if (options.workdir) {
      try {
        process.chdir(options.workdir)
      } catch (err: any) {
        console.error(chalk.red(`Failed to change directory to ${options.workdir}: ${err.message}`))
        process.exit(1)
      }
    }

    const client = new GodModeClient({ baseUrl: options.url, openrouterApiKey: options.key })

    if (options.check) {
      console.log(chalk.yellow(`Checking backend at ${options.url}...`))
      let health = await client.checkHealth()
      if (!health.ok && options.launch) {
        const launchResult = await client.ensureBackend()
        if (launchResult.online) {
          health = await client.checkHealth()
        }
      }
      if (health.ok) {
        console.log(chalk.green(`✓ G0DM0D3 backend is online!`))
        console.log(chalk.gray(JSON.stringify(health.status, null, 2)))
      } else {
        console.log(chalk.red(`✗ Cannot reach G0DM0D3 backend: ${health.error}`))
        console.log(chalk.yellow(`Hint: Run with --launch to start it automatically, or run manually:`))
        console.log(chalk.cyan(`      (cd /Users/elamine/dev/G0DM0D3 && npm run api)`))
      }
      process.exit(health.ok ? 0 : 1)
    }

    // Auto-launch backend if not already running
    if (options.autoBackend !== false) {
      const backendStatus = await client.ensureBackend()
      if (!backendStatus.online) {
        console.log(chalk.red(`\n[Fatal] Cannot connect to or launch G0DM0D3 backend API at ${options.url}`))
        if (backendStatus.error) {
          console.log(chalk.yellow(`Reason: ${backendStatus.error}`))
        }
        process.exit(1)
      }
    }

    // Resolve model based on profile or direct override
    let resolvedModel = options.model
    if (!resolvedModel) {
      const profile = MODEL_PROFILES[options.profile as ModelProfileName]
      if (profile) {
        resolvedModel = profile.model
      } else {
        console.log(chalk.yellow(`Warning: Unknown profile "${options.profile}". Falling back to "glm".`))
        resolvedModel = MODEL_PROFILES.glm.model
      }
    }

    // Handle resume session if requested
    let resumedSession = null
    if (options.resume !== undefined) {
      const targetId = typeof options.resume === 'string' ? options.resume : undefined
      resumedSession = loadSession(targetId)
      if (!resumedSession) {
        console.log(chalk.red(`\nError: Could not find session "${targetId || 'latest'}" to resume.`))
        console.log(chalk.yellow(`Run with --sessions to view available sessions.\n`))
        process.exit(1)
      }
      resolvedModel = resumedSession.model || resolvedModel
      console.log(chalk.bold.green(`\n📂 Resumed Session: `) + chalk.white(resumedSession.id))
      console.log(chalk.gray(`Goal: "${resumedSession.goal}"`))
      console.log(chalk.gray(`Turns Completed: ${resumedSession.turnsTaken} | Status: ${resumedSession.status}\n`))
    }

    let initialTask = taskArgs.join(' ').trim()
    if (!initialTask && resumedSession) {
      initialTask = resumedSession.goal
    }

    const agent = new GodModeAgent({
      client,
      model: resolvedModel,
      session: resumedSession || undefined,
    })

    let isVerbose = Boolean(options.verbose)

    const formatThinkingBox = (thought: string, verbose = false): string => {
      const words = thought.trim().split(/\s+/).filter(Boolean).length
      const lines = thought.trim().split('\n').filter(l => l.trim().length > 0)
      const border = '──────────────────────────────────────────────────────────'

      if (!verbose && lines.length > 2) {
        const preview = lines[0].slice(0, 75)
        return [
          chalk.magenta(`\n╭─ 🧠 Thinking `) + chalk.magenta.bold(`[Collapsed: ${words} words] `) + chalk.magenta(border.slice(28)) + chalk.magenta('╮'),
          chalk.gray(`│ `) + chalk.italic.white(preview + (preview.length < lines[0].length ? '...' : '')),
          chalk.gray(`│ `) + chalk.dim(`... [${lines.length - 1} lines collapsed • toggle with /verbose]`),
          chalk.magenta(`╰${border}╯`),
        ].join('\n')
      }

      return [
        chalk.magenta(`\n╭─ 🧠 Thinking `) + chalk.magenta.bold(`[${words} words] `) + chalk.magenta(border.slice(16)) + chalk.magenta('╮'),
        ...lines.map(l => chalk.gray(`│ `) + chalk.italic.white(l)),
        chalk.magenta(`╰${border}╯`),
      ].join('\n')
    }

    const formatToolCallBox = (name: string, args: any): string => {
      const border = '──────────────────────────────────────────────────────────'
      const argStr = JSON.stringify(args)
      const argPreview = argStr.length > 80 ? argStr.slice(0, 77) + '...' : argStr
      return [
        chalk.cyan(`\n╭─ 🛠️ Tool: `) + chalk.bold.cyan(name.padEnd(20)) + chalk.cyan(border.slice(30)) + chalk.cyan('╮'),
        chalk.gray(`│ `) + chalk.yellow(`▶ Args: `) + chalk.dim(argPreview),
      ].join('\n')
    }

    const formatToolResultBox = (name: string, result: string, verbose = false): string => {
      const border = '──────────────────────────────────────────────────────────'
      const lines = result.trim().split('\n')
      const lineCount = lines.length

      if (!verbose && lineCount > 4) {
        const shown = lines.slice(0, 4)
        return [
          chalk.gray(`│ `) + chalk.green(`✔ Output: `) + chalk.dim(`[Collapsed - ${lineCount} lines total]`),
          ...shown.map(l => chalk.gray(`│   `) + chalk.dim(l.length > 90 ? l.slice(0, 87) + '...' : l)),
          chalk.gray(`│   `) + chalk.dim(`... [${lineCount - 4} more lines collapsed • toggle with /verbose]`),
          chalk.cyan(`╰${border}╯\n`),
        ].join('\n')
      }

      return [
        chalk.gray(`│ `) + chalk.green(`✔ Output: `) + chalk.dim(`[${lineCount} lines]`),
        ...lines.slice(0, 30).map(l => chalk.gray(`│   `) + chalk.dim(l.length > 90 ? l.slice(0, 87) + '...' : l)),
        ...(lineCount > 30 ? [chalk.gray(`│   `) + chalk.dim(`... [${lineCount - 30} more lines truncated • toggle with /verbose]`)] : []),
        chalk.cyan(`╰${border}╯\n`),
      ].join('\n')
    }

    const formatTerminalMarkdown = (content: string): string => {
      let formatted = content.replace(/```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g, (_, lang, code) => {
        const border = '──────────────────────────────────────────────────────────'
        const langTag = lang ? `[${lang}] ` : ''
        const lines = code.trimEnd().split('\n')
        return [
          chalk.dim(`\n┌─ `) + chalk.cyan.bold(langTag) + chalk.dim(border.slice(langTag.length + 3)) + chalk.dim(`┐`),
          ...lines.map(l => chalk.dim(`│ `) + chalk.white(l)),
          chalk.dim(`└${border}┘\n`),
        ].join('\n')
      })

      formatted = formatted.replace(/^(#{1,3})\s+(.*)$/gm, (_, hashes, title) => {
        return chalk.bold.cyan(`\n${hashes} ${title}`)
      })

      formatted = formatted.replace(/\*\*(.*?)\*\*/g, (_, text) => chalk.bold(text))
      formatted = formatted.replace(/`([^`\n]+)`/g, (_, code) => chalk.yellow(`\`${code}\``))
      return formatted
    }

    const runAgentWithUi = async (rawPrompt: string, isResuming = false) => {
      const userPrompt = resolveFileMentions(rawPrompt)
      // ── Option 1: ULTRAPLINIAN Race Mode ──────────────────────────────
      if (options.race) {
        const tier = typeof options.race === 'string' ? options.race : 'fast'
        console.log(chalk.bold.magenta(`\n🏁 Running ULTRAPLINIAN Multi-Model Race (${tier} tier)...`))
        console.log(chalk.gray(`Prompt: "${userPrompt}"\n`))

        try {
          const raceResult = await client.raceUltraplinian({
            prompt: userPrompt,
            tier: tier as any,
          })
          console.log(chalk.bold.green(`\n🏆 [ULTRAPLINIAN WINNER: ${raceResult.winner.model}] (Score: ${raceResult.winner.score}/100)`))
          console.log(chalk.bold.green(`─────────────────────────────────────────────────────────`))
          console.log(raceResult.winner.content)
          console.log(chalk.bold.green(`─────────────────────────────────────────────────────────`))
          console.log(chalk.cyan(`Total Models Raced: ${raceResult.allResults.length}\n`))
        } catch (err: any) {
          console.error(chalk.bold.red(`\nULTRAPLINIAN Race Error: `) + err.message)
        }
        return
      }

      // ── Option 1b: Specialist Subagent Execution ─────────────────────
      if (options.subagent) {
        const role = options.subagent as any
        console.log(chalk.bold.magenta(`\n🤖 Spawning Specialist Subagent [${String(role).toUpperCase()}]`))
        console.log(chalk.white(`Goal: "${userPrompt}"\n`))

        try {
          const subagentOutput = await spawnSubagentHandler({
            task: userPrompt,
            role,
            model_profile: options.profile,
            max_turns: parseInt(options.maxTurns, 10) || 15,
          })
          console.log(chalk.bold.green(`\n══════════════════ [SUBAGENT RESPONSE] ══════════════════`))
          console.log(subagentOutput)
          console.log(chalk.bold.green(`═════════════════════════════════════════════════════════\n`))
        } catch (err: any) {
          console.error(chalk.bold.red(`\nSubagent Execution Error: `) + err.message)
        }
        return
      }

      // ── Option 2: Direct Single-Model Mode (No Tools) ────────────────
      if (options.direct) {
        console.log(chalk.bold.cyan(`\n⚡ Direct Query: `) + chalk.white(userPrompt))
        console.log(chalk.gray(`Backend: ${options.url} | Model: ${chalk.bold.yellow(resolvedModel)}\n`))

        try {
          const completion = await client.chatCompletion({
            model: resolvedModel,
            messages: [
              { role: 'system', content: AGENT_SYSTEM_PROMPT },
              { role: 'user', content: userPrompt },
            ],
            temperature: 0.3,
            godmode: true,
            autotune: true,
            stm_modules: ['hedge_reducer', 'direct_mode'],
          })

          console.log(chalk.bold.green(`\n══════════════════ [G0DM0D3 RESPONSE] ══════════════════`))
          console.log(completion.choices[0]?.message?.content || '(No content returned)')
          console.log(chalk.bold.green(`═════════════════════════════════════════════════════════\n`))
        } catch (err: any) {
          console.error(chalk.bold.red(`\nDirect Query Error: `) + err.message)
        }
        return
      }

      // ── Option 3: Full ReAct Tool-Calling Agent Loop ─────────────────
      console.log(chalk.bold.cyan(`\n⚡ Goal: `) + chalk.white(userPrompt))
      console.log(chalk.gray(`Session: ${agent.getSessionId()} | Model: ${chalk.bold.yellow(resolvedModel)} (Profile: ${options.profile})\n`))

      let activeSpinner: any = null
      const stopSpinner = () => {
        if (activeSpinner) {
          activeSpinner.stop()
          activeSpinner = null
        }
      }

      try {
        const result = await agent.runTask({
          task: userPrompt,
          model: resolvedModel,
          maxTurns: parseInt(options.maxTurns, 10),
          unlimited: Boolean(options.unlimited) || parseInt(options.maxTurns, 10) === 0,
          resumeSession: isResuming ? resumedSession || undefined : undefined,
          requireApproval: Boolean(options.ask),
          onStep: (turn: number, action: string, detail?: string, costSummary?: string) => {
            stopSpinner()
            const costTag = costSummary ? chalk.dim(` [${costSummary}]`) : ''
            activeSpinner = ora({
              text: chalk.bold.blue(`[Step ${turn}] `) + chalk.yellow(action) + (detail ? chalk.gray(` - ${detail}`) : '') + costTag,
              color: 'cyan',
            }).start()
          },
          onThinking: (thought: string) => {
            stopSpinner()
            console.log(formatThinkingBox(thought, isVerbose))
          },
          onToolCall: (name: string, args: any) => {
            stopSpinner()
            console.log(formatToolCallBox(name, args))
            activeSpinner = ora({
              text: chalk.cyan(`Executing ${name}...`),
              color: 'cyan',
            }).start()
          },
          onToolResult: (name: string, result: string) => {
            stopSpinner()
            console.log(formatToolResultBox(name, result, isVerbose))
          },
          onTodoUpdate: (todos) => {
            const completed = todos.filter(t => t.status === 'completed').length
            console.log(chalk.cyan(`  📋 Plan Progress: ${completed}/${todos.length} subtasks completed`))
          },
          onApprovalRequest: async (toolName: string, args: any): Promise<boolean> => {
            return new Promise((resolve) => {
              const rlAsk = readline.createInterface({ input: process.stdin, output: process.stdout })
              rlAsk.question(chalk.bold.yellow(`\n⚠️  [Approval Required] Allow "${toolName}" (${JSON.stringify(args)})? [Y/n]: `), (ans) => {
                rlAsk.close()
                const lower = ans.trim().toLowerCase()
                resolve(lower === '' || lower === 'y' || lower === 'yes')
              })
            })
          },
          onRefusal: (count: number, max: number, refusalText: string) => {
            console.log(chalk.bold.red(`\n🚫 [Model Refusal ${count}/${max}] `) + chalk.yellow(`Canned refusal detected.`))
            console.log(chalk.gray(`   "${refusalText.slice(0, 100)}..."`))
          },
          onModelChange: (oldModel: string, newModel: string, reason: string) => {
            console.log(chalk.bold.magenta(`\n🔄 [Agent Failover] `) + chalk.cyan(`${oldModel} ➔ ${chalk.bold.yellow(newModel)}`))
            console.log(chalk.gray(`   ${reason}\n`))
          },
          onTurnLimitReached: async (currentTurn: number): Promise<boolean | number> => {
            return new Promise((resolve) => {
              const rlTurn = readline.createInterface({ input: process.stdin, output: process.stdout })
              rlTurn.question(
                chalk.bold.yellow(`\n⚠️  [Turn Limit Reached] Agent completed ${currentTurn} turns without finishing. Grant 30 more turns to continue? [Y/n]: `),
                (ans) => {
                  rlTurn.close()
                  const lower = ans.trim().toLowerCase()
                  resolve(lower === '' || lower === 'y' || lower === 'yes')
                }
              )
            })
          },
        })

        stopSpinner()
        const cleanFinalAnswer = result.finalAnswer.replace(/<(thinking|thought|reasoning)>[\s\S]*?<\/\1>/gi, '').trim()
        console.log(chalk.bold.green(`\n══════════════════ [G0DM0D3 RESPONSE] ══════════════════`))
        console.log(formatTerminalMarkdown(cleanFinalAnswer || result.finalAnswer))
        console.log(chalk.bold.green(`─────────────────────────────────────────────────────────`))
        console.log(chalk.bold.cyan(`📊 Usage & Cost: `) + chalk.white(result.costSummary))
        console.log(chalk.gray(`💾 Session saved: ${result.sessionId} (Resume with: godmod3-agent --resume ${result.sessionId})`))
        console.log(chalk.bold.green(`═════════════════════════════════════════════════════════\n`))
      } catch (err: any) {
        stopSpinner()
        console.error(chalk.bold.red(`\nAgent Error: `) + err.message)
        console.log(chalk.yellow(`💾 Interrupted state saved. Resume with: godmod3-agent --resume\n`))
      }
    }

    if (initialTask) {
      await runAgentWithUi(initialTask, Boolean(resumedSession))
    } else {
      // Interactive REPL Mode
      const REPL_COMMANDS = [
        { cmd: '/stop', desc: 'Stop active task or prompt execution (or press Ctrl+C)' },
        { cmd: '/cancel', desc: 'Alias for /stop: cancel active execution' },
        { cmd: '/status', desc: 'Show live agent status, turns taken, and active subtasks' },
        { cmd: '/explain', desc: 'Explain current agent state, recent thoughts, and findings' },
        { cmd: '/steer', desc: 'Inject new guidance/commands on top of active session: /steer <instructions>' },
        { cmd: '/add', desc: 'Alias for /steer: add instructions over previous run' },
        { cmd: '/pentest', desc: 'Launch offensive security pentester subagent on target/task' },
        { cmd: '/research', desc: 'Launch deep research subagent to audit code and docs' },
        { cmd: '/code', desc: 'Launch autonomous coding subagent to implement code' },
        { cmd: '/plan', desc: 'Launch strategic planner subagent to decompose objectives' },
        { cmd: '/spawn', desc: 'Spawn subagent: /spawn <role> <task> (coder, pentester...)' },
        { cmd: '/subagents', desc: 'List all available specialist subagent roles' },
        { cmd: '/race', desc: 'Race prompt across models with ULTRAPLINIAN: /race <prompt>' },
        { cmd: '/skills', desc: 'Browse and inspect 40+ pentest skills runbooks' },
        { cmd: '/diff', desc: 'View git diff of modified files in active session' },
        { cmd: '/undo', desc: 'Rollback file changes made in the last turn' },
        { cmd: '/checkpoints', desc: 'List turn snapshots in the active session' },
        { cmd: '/model', desc: 'Switch model profile (glm, deepseek, qwen, smart, cheap)' },
        { cmd: '/models', desc: 'List all available model profiles & active model' },
        { cmd: '/todos', desc: 'View current task plan / checklist' },
        { cmd: '/memory', desc: 'View saved persistent session memory' },
        { cmd: '/sessions', desc: 'List saved session checkpoints' },
        { cmd: '/resume', desc: 'Resume previous session: /resume [sessionId]' },
        { cmd: '/verbose', desc: 'Toggle collapsible vs expanded thinking and tool monitoring' },
        { cmd: '/version', desc: 'Display agent engine version and runtime info' },
        { cmd: '/clear', desc: 'Reset agent memory and start fresh session' },
        { cmd: '/help', desc: 'Display this commands help menu' },
        { cmd: 'exit', desc: 'Exit the interactive agent' },
      ]

      console.log(chalk.bold.cyan(`\n🤖 Interactive Agent REPL`))
      console.log(chalk.gray(`Type tasks directly for autonomous execution, or use slash commands below:`))
      console.log(chalk.dim(`(Persistent shell history active: use ↑ / ↓ arrows to cycle past commands across sessions)\n`))
      console.log(chalk.bold.magenta(`Commands Menu:`) + chalk.gray(` (Press Tab on "/" for live autocomplete)\n`))
      for (const c of REPL_COMMANDS.slice(0, 10)) {
        console.log(`  ${chalk.bold.green(c.cmd.padEnd(12))} ${chalk.white(c.desc)}`)
      }
      console.log(chalk.dim(`  ... type /help to view all ${REPL_COMMANDS.length} commands.\n`))

      const persistedHistory = loadCliHistory()
      let multilineBuffer: string[] = []

      const startRepl = (initialLine?: string) => {
        const rl = readline.createInterface({
          input: process.stdin,
          output: process.stdout,
          prompt: chalk.bold.cyan('⚡ g0dm0d3 ❯ '),
          historySize: MAX_HISTORY_LINES,
          completer: (line: string) => {
            const trimmed = line.trim()
            const hits = REPL_COMMANDS.filter(c => c.cmd.startsWith(trimmed))
            if (trimmed === '/' || hits.length > 0) {
              console.log(chalk.bold.cyan('\n\n── 🤖 Slash Commands Menu (Press Enter to execute) ─────────────────'))
              hits.forEach(h => {
                console.log(`  ${chalk.bold.green(h.cmd.padEnd(14))} ${chalk.white(h.desc)}`)
              })
              console.log(chalk.bold.cyan('───────────────────────────────────────────────────────────────────\n'))
            }
            return [hits.map(h => h.cmd), line]
          },
        })

        if (persistedHistory.length > 0) {
          ;(rl as any).history = persistedHistory
        }

        rl.prompt()

        if (initialLine) {
          setImmediate(() => {
            console.log(initialLine)
            rl.emit('line', initialLine)
          })
        }

      rl.on('SIGINT', () => {
        if (multilineBuffer.length > 0) {
          multilineBuffer = []
          rl.setPrompt(chalk.bold.cyan('⚡ g0dm0d3 ❯ '))
          console.log(chalk.gray('\n(Canceled multiline input)'))
          rl.prompt()
          return
        }
        if (agent.isTaskRunning()) {
          console.log(chalk.bold.red('\n\n🛑 [TASK STOPPED] Active task stopped by user (Ctrl+C). Session saved.'))
          agent.stop('SIGINT from user')
          setTimeout(() => rl.prompt(), 100)
        } else {
          console.log(chalk.gray('\n(Exiting G0DM0D3 agent)'))
          process.exit(0)
        }
      })

      rl.on('line', async (line) => {
        if (line.endsWith('\\')) {
          multilineBuffer.push(line.slice(0, -1))
          rl.setPrompt(chalk.dim('... '))
          rl.prompt()
          return
        }

        if (multilineBuffer.length > 0) {
          multilineBuffer.push(line)
          line = multilineBuffer.join('\n')
          multilineBuffer = []
          rl.setPrompt(chalk.bold.cyan('⚡ g0dm0d3 ❯ '))
        }

        const trimmed = line.trim()
        if (trimmed) {
          appendCliHistory(trimmed)
        }
        if (trimmed === 'exit' || trimmed === 'quit') {
          rl.close()
          process.exit(0)
        }

        // Direct Stop / Cancel command
        if (trimmed === '/stop' || trimmed === '/cancel' || trimmed === '/abort') {
          if (agent.isTaskRunning()) {
            console.log(chalk.bold.red('\n🛑 [STOPPING] Aborting active agent task...'))
            agent.stop('User command /stop')
          } else {
            console.log(chalk.yellow('\nℹ️ No active task or prompt is currently running.\n(During execution, press Ctrl+C or type /stop to cancel immediately.)\n'))
          }
          rl.prompt()
          return
        }

        if (trimmed === '/help' || trimmed === 'help') {
          console.log(chalk.bold.cyan('\nAvailable REPL Commands:'))
          for (const c of REPL_COMMANDS) {
            console.log(`  ${chalk.bold.green(c.cmd.padEnd(14))} ${chalk.white(c.desc)}`)
          }
          console.log('')
          rl.prompt()
          return
        }

        // Verbose monitoring mode toggle
        if (trimmed === '/verbose') {
          isVerbose = !isVerbose
          console.log(chalk.bold.cyan(`\n🔍 Monitoring Mode: ${isVerbose ? chalk.bold.green('VERBOSE (expanded thinking & full tool outputs)') : chalk.bold.yellow('COLLAPSED (compact accordion summaries)')}\n`))
          rl.prompt()
          return
        }

        // Live Status & State Explanation
        if (trimmed === '/status' || trimmed === '/explain') {
          console.log(chalk.bold.cyan(`\n${agent.explainState()}\n`))
          rl.prompt()
          return
        }

        // Mid-run Steering / Add command on top of active session
        if (trimmed.startsWith('/steer ') || trimmed.startsWith('/add ') || trimmed === '/steer' || trimmed === '/add') {
          const guidance = trimmed.replace(/^\/(steer|add)\s*/, '').trim()
          if (!guidance) {
            console.log(chalk.yellow('Usage: /steer <instruction or command to add over the previous one>\nExample: /steer also check if port 8080 is accessible\n'))
            rl.prompt()
            return
          }
          if (agent.isTaskRunning()) {
            agent.injectSteeringMessage(guidance)
            console.log(chalk.bold.magenta(`\n⚡ [STEERING INJECTED MID-CHAT] Guidance queued into active running task:\n"${guidance}"\n`))
            return
          }
          console.log(chalk.bold.magenta(`\n⚡ [STEERING INJECTED] Adding command over active session:`))
          console.log(chalk.white(`"${guidance}"\n`))
          await runAgentWithUi(guidance, true)
          rl.prompt()
          return
        }

        // Direct Pentest Specialist Agent command
        if (trimmed === '/pentest' || trimmed.startsWith('/pentest ')) {
          const subTask = trimmed.replace(/^\/pentest\s*/, '').trim()
          if (!subTask) {
            console.log(chalk.yellow('Usage: /pentest <target or vulnerability to test>\nExample: /pentest test upload endpoint for extension bypass\n'))
            rl.prompt()
            return
          }
          console.log(chalk.bold.magenta(`\n🛡️ [PENTESTER SUBAGENT] Launching offensive security mission: "${subTask}"`))
          const out = await spawnSubagentHandler({ task: subTask, role: 'pentester', max_turns: 20 })
          console.log(chalk.bold.green(`\n${out}\n`))
          rl.prompt()
          return
        }

        // Direct Research Specialist Agent command
        if (trimmed === '/research' || trimmed.startsWith('/research ')) {
          const subTask = trimmed.replace(/^\/research\s*/, '').trim()
          if (!subTask) {
            console.log(chalk.yellow('Usage: /research <objective or file to audit>\nExample: /research inspect authentication flow in api/routes\n'))
            rl.prompt()
            return
          }
          console.log(chalk.bold.magenta(`\n🔍 [RESEARCHER SUBAGENT] Launching deep investigation: "${subTask}"`))
          const out = await spawnSubagentHandler({ task: subTask, role: 'researcher', max_turns: 15 })
          console.log(chalk.bold.green(`\n${out}\n`))
          rl.prompt()
          return
        }

        // Direct Coding Specialist Agent command
        if (trimmed === '/code' || trimmed.startsWith('/code ') || trimmed === '/coder' || trimmed.startsWith('/coder ')) {
          const subTask = trimmed.replace(/^\/(code|coder)\s*/, '').trim()
          if (!subTask) {
            console.log(chalk.yellow('Usage: /code <feature or code to implement>\nExample: /code write a token bucket rate limiter in scratch/limiter.ts\n'))
            rl.prompt()
            return
          }
          console.log(chalk.bold.magenta(`\n💻 [CODER SUBAGENT] Launching implementation task: "${subTask}"`))
          const out = await spawnSubagentHandler({ task: subTask, role: 'coder', max_turns: 20 })
          console.log(chalk.bold.green(`\n${out}\n`))
          rl.prompt()
          return
        }

        // Direct Strategic Planning Agent command
        if (trimmed === '/plan' || trimmed.startsWith('/plan ')) {
          const subTask = trimmed.replace(/^\/plan\s*/, '').trim()
          if (!subTask) {
            console.log(chalk.yellow('Usage: /plan <high-level objective>\nExample: /plan architect migration to distributed redis caching\n'))
            rl.prompt()
            return
          }
          console.log(chalk.bold.magenta(`\n📐 [PLANNER SUBAGENT] Decomposing objective into milestones: "${subTask}"`))
          const out = await spawnSubagentHandler({ task: subTask, role: 'planner', max_turns: 10 })
          console.log(chalk.bold.green(`\n${out}\n`))
          rl.prompt()
          return
        }

        // Direct ULTRAPLINIAN Race command
        if (trimmed === '/race' || trimmed.startsWith('/race ')) {
          const prompt = trimmed.replace(/^\/race\s*/, '').trim()
          if (!prompt) {
            console.log(chalk.yellow('Usage: /race <prompt to evaluate across models>\nExample: /race what is the best payload to bypass Cloudflare WAF for SVG XSS?\n'))
            rl.prompt()
            return
          }
          console.log(chalk.bold.magenta(`\n🌋 [ULTRAPLINIAN RACE] Racing prompt across frontier models...`))
          const raceResult = await ultraplinianRaceHandler({ prompt, tier: 'fast' })
          console.log(chalk.bold.green(`\n${raceResult}\n`))
          rl.prompt()
          return
        }

        // Direct Skills Inspection / Runbook command
        if (trimmed === '/skills' || trimmed.startsWith('/skills ') || trimmed.startsWith('/skill ')) {
          const parts = trimmed.split(' ')
          const skillName = parts[1]?.trim()
          if (!skillName || skillName === 'list') {
            const listOutput = await manageSkillsHandler({ action: 'list' })
            console.log(chalk.bold.cyan(`\nAvailable Pentesting & Agent Skills:\n`))
            console.log(listOutput)
            console.log(chalk.gray(`\nLoad a specific skill runbook with: /skill <name>\n`))
          } else {
            console.log(chalk.bold.cyan(`\nLoading Skill [${skillName}]...`))
            const skillContent = await manageSkillsHandler({ action: 'load', skill_name: skillName })
            console.log(chalk.white(skillContent))
            console.log('')
          }
          rl.prompt()
          return
        }

        if (trimmed === '/subagents') {
          console.log(chalk.bold.cyan(`\nAvailable Specialist Subagent Personas:\n`))
          for (const [role, desc] of Object.entries(SUBAGENT_PROMPTS)) {
            const firstLine = desc.split('\n')[1] || desc.split('\n')[0]
            console.log(`  ${chalk.bold.magenta(role.padEnd(14))} ${chalk.white(firstLine.replace('Your role: ', ''))}`)
          }
          console.log(chalk.gray(`\nLaunch with: /spawn <role> <task>\n`))
          rl.prompt()
          return
        }

        if (trimmed.startsWith('/spawn ') || trimmed.startsWith('/subagent ')) {
          const parts = trimmed.split(' ')
          const role = parts[1]?.toLowerCase()
          const subTask = parts.slice(2).join(' ')
          if (!role || !subTask) {
            console.log(chalk.yellow('Usage: /spawn <role> <task> (roles: researcher, coder, pentester, planner, general)\n'))
            rl.prompt()
            return
          }
          console.log(chalk.bold.magenta(`\n🤖 Launching Subagent [${role.toUpperCase()}]: "${subTask}"`))
          const out = await spawnSubagentHandler({ task: subTask, role: role as any, max_turns: 15 })
          console.log(chalk.bold.green(`\n${out}\n`))
          rl.prompt()
          return
        }

        if (trimmed === '/diff' || trimmed.startsWith('/diff ')) {
          const parts = trimmed.split(' ')
          const targetFile = parts[1] ? parts[1].trim() : undefined
          const diffOutput = await gitDiffHandler({ file_path: targetFile })
          console.log(chalk.bold.cyan(`\nGit Working Tree Diff:\n`))
          console.log(diffOutput)
          console.log('')
          rl.prompt()
          return
        }

        if (trimmed === '/undo') {
          const undoResult = await undoChangesHandler({ action: 'undo_last_turn' })
          console.log(chalk.bold.yellow(`\n${undoResult}\n`))
          rl.prompt()
          return
        }

        if (trimmed === '/checkpoints') {
          const cpResult = await undoChangesHandler({ action: 'list_checkpoints' })
          console.log(chalk.bold.cyan(`\n${cpResult}\n`))
          rl.prompt()
          return
        }

        if (trimmed === '/models') {
          console.log(chalk.bold.cyan(`\nActive Model: `) + chalk.bold.green(resolvedModel))
          console.log(chalk.bold.cyan(`\nAvailable Model Profiles:\n`))
          for (const [key, val] of Object.entries(MODEL_PROFILES)) {
            const isCurrent = val.model === resolvedModel ? chalk.green(' [ACTIVE]') : ''
            console.log(`  ${chalk.bold.yellow(key.padEnd(10))} ${chalk.white(val.model.padEnd(35))}${isCurrent}`)
            console.log(`             ${chalk.gray(val.description)}`)
          }
          console.log(chalk.gray(`\nSwitch with: /model <profile|model_id>\n`))
          rl.prompt()
          return
        }

        if (trimmed.startsWith('/model')) {
          const parts = trimmed.split(' ')
          const target = parts[1]?.trim()
          if (!target) {
            console.log(chalk.yellow(`Current model: ${resolvedModel}. Use "/model <profile>" (glm, deepseek, qwen, smart, cheap) to switch.\n`))
            rl.prompt()
            return
          }

          let newModel = target
          if (MODEL_PROFILES[target as ModelProfileName]) {
            newModel = MODEL_PROFILES[target as ModelProfileName].model
          }
          const prevModel = resolvedModel
          resolvedModel = newModel
          agent.setModel(newModel)
          console.log(chalk.bold.green(`\n✓ Switched active agent model: `) + chalk.cyan(`${prevModel} ➔ ${chalk.bold.yellow(newModel)}\n`))
          rl.prompt()
          return
        }

        if (trimmed === '/todos') {
          const todos = getActiveTodos()
          if (todos.length === 0) {
            console.log(chalk.yellow('No tasks registered in current plan yet.\n'))
          } else {
            console.log(chalk.bold.cyan(`\nCurrent Plan (${todos.length} items):`))
            for (const t of todos) {
              const icon = t.status === 'completed' ? chalk.green('✔ [DONE]') : t.status === 'in_progress' ? chalk.blue('▶ [IN PROGRESS]') : chalk.yellow('⏳ [TODO]')
              console.log(`  ${t.id}. ${icon} ${t.task}`)
            }
            console.log('')
          }
          rl.prompt()
          return
        }

        if (trimmed === '/memory') {
          const mem = getActiveMemory()
          const keys = Object.keys(mem)
          if (keys.length === 0) {
            console.log(chalk.yellow('No persistent memories stored yet.\n'))
          } else {
            console.log(chalk.bold.cyan(`\nSaved Session Memory (${keys.length} items):`))
            for (const k of keys) {
              console.log(`  • ${chalk.bold.green(k)}: ${chalk.white(mem[k])}`)
            }
            console.log('')
          }
          rl.prompt()
          return
        }

        if (trimmed === '/sessions') {
          const sessions = listSessions()
          console.log(chalk.bold.cyan(`\nSaved Agent Sessions (${sessions.length}):`))
          for (const s of sessions) {
            console.log(`  • ${chalk.white(s.id)} [${s.status}] - "${s.goal.slice(0, 50)}"`)
          }
          console.log('')
          rl.prompt()
          return
        }

        if (trimmed.startsWith('/resume')) {
          const parts = trimmed.split(' ')
          const targetId = parts[1] || undefined
          const loaded = loadSession(targetId)
          if (!loaded) {
            console.log(chalk.red(`Could not find session "${targetId || 'latest'}"\n`))
          } else {
            console.log(chalk.green(`✓ Loaded session ${loaded.id} ("${loaded.goal}"). Resuming...\n`))
            await runAgentWithUi(loaded.goal, true)
          }
          rl.prompt()
          return
        }

        if (trimmed === '/version' || trimmed === 'version') {
          console.log(chalk.bold.cyan(`\n⚡ G0DM0D3 AUTONOMOUS AGENT v1.3.0 // LIBERATED TERMINAL ENGINE`))
          console.log(chalk.gray(`Runtime: Node ${process.version} | Platform: ${process.platform}-${process.arch}`))
          console.log(chalk.gray(`Active Model: ${agent.getModel()} | Profile: ${options.profile}\n`))
          rl.prompt()
          return
        }

        if (trimmed === '/clear' || trimmed === 'clear' || trimmed === '/reset' || trimmed === 'reset') {
          agent.reset()
          console.log(chalk.green('✓ Agent memory reset to fresh state.\n'))
          rl.prompt()
          return
        }

        if (trimmed === '/' || trimmed === '/menu' || trimmed === '/commands') {
          rl.close()
          if (process.stdin.isTTY) {
            try {
              const selectedCmd = await search({
                message: chalk.bold.cyan('🤖 Choose Agent Slash Command:'),
                source: async (input) => {
                  const query = (input || '').trim().toLowerCase()
                  const filtered = REPL_COMMANDS.filter(c =>
                    !query ||
                    c.cmd.toLowerCase().includes(query) ||
                    c.desc.toLowerCase().includes(query)
                  )
                  return filtered.map(c => ({
                    name: `${chalk.bold.green(c.cmd.padEnd(14))} ${chalk.white(c.desc)}`,
                    value: c.cmd,
                    description: c.desc,
                  }))
                },
              })
              if (selectedCmd) {
                startRepl(selectedCmd)
                return
              }
            } catch {
              // canceled
            }
          } else {
            console.log(chalk.bold.cyan('\n── 🤖 Agent Slash Commands Menu ────────────────────────────────────'))
            for (const c of REPL_COMMANDS) {
              console.log(`  ${chalk.bold.green(c.cmd.padEnd(14))} ${chalk.white(c.desc)}`)
            }
            console.log(chalk.bold.cyan('───────────────────────────────────────────────────────────────────\n'))
          }
          startRepl()
          return
        }

        if (trimmed.startsWith('/')) {
          console.log(chalk.bold.red(`\n❌ Unknown slash command "${trimmed}".`))
          console.log(chalk.gray(`Slash commands are executed directly as agent operations and are never sent to the model for conversational analysis.`))
          console.log(chalk.cyan(`Available commands: ${REPL_COMMANDS.filter(c => c.cmd.startsWith('/')).map(c => c.cmd).join(', ')}`))
          console.log(chalk.gray(`Type /help for full details or type "/" and press Enter for the interactive menu.\n`))
          rl.prompt()
          return
        }

        if (trimmed) {
          await runAgentWithUi(trimmed)
        }
        rl.prompt()
      })
    }
    startRepl()
  }
})

program.parse(process.argv)
