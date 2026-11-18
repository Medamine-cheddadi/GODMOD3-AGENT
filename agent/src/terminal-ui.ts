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

  const line1 = `${chalk.bold.cyan('• Model:')} ${chalk.bold.yellow(opts.model)} ${chalk.dim(`(${opts.profile})`)}   ${chalk.bold.cyan('• Context:')} ${chalk.green(opts.contextWindow)}   ${chalk.bold.cyan('• Mode:')} ${chalk.bold.green('UNCENSORED')}`
  const line2 = `${chalk.bold.cyan('• Workspace:')} ${chalk.white(opts.workdir)}   ${chalk.bold.cyan('• Engine:')} ${chalk.magenta('Autonomous ReAct + STM Tools')}`

  return [
    chalk.cyan('╭─') + chalk.bold.cyan(` ${title} `) + chalk.bold.green(`${tag} `) + chalk.cyan('─'.repeat(topRem) + '╮'),
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
    chalk.bold.cyan('  CONTROL & EXECUTION'),
    row(`${chalk.bold.green('/stop')}, ${chalk.bold.green('/cancel')}`, 'Stop active task execution immediately (or press Ctrl+C)'),
    row(`${chalk.bold.green('/steer')}, ${chalk.bold.green('/add')}`, 'Inject guidance / steering over active agent session'),
    row(`${chalk.bold.green('/status')}, ${chalk.bold.green('/explain')}`, 'Inspect live agent thoughts, turns taken, and findings'),
    row(`${chalk.bold.green('/verbose')}`, 'Toggle collapsed vs expanded thinking and tool output'),
    row(`${chalk.bold.green('/clear')}, ${chalk.bold.green('/reset')}`, 'Reset agent memory and state to start clean session'),
    row(`${chalk.bold.green('/version')}`, 'Display agent engine version, platform, and runtime info'),
    '',
    chalk.bold.magenta('  SPECIALIST SUBAGENTS'),
    row(`${chalk.bold.green('/pentest')} <target>`, 'Spawn offensive security pentesting specialist subagent'),
    row(`${chalk.bold.green('/research')} <query>`, 'Spawn deep research and code audit specialist subagent'),
    row(`${chalk.bold.green('/code')} <task>`, 'Spawn autonomous coding specialist subagent'),
    row(`${chalk.bold.green('/plan')} <objective>`, 'Spawn strategic planner subagent to decompose objectives'),
    row(`${chalk.bold.green('/spawn')} <role> <task>`, 'Spawn custom specialist role (coder, pentester, planner...)'),
    row(`${chalk.bold.green('/subagents')}`, 'List all specialist subagent capabilities and roles'),
    '',
    chalk.bold.yellow('  MODELS & INTELLIGENCE'),
    row(`${chalk.bold.green('/model')} <profile>`, 'Switch profile (glm, deepseek, qwen, smart, cheap, local)'),
    row(`${chalk.bold.green('/models')}`, 'List all model profiles, pricing, and context windows'),
    row(`${chalk.bold.green('/race')} <prompt>`, 'Race prompt across models with ULTRAPLINIAN'),
    row(`${chalk.bold.green('/skills')}`, 'Browse and inspect 40+ pentest skill runbooks'),
    '',
    chalk.bold.blue('  STATE & SESSIONS'),
    row(`${chalk.bold.green('/todos')}`, 'View current multi-step task checklist and subtasks'),
    row(`${chalk.bold.green('/memory')}`, 'Inspect saved persistent agent session memory graph'),
    row(`${chalk.bold.green('/diff')}`, 'View git diff of modified files in active session'),
    row(`${chalk.bold.green('/undo')}`, 'Rollback file changes made in the last turn'),
    row(`${chalk.bold.green('/checkpoints')}`, 'List turn snapshots in the active session'),
    row(`${chalk.bold.green('/sessions')}, ${chalk.bold.green('/resume')}`, 'List saved checkpoints or resume a past session'),
    '',
  ]

  return createBox('🤖 G0DM0D3 COMMAND PALETTE', lines, {
    badge: 'Press Tab on "/" for live autocomplete',
    borderColor: chalk.cyan,
    titleColor: chalk.bold.cyan,
    badgeColor: chalk.dim,
  })
}

/**
 * Formats model reasoning / thinking box spanning the full terminal width.
 */
export function renderThinkingBox(thought: string, verbose = false): string {
  const words = thought.trim().split(/\s+/).filter(Boolean).length
  const rawLines = thought.trim().split('\n').filter(l => l.trim().length > 0)
  const W = getTerminalWidth()
  const innerW = W - 4

  if (!verbose && rawLines.length > 3) {
    const preview = rawLines[0]
    const wrapped = wrapText(preview, innerW).slice(0, 2)
    const lines = [
      ...wrapped.map(l => chalk.italic.white(l)),
      chalk.dim(`... [${rawLines.length - 1} lines collapsed • toggle full reasoning with /verbose]`),
    ]
    return '\n' + createBox('🧠 REASONING', lines, {
      badge: `${words} words • Collapsed`,
      borderColor: chalk.magenta,
      titleColor: chalk.bold.magenta,
      badgeColor: chalk.dim,
    })
  }

  const allLines: string[] = []
  for (const l of rawLines) {
    allLines.push(...wrapText(l, innerW).map(wl => chalk.italic.white(wl)))
  }

  return '\n' + createBox('🧠 REASONING', allLines, {
    badge: `${words} words • Expanded`,
    borderColor: chalk.magenta,
    titleColor: chalk.bold.magenta,
    badgeColor: chalk.dim,
  })
}

/**
 * Formats tool execution card spanning the full terminal width.
 */
export function renderToolCallBox(name: string, args: any): string {
  const W = getTerminalWidth()
  const innerW = W - 4
  const argStr = JSON.stringify(args, null, 2)
  const argLines = argStr.split('\n')
  const lines: string[] = []

  if (argLines.length <= 4) {
    lines.push(...argLines.map(l => chalk.yellow(l)))
  } else {
    lines.push(
      chalk.yellow(argLines[0]),
      ...argLines.slice(1, 4).map(l => chalk.yellow(l)),
      chalk.dim(`... [${argLines.length - 4} more lines of args]`)
    )
  }

  return '\n' + createBox(`🛠️ TOOL: ${name}`, lines, {
    badge: 'Executing',
    borderColor: chalk.blue,
    titleColor: chalk.bold.blue,
    badgeColor: chalk.cyan,
  })
}

/**
 * Formats tool execution output spanning the full terminal width.
 */
export function renderToolResultBox(name: string, result: string, verbose = false): string {
  const rawLines = result.trim().split('\n')
  const lineCount = rawLines.length
  const W = getTerminalWidth()
  const innerW = W - 4

  let displayed: string[] = []
  let badge = `${lineCount} lines`

  if (!verbose && lineCount > 6) {
    badge = `${lineCount} lines • Collapsed`
    const sample = rawLines.slice(0, 5)
    for (const l of sample) {
      displayed.push(...wrapText(l, innerW).map(wl => chalk.dim(wl)))
    }
    displayed.push(chalk.dim(`... [${lineCount - 5} more lines collapsed • toggle full output with /verbose]`))
  } else {
    const limit = verbose ? 100 : 25
    const sample = rawLines.slice(0, limit)
    for (const l of sample) {
      displayed.push(...wrapText(l, innerW).map(wl => chalk.dim(wl)))
    }
    if (lineCount > limit) {
      displayed.push(chalk.dim(`... [${lineCount - limit} more lines truncated • /verbose to view more]`))
    }
  }

  return createBox(`✔️ OUTPUT: ${name}`, displayed, {
    badge,
    borderColor: chalk.green,
    titleColor: chalk.bold.green,
    badgeColor: chalk.dim,
  }) + '\n'
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
