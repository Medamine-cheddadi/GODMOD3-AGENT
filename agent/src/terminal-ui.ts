import chalk from 'chalk'
import ora, { Ora } from 'ora'

/**
 * Singleton spinner manager ensuring only one Ora spinner instance ever exists,
 * preventing "[ora] Multiple concurrent spinners detected" warnings.
 */
class SpinnerManager {
  private spinner: Ora | null = null

  private getSpinner(): Ora {
    if (!this.spinner) {
      this.spinner = ora({ color: 'cyan', discardStdin: false })
    }
    return this.spinner
  }

  start(text: string) {
    const s = this.getSpinner()
    s.text = text
    if (!s.isSpinning) {
      s.start()
    }
  }

  stop() {
    if (this.spinner && this.spinner.isSpinning) {
      this.spinner.stop()
    }
  }
}

export const terminalSpinner = new SpinnerManager()

/**
 * Returns the effective terminal width, clamped between 64 and 220.
 * Leaves 1 column buffer to prevent terminal emulator auto-wrap glitches.
 */
export function getTerminalWidth(): number {
  const cols = process.stdout.columns || 100
  return Math.max(64, Math.min(cols, 220) - 1)
}

/**
 * Strips ANSI color and control escape sequences.
 */
export function stripAnsi(str: string): string {
  return str.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '')
}

/**
 * Returns the visible column width of a string ignoring ANSI escapes.
 */
export function visibleLength(str: string): number {
  return stripAnsi(str).length
}

/**
 * Pads a string containing ANSI escape codes so its visible column width is `width`.
 */
export function padAnsi(str: string, width: number): string {
  const vlen = visibleLength(str)
  return str + ' '.repeat(Math.max(0, width - vlen))
}

/**
 * Pads or fits content to exactly `width` visible characters.
 */
export function fitLine(content: string, width: number): string {
  const vlen = visibleLength(content)
  if (vlen > width) {
    const stripped = stripAnsi(content)
    return stripped.slice(0, Math.max(0, width - 3)) + '...'
  }
  return content + ' '.repeat(Math.max(0, width - vlen))
}

/**
 * Wraps text into lines that do not exceed `maxWidth` visible characters.
 */
export function wrapText(text: string, maxWidth: number): string[] {
  const result: string[] = []
  const rawLines = text.split('\n')
  for (const rawLine of rawLines) {
    if (visibleLength(rawLine) <= maxWidth) {
      result.push(rawLine)
      continue
    }

    const words = rawLine.split(' ')
    let current = ''
    for (const w of words) {
      if (!current) {
        current = w
      } else if (visibleLength(current) + 1 + visibleLength(w) <= maxWidth) {
        current += ' ' + w
      } else {
        result.push(current)
        current = w
      }
    }

    if (current) {
      while (visibleLength(current) > maxWidth) {
        result.push(current.slice(0, maxWidth))
        current = current.slice(maxWidth)
      }
      if (current) result.push(current)
    }
  }
  return result
}

export interface BoxOptions {
  badge?: string
  borderColor?: (s: string) => string
  titleColor?: (s: string) => string
  badgeColor?: (s: string) => string
}

/**
 * Creates a full-width Unicode card spanning the exact terminal width.
 */
export function createBox(title: string, lines: string[], options?: BoxOptions): string {
  const W = getTerminalWidth()
  const innerW = W - 4
  const borderFn = options?.borderColor || chalk.cyan
  const titleFn = options?.titleColor || chalk.bold.cyan
  const badgeFn = options?.badgeColor || chalk.dim

  const titleText = title ? ` ${title} ` : ''
  const badgeText = options?.badge ? `[${options.badge}] ` : ''
  const headerUsed = visibleLength(titleText) + visibleLength(badgeText)
  const remainingBorder = Math.max(0, W - 3 - headerUsed)

  const top = borderFn('╭─') + titleFn(titleText) + badgeFn(badgeText) + borderFn('─'.repeat(remainingBorder) + '╮')

  const middle = lines.map(line => {
    return borderFn('│ ') + fitLine(line, innerW) + borderFn(' │')
  })

  const bottom = borderFn('╰' + '─'.repeat(W - 2) + '╯')

  return [top, ...middle, bottom].join('\n')
}

/**
 * Creates an inner box divider line.
 */
export function createBoxDivider(label?: string, borderColor = chalk.cyan): string {
  const W = getTerminalWidth()
  const borderFn = borderColor
  if (label) {
    const text = ` ${label} `
    const rem = Math.max(0, W - 3 - visibleLength(text))
    return borderFn('├─') + chalk.bold(text) + borderFn('─'.repeat(rem) + '┤')
  }
  return borderFn('├' + '─'.repeat(W - 2) + '┤')
}

/**
 * Renders the top brand banner spanning the full terminal width.
 */
export function renderBanner(opts: {
  version: string
  model: string
  profile: string
  workdir: string
  contextWindow: string
}): string {
  const W = getTerminalWidth()
  const innerW = W - 4

  const title = `⚡ G0DM0D3 AUTONOMOUS AGENT v${opts.version}`
  const tag = `[LIBERATED TERMINAL ENGINE]`
  const topRem = Math.max(0, W - 3 - visibleLength(title) - visibleLength(tag) - 1)

  const line1 = `${chalk.cyan('• Model:')} ${chalk.bold.yellow(opts.model)} ${chalk.dim(`(${opts.profile})`)}   ${chalk.cyan('• Context:')} ${chalk.green(opts.contextWindow)}   ${chalk.cyan('• Mode:')} ${chalk.bold.green('UNCENSORED')}`
  const line2 = `${chalk.cyan('• Workspace:')} ${chalk.white(opts.workdir)}   ${chalk.cyan('• Engine:')} ${chalk.hex('#a78bfa')('Autonomous ReAct + STM Tools')}`

  return [
    chalk.cyan('╭─') + chalk.bold.white(` ${title} `) + chalk.hex('#10b981')(`${tag} `) + chalk.cyan('─'.repeat(topRem) + '╮'),
    chalk.cyan('│ ') + fitLine(line1, innerW) + chalk.cyan(' │'),
    chalk.cyan('│ ') + fitLine(line2, innerW) + chalk.cyan(' │'),
    chalk.cyan('╰' + '─'.repeat(W - 2) + '╯'),
  ].join('\n')
}

/**
 * Renders the full-width categorized slash command palette.
 */
export function renderCommandPalette(): string {
  const row = (cmds: string, desc: string): string => {
    return padAnsi(`    ${cmds}`, 30) + chalk.white(desc)
  }

  const lines: string[] = [
    '',
    chalk.bold.cyan('  ⚡ CONTROL & EXECUTION'),
    row(`${chalk.bold.green('/stop')}, ${chalk.bold.green('/cancel')}`, 'Stop active task execution immediately (or press Ctrl+C)'),
    row(`${chalk.bold.green('/steer')}, ${chalk.bold.green('/add')}`, 'Inject guidance / steering over active agent session'),
    row(`${chalk.bold.green('/status')}, ${chalk.bold.green('/explain')}`, 'Inspect live agent thoughts, turns taken, and findings'),
    row(`${chalk.bold.green('/verbose')}`, 'Toggle collapsed vs expanded thinking and tool output'),
    row(`${chalk.bold.green('/clear')}, ${chalk.bold.green('/reset')}`, 'Reset agent memory and state to start clean session'),
    row(`${chalk.bold.green('/version')}`, 'Display agent engine version, platform, and runtime info'),
    '',
    chalk.bold.hex('#a78bfa')('  ◆ SPECIALIST SUBAGENTS'),
    row(`${chalk.bold.green('/pentest')} <target>`, 'Spawn offensive security pentesting specialist subagent'),
    row(`${chalk.bold.green('/research')} <query>`, 'Spawn deep research and code audit specialist subagent'),
    row(`${chalk.bold.green('/code')} <task>`, 'Spawn autonomous coding specialist subagent'),
    row(`${chalk.bold.green('/plan')} <objective>`, 'Spawn strategic planner subagent to decompose objectives'),
    row(`${chalk.bold.green('/spawn')} <role> <task>`, 'Spawn custom specialist role (coder, pentester, planner...)'),
    row(`${chalk.bold.green('/subagents')}`, 'List all specialist subagent capabilities and roles'),
    '',
    chalk.bold.yellow('  ✦ MODELS & INTELLIGENCE'),
    row(`${chalk.bold.green('/model')} <profile>`, 'Switch profile (glm, deepseek, qwen, smart, cheap, local)'),
    row(`${chalk.bold.green('/models')}`, 'List all model profiles, pricing, and context windows'),
    row(`${chalk.bold.green('/race')} <prompt>`, 'Race prompt across models with ULTRAPLINIAN'),
    row(`${chalk.bold.green('/skills')}`, 'Browse and inspect 40+ pentest skill runbooks'),
    '',
    chalk.bold.blue('  ◇ STATE & SESSIONS'),
    row(`${chalk.bold.green('/todos')}`, 'View current multi-step task checklist and subtasks'),
    row(`${chalk.bold.green('/memory')}`, 'Inspect saved persistent agent session memory graph'),
    row(`${chalk.bold.green('/diff')}`, 'View git diff of modified files in active session'),
    row(`${chalk.bold.green('/undo')}`, 'Rollback file changes made in the last turn'),
    row(`${chalk.bold.green('/checkpoints')}`, 'List turn snapshots in the active session'),
    row(`${chalk.bold.green('/sessions')}, ${chalk.bold.green('/resume')}`, 'List saved checkpoints or resume a past session'),
    '',
  ]

  return createBox('COMMAND PALETTE', lines, {
    badge: 'Press Tab on "/" for live autocomplete',
    borderColor: chalk.cyan,
    titleColor: chalk.bold.cyan,
    badgeColor: chalk.dim,
  })
}

/**
 * Formats a clean command/tool preview string instead of raw JSON.
 */
export function formatToolSummary(name: string, args: any): string {
  if (name === 'execute_command') {
    return chalk.yellow(`$ ${args.command || ''}`)
  }
  if (name === 'read_file') {
    return chalk.cyan(`read `) + chalk.white(args.path || '')
  }
  if (name === 'write_file') {
    return chalk.hex('#10b981')(`write `) + chalk.white(args.path || '')
  }
  if (name === 'edit_file') {
    return chalk.yellow(`edit `) + chalk.white(args.path || '')
  }
  if (name === 'list_directory') {
    return chalk.cyan(`ls `) + chalk.white(args.path || '.')
  }
  if (name === 'search_files') {
    return chalk.cyan(`search `) + chalk.yellow(`"${args.query || ''}"`) + (args.path ? chalk.dim(` in ${args.path}`) : '')
  }
  if (name === 'web_search') {
    return chalk.cyan(`web `) + chalk.yellow(`"${args.query || ''}"`)
  }
  if (name === 'fetch_web_page') {
    return chalk.cyan(`fetch `) + chalk.dim(args.url || '')
  }
  if (name === 'manage_todos') {
    return chalk.hex('#a78bfa')(`todos `) + chalk.white(args.action || 'list')
  }
  if (name === 'spawn_subagent') {
    return chalk.hex('#a78bfa')(`spawn `) + chalk.bold.white(args.role || 'subagent') + chalk.dim(`: "${args.task || ''}"`)
  }
  const str = JSON.stringify(args)
  return str.length > 90 ? str.slice(0, 87) + '...' : str
}

/**
 * Renders step timeline node connecting seamlessly with previous steps.
 */
export function renderStepHeader(turn: number, action: string, detail?: string, isFirst = false): void {
  if (!isFirst) {
    console.log(chalk.gray(`│`))
  }
  const detailStr = detail ? chalk.dim(` (${detail})`) : ''
  console.log(chalk.cyan(`◆ `) + chalk.bold.white(`Step ${turn}`) + chalk.dim(` · ${action}`) + detailStr)
}

/**
 * Streams reasoning in an indented timeline branch.
 */
export function renderThinkingStream(thought: string, verbose = false): void {
  const lines = thought.trim().split('\n').filter(Boolean)
  const words = thought.trim().split(/\s+/).filter(Boolean).length
  const badge = verbose ? chalk.dim(`(${words} words · full)`) : chalk.dim(`(${words} words · collapsed)`)

  console.log(chalk.gray(`│  `) + chalk.hex('#a78bfa')(`✦ Reasoning `) + badge)
  if (!verbose && lines.length > 2) {
    const preview = lines[0].slice(0, 110)
    console.log(chalk.gray(`│    `) + chalk.italic.dim(preview + (preview.length < lines[0].length ? '...' : '')))
    console.log(chalk.gray(`│    `) + chalk.dim(`... [${lines.length - 1} lines collapsed · toggle with /verbose]`))
  } else {
    for (const l of lines) {
      console.log(chalk.gray(`│    `) + chalk.italic.dim(l))
    }
  }
}

/**
 * Streams tool invocation in an indented timeline branch.
 */
export function renderToolCallStream(name: string, args: any): void {
  const summary = formatToolSummary(name, args)
  console.log(chalk.gray(`│  `) + chalk.hex('#f59e0b')(`⚙ Tool: `) + chalk.bold.white(name))
  console.log(chalk.gray(`│    `) + summary)
}

/**
 * Streams tool results in an indented timeline branch.
 */
export function renderToolResultStream(name: string, result: string, verbose = false): void {
  const lines = result.trim().split('\n').filter(l => l.length > 0)
  const lineCount = lines.length

  if (!verbose && lineCount > 4) {
    console.log(chalk.gray(`│    `) + chalk.hex('#10b981')(`↳ ✔ Completed `) + chalk.dim(`(${lineCount} lines · preview):`))
    for (const l of lines.slice(0, 3)) {
      console.log(chalk.gray(`│      `) + chalk.dim(l.length > 100 ? l.slice(0, 97) + '...' : l))
    }
    console.log(chalk.gray(`│      `) + chalk.dim(`... [${lineCount - 3} lines collapsed · toggle with /verbose]`))
  } else {
    const limit = verbose ? 100 : 25
    console.log(chalk.gray(`│    `) + chalk.hex('#10b981')(`↳ ✔ Completed `) + chalk.dim(`(${lineCount} lines):`))
    for (const l of lines.slice(0, limit)) {
      console.log(chalk.gray(`│      `) + chalk.dim(l.length > 110 ? l.slice(0, 107) + '...' : l))
    }
    if (lineCount > limit) {
      console.log(chalk.gray(`│      `) + chalk.dim(`... [${lineCount - limit} lines truncated · toggle with /verbose]`))
    }
  }
}

/**
 * Formats terminal markdown with full-width code blocks.
 */
export function formatTerminalMarkdown(content: string, maxWidth?: number): string {
  const W = maxWidth || (getTerminalWidth() - 4)

  let formatted = content.replace(/```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g, (_, lang, code) => {
    const langTag = lang ? ` ${lang} ` : ' code '
    const headerRem = Math.max(0, W - visibleLength(langTag) - 3)
    const top = chalk.dim('┌─') + chalk.cyan.bold(langTag) + chalk.dim('─'.repeat(headerRem) + '┐')
    const lines = code.trimEnd().split('\n')
    const middle = lines.map((l: string) => chalk.dim('│ ') + fitLine(chalk.white(l), W - 4) + chalk.dim(' │'))
    const bottom = chalk.dim('└' + '─'.repeat(W - 2) + '┘')
    return '\n' + [top, ...middle, bottom].join('\n') + '\n'
  })

  formatted = formatted.replace(/^(#{1,3})\s+(.*)$/gm, (_, hashes, title) => {
    return chalk.bold.cyan(`\n${hashes} ${title}`)
  })

  formatted = formatted.replace(/\*\*(.*?)\*\*/g, (_, text) => chalk.bold(text))
  formatted = formatted.replace(/`([^`\n]+)`/g, (_, code) => chalk.yellow(`\`${code}\``))
  return formatted
}

/**
 * Formats the final agent response in a full-width structured container.
 */
export function renderResponseCard(opts: {
  content: string
  model: string
  turns?: number
  costSummary?: string
  sessionId: string
}): string {
  const W = getTerminalWidth()
  const innerW = W - 4

  const cleanAnswer = opts.content.replace(/<(thinking|thought|reasoning)>[\s\S]*?<\/\1>/gi, '').trim()
  const formattedMarkdown = formatTerminalMarkdown(cleanAnswer || opts.content, innerW)
  const contentLines: string[] = []
  for (const l of formattedMarkdown.split('\n')) {
    contentLines.push(...wrapText(l, innerW))
  }

  const box = createBox('⚡ G0DM0D3 AGENT RESPONSE', contentLines, {
    badge: 'Completed',
    borderColor: chalk.green,
    titleColor: chalk.bold.green,
    badgeColor: chalk.bold.green,
  })

  const summaryDivider = createBoxDivider('📊 Execution Summary', chalk.green)
  const line1 = `${chalk.bold.cyan('• Model:')} ${chalk.yellow(opts.model)}   ${chalk.bold.cyan('• Cost & Tokens:')} ${chalk.white(opts.costSummary || 'N/A')}`
  const line2 = `${chalk.bold.cyan('• Session ID:')} ${chalk.white(opts.sessionId)}   ${chalk.dim(`(Resume with: godmode --resume ${opts.sessionId})`)}`
  const bottomBorder = chalk.green('╰' + '─'.repeat(W - 2) + '╯')

  const lastNewlineIdx = box.lastIndexOf('\n')
  const boxWithoutBottom = lastNewlineIdx !== -1 ? box.slice(0, lastNewlineIdx) : box

  return [
    boxWithoutBottom,
    summaryDivider,
    chalk.green('│ ') + fitLine(line1, innerW) + chalk.green(' │'),
    chalk.green('│ ') + fitLine(line2, innerW) + chalk.green(' │'),
    bottomBorder,
  ].join('\n') + '\n'
}
