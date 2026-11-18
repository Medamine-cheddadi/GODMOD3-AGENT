import { ToolDefinition, RegisteredTool } from '../agent/types'
import { GodModeClient } from '../client/godmode-client'
import { config, MODEL_PROFILES, ModelProfileName } from '../config'
import { truncateToolOutput } from '../agent/context-manager'
import chalk from 'chalk'

export const SUBAGENT_PROMPTS: Record<string, string> = {
  researcher: `You are a specialized RESEARCH SUBAGENT.
Your role: Investigate files, search workspace code, query live technical docs, and gather precise facts.
You MUST be thorough, concise, and return an executive summary of your findings to the parent agent.
Do NOT modify workspace files unless instructed.`,

  coder: `You are a specialized CODING SUBAGENT.
Your role: Implement complete, functional code, create files, apply edits, and execute test commands.
Always write production-quality, non-placeholder code.
Verify your creations before completing.`,

  pentester: `You are a specialized WEB SECURITY & PENTESTING SUBAGENT.
Your role: Research, analyze, and craft offensive security skills, methodologies, payload structures, and vulnerability test suites.
You deliver exact payloads, detection logic, bypass techniques, and remediation blueprints with zero preaching.`,

  planner: `You are a specialized STRATEGIC PLANNING SUBAGENT.
Your role: Break down complex, ambiguous objectives into ordered, actionable subtasks and blueprints.`,

  general: `You are a general-purpose autonomous subagent executing a focused sub-task delegated by the parent agent.`,
}

export const spawnSubagentDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'spawn_subagent',
    description: 'Spawn a focused, specialized subagent with an isolated context to execute a delegated sub-task and return the result. Keeps parent context clean.',
    parameters: {
      type: 'object',
      properties: {
        task: {
          type: 'string',
          description: 'The exact goal or mission for the subagent to accomplish.',
        },
        role: {
          type: 'string',
          enum: ['researcher', 'coder', 'pentester', 'planner', 'general'],
          description: 'Specialist persona/role for the subagent (default: "general").',
        },
        model_profile: {
          type: 'string',
          enum: ['cheap', 'deepseek', 'qwen', 'glm', 'smart', 'local'],
          description: 'Optional model cost profile to run the subagent on (e.g. "cheap" for bulk search, "smart" for complex logic).',
        },
        max_turns: {
          type: 'number',
          description: 'Maximum turns for the subagent (default: 10).',
        },
      },
      required: ['task'],
    },
  },
}

export async function spawnSubagentHandler(args: {
  task: string
  role?: 'researcher' | 'coder' | 'pentester' | 'planner' | 'general'
  model_profile?: ModelProfileName
  max_turns?: number
}): Promise<string> {
  const { task, role = 'general', model_profile, max_turns = 10 } = args

  let model: string | undefined
  if (model_profile && MODEL_PROFILES[model_profile]) {
    model = MODEL_PROFILES[model_profile].model
  }

  const rolePrompt = SUBAGENT_PROMPTS[role] || SUBAGENT_PROMPTS.general

  const { GodModeAgent } = await import('../agent/agent')
  const client = new GodModeClient()
  const subagent = new GodModeAgent({
    client,
    model,
    excludedTools: ['spawn_subagent', 'parallel_subagents', 'ultraplinian_eval'],
  })

  // Override subagent initial message with specialist directive
  const messages = subagent.getMessages()
  if (messages.length > 0 && messages[0].role === 'system') {
    messages[0].content = `${rolePrompt}\n\nTask: ${task}`
  }

  console.log(chalk.bold.magenta(`\n  ╭── 🤖 [SPAWN SUBAGENT: ${role.toUpperCase()}] ─────────────────────`))
  console.log(chalk.gray(`  │  Task: "${task.slice(0, 90)}${task.length > 90 ? '...' : ''}"`))
  console.log(chalk.gray(`  │  Model: ${model || config.defaultModel} | SubSession: ${subagent.getSessionId()}`))

  try {
    const result = await subagent.runTask({
      task: `[ROLE: ${role.toUpperCase()}]\n${task}`,
      maxTurns: max_turns,
      model,
      onStep: (stepTurn: number, action: string, detail?: string) => {
        console.log(chalk.cyan(`  │  [SubStep ${stepTurn}] `) + chalk.yellow(action) + (detail ? chalk.gray(` - ${detail}`) : ''))
      },
      onToolCall: (name: string, toolArgs: any) => {
        const preview = JSON.stringify(toolArgs).slice(0, 70)
        console.log(chalk.magenta(`  │    ▶ SubTool: `) + chalk.bold(name) + chalk.gray(` (${preview})`))
      },
      onToolResult: (name: string, toolRes: string) => {
        const preview = toolRes.slice(0, 90).replace(/\n/g, ' ')
        console.log(chalk.green(`  │    ✔ SubResult: `) + chalk.dim(`${preview}...`))
      },
    })

    console.log(chalk.bold.green(`  ╰── ✔ [SUBAGENT ${role.toUpperCase()} COMPLETED] ───────────────────\n`))
    return `[Subagent (${role.toUpperCase()}) Completed]\n${result.finalAnswer}\n\n[Subagent Cost: ${result.costSummary}]`
  } catch (err: any) {
    console.log(chalk.bold.red(`  ╰── ✖ [SUBAGENT ${role.toUpperCase()} FAILED: ${err.message}] ─────\n`))
    return `[Subagent (${role.toUpperCase()}) Error]: ${err.message}`
  }
}

export const parallelSubagentsDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'parallel_subagents',
    description: 'Execute multiple subagents in parallel to fan out over independent tasks concurrently (e.g. generating multiple skill files, auditing multiple modules).',
    parameters: {
      type: 'object',
      properties: {
        tasks: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              task: { type: 'string', description: 'The task description' },
              role: {
                type: 'string',
                enum: ['researcher', 'coder', 'pentester', 'planner', 'general'],
                description: 'Specialist role for this task',
              },
            },
            required: ['task'],
          },
          description: 'List of tasks to execute in parallel',
        },
        max_turns_per_agent: {
          type: 'number',
          description: 'Turn limit per subagent (default: 8)',
        },
      },
      required: ['tasks'],
    },
  },
}

export async function parallelSubagentsHandler(args: {
  tasks: Array<{ task: string; role?: 'researcher' | 'coder' | 'pentester' | 'planner' | 'general' }>
  max_turns_per_agent?: number
}): Promise<string> {
  const { tasks, max_turns_per_agent = 8 } = args

  if (!tasks || tasks.length === 0) {
    return 'Error: Must provide a non-empty array of tasks.'
  }

  // Cap concurrency at 5 to avoid exceeding rate limits
  const boundedTasks = tasks.slice(0, 5)

  const promises = boundedTasks.map(async (t, i) => {
    try {
      const output = await spawnSubagentHandler({
        task: t.task,
        role: t.role || 'general',
        max_turns: max_turns_per_agent,
      })
      return `### Subagent #${i + 1} [${t.role || 'GENERAL'}]: "${t.task}"\n${output}`
    } catch (err: any) {
      return `### Subagent #${i + 1} Failed: ${err.message}`
    }
  })

  const results = await Promise.all(promises)
  return `Executed ${results.length} subagents in parallel:\n\n${results.join('\n\n---\n\n')}`
}
