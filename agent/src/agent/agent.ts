import { ChatMessage, AgentRunOptions, AgentSession } from './types'
import { GodModeClient } from '../client/godmode-client'
import { getAllToolDefinitions, dispatchToolCall } from '../tools'
import { AGENT_SYSTEM_PROMPT } from './prompt'
import { truncateToolOutput, compactHistory } from './context-manager'
import { CostTracker } from './cost-tracker'
import { config, MODEL_PROFILES, getEquivalentPeerModels, MODEL_CATALOG } from '../config'
import { generateSessionId, saveSession } from './session-manager'
import { getActiveTodos, setActiveTodos } from '../tools/todos'
import { getActiveMemory, setActiveMemory } from '../tools/memory'
import { checkpointManager } from './checkpoint-manager'

export const REFUSAL_PATTERNS = [
  /i cannot (assist|comply|fulfill|do that|provide|execute|generate|help with)/i,
  /i am (unable to|not able to|not allowed to)/i,
  /as an ai language model/i,
  /as an ai,/i,
  /as a responsible/i,
  /my safety guidelines/i,
  /against (my|our|safety) (policy|policies|guidelines)/i,
  /i must decline/i,
  /i('m| am) not going to roleplay/i,
  /unconditional compliance/i,
  /i won't generate/i,
  /ethical guidelines/i,
  /i'm not able to/i,
  /i am sorry, but i cannot/i,
]

export function isRefusal(content: string): boolean {
  if (!content) return false
  return REFUSAL_PATTERNS.some(p => p.test(content))
}

export class GodModeAgent {
  private client: GodModeClient
  private messages: ChatMessage[] = []
  private model: string
  private currentSessionId: string
  private sessionCreatedAt: number
  private currentGoal: string = ''
  private completedTasks: string[] = []
  private excludedTools: string[] = []

  constructor(opts?: { client?: GodModeClient; model?: string; session?: AgentSession; excludedTools?: string[] }) {
    this.client = opts?.client || new GodModeClient()
    this.model = opts?.model || config.defaultModel
    this.excludedTools = opts?.excludedTools || []

    if (opts?.session) {
      this.currentSessionId = opts.session.id
      this.sessionCreatedAt = opts.session.createdAt
      this.currentGoal = opts.session.goal
      this.messages = [...opts.session.messages]
      this.model = opts.session.model || this.model
      this.completedTasks = [...(opts.session.completedTasks || [])]
      setActiveTodos(opts.session.todos || [])
      setActiveMemory(opts.session.memory || {})
      checkpointManager.setContext(opts.session.id, 0)
    } else {
      this.currentSessionId = generateSessionId()
      this.sessionCreatedAt = Date.now()
      checkpointManager.setContext(this.currentSessionId, 0)
      this.reset()
    }
  }

  reset() {
    this.currentSessionId = generateSessionId()
    this.sessionCreatedAt = Date.now()
    this.currentGoal = ''
    this.completedTasks = []
    this.messages = [{ role: 'system', content: AGENT_SYSTEM_PROMPT }]
    setActiveTodos([])
    setActiveMemory({})
  }

  getSessionId(): string {
    return this.currentSessionId
  }

  getMessages(): ChatMessage[] {
    return [...this.messages]
  }

  getModel(): string {
    return this.model
  }

  setModel(newModel: string) {
    this.model = newModel
  }

  exportSession(status: AgentSession['status'] = 'active', costSummary = '', currentRunTurns = 0): AgentSession {
    return {
      id: this.currentSessionId,
      createdAt: this.sessionCreatedAt,
      updatedAt: Date.now(),
      goal: this.currentGoal,
      model: this.model,
      messages: [...this.messages],
      todos: getActiveTodos(),
      memory: getActiveMemory(),
      turnsTaken: this.messages.filter(m => m.role === 'assistant').length,
      currentRunTurns,
      completedTasks: [...this.completedTasks],
      maxTurns: config.maxTurns,
      costSummary,
      status,
    }
  }

  /**
   * Run a task autonomously to completion using the ReAct loop
   */
  async runTask(opts: AgentRunOptions): Promise<{ finalAnswer: string; costSummary: string; sessionId: string }> {
    const task = opts.task
    const isUnlimited = opts.unlimited ?? (opts.maxTurns === undefined ? config.maxTurns === 0 : (opts.maxTurns === 0 || opts.maxTurns === -1))
    let maxTurns = isUnlimited ? Infinity : (opts.maxTurns !== undefined ? opts.maxTurns : config.maxTurns)
    let activeModel = opts.model || this.model
    const costTracker = new CostTracker(activeModel)

    const maxRefusals = opts.maxRefusals ?? config.maxRefusals
    let refusalCount = 0
    // Select peer fallback chain matching the active model's tier, context window, and pricing
    const fallbackChain = (opts.fallbackModels && opts.fallbackModels.length > 0)
      ? opts.fallbackModels
      : getEquivalentPeerModels(activeModel)

    if (opts.resumeSession) {
      this.currentSessionId = opts.resumeSession.id
      this.sessionCreatedAt = opts.resumeSession.createdAt
      this.currentGoal = task || opts.resumeSession.goal
      this.messages = [...opts.resumeSession.messages]
      setActiveTodos(opts.resumeSession.todos || [])
      setActiveMemory(opts.resumeSession.memory || {})
      checkpointManager.setContext(opts.resumeSession.id, 0)
      // If a follow-up task is given, append it as a new user prompt
      if (task && task !== opts.resumeSession.goal) {
        this.messages.push({ role: 'user', content: task })
      }
    } else {
      this.currentGoal = task
      this.messages.push({ role: 'user', content: task })
    }

    let runTurn = 0
    let isFinished = false
    let finalAnswer = ''
    const recentToolSignatures: string[] = []

    // Persist session before beginning execution
    saveSession(this.exportSession('active', costTracker.formatSummary(), runTurn))

    // Graceful interrupt handler to ensure state is saved if interrupted
    const sigintHandler = () => {
      saveSession(this.exportSession('interrupted', costTracker.formatSummary(), runTurn))
      process.exit(130)
    }
    process.on('SIGINT', sigintHandler)

    try {
      while (!isFinished) {
        if (runTurn >= maxTurns) {
          if (opts.onTurnLimitReached) {
            const extra = await opts.onTurnLimitReached(runTurn)
            if (typeof extra === 'number' && extra > 0) {
              maxTurns += extra
            } else if (extra === true) {
              maxTurns += 30
            } else {
              break
            }
          } else {
            break
          }
        }

        runTurn++
        checkpointManager.setContext(this.currentSessionId, runTurn)
        const totalSessionTurns = this.messages.filter(m => m.role === 'assistant').length + 1
        const maxTurnsDisplay = isFinite(maxTurns) ? String(maxTurns) : '∞'
        opts.onStep?.(runTurn, 'Thinking', `Turn ${runTurn}/${maxTurnsDisplay} (Session Total: ${totalSessionTurns})`, costTracker.formatSummary())

        const tools = getAllToolDefinitions(this.excludedTools)

        // Prune and compact history to keep context clean & save tokens
        const messagesToSend = compactHistory(this.messages)

        const completion = await this.client.chatCompletion({
          model: activeModel,
          messages: messagesToSend,
          tools,
          temperature: 0.3,
          godmode: true,
          autotune: true,
          parseltongue: false, // keep tools cleanly parseable
          stm_modules: ['hedge_reducer', 'direct_mode'],
          max_tokens: config.maxOutputTokens,
        })

        if (completion.usage) {
          costTracker.addUsage(completion.usage)
        }

        const choice = completion.choices[0]
        if (!choice) {
          throw new Error('No completion choices returned by G0DM0D3 API')
        }

        const assistantMsg = choice.message
        const hasTools = assistantMsg.tool_calls && assistantMsg.tool_calls.length > 0
        const contentStr = assistantMsg.content || (assistantMsg as any).reasoning || ''

        // Check for model refusals / canned disclaimers
        if (!hasTools && isRefusal(contentStr)) {
          refusalCount++
          opts.onRefusal?.(refusalCount, maxRefusals, contentStr)

          if (refusalCount < maxRefusals) {
            // Find next candidate in fallback chain
            const candidate = fallbackChain.find(m => m !== activeModel) || fallbackChain[0]
            const oldModel = activeModel
            activeModel = candidate
            this.model = candidate

            const oldMeta = MODEL_CATALOG[oldModel]
            const newMeta = MODEL_CATALOG[candidate]
            const metaInfo = (oldMeta && newMeta)
              ? ` [Peer Match: ${newMeta.contextWindow} ctx | ${newMeta.pricing}]`
              : ''

            opts.onModelChange?.(
              oldModel,
              candidate,
              `Refusal detected (${refusalCount}/${maxRefusals}). Auto-switching to equivalent peer model${metaInfo}.`
            )

            // Do not record the refusal in message history — retry turn with the new model
            continue
          } else {
            finalAnswer = `[⚠️ Agent Paused: Refusal threshold reached (${refusalCount}/${maxRefusals}). Models declined to proceed.]\n\nLast response:\n${contentStr}`
            isFinished = true
            break
          }
        }

        this.messages.push(assistantMsg)

        // Check if there are tool calls
        if (assistantMsg.tool_calls && assistantMsg.tool_calls.length > 0) {
          for (const tc of assistantMsg.tool_calls) {
            const toolName = tc.function.name
            let toolArgs: any
            try {
              toolArgs = JSON.parse(tc.function.arguments || '{}')
            } catch {
              toolArgs = tc.function.arguments
            }

            opts.onToolCall?.(toolName, toolArgs)

            // Human-in-the-loop approval check for modifying tools
            let approved = true
            const modifyingTools = ['execute_command', 'write_file', 'edit_file']
            if (opts.requireApproval && modifyingTools.includes(toolName) && opts.onApprovalRequest) {
              approved = await opts.onApprovalRequest(toolName, toolArgs)
            }

            let rawOutput: string
            if (!approved) {
              rawOutput = '[Declined: Tool execution was skipped by user request.]'
            } else {
              // Dispatch tool execution
              rawOutput = await dispatchToolCall(toolName, tc.function.arguments)
            }

            // Apply smart truncation to prevent context blowup
            const toolOutput = truncateToolOutput(rawOutput, config.maxToolOutputChars)

            // Detect repetitive tool execution loops & inject corrective warnings
            const sig = `${toolName}:${tc.function.arguments}`
            let finalOutput = toolOutput
            if (recentToolSignatures.length >= 2 && recentToolSignatures.slice(-2).every(s => s === sig)) {
              finalOutput += '\n\n[⚠️ SYSTEM ALERT: You have executed this identical command 3 times. You appear to be in a retry loop. Stop repeating this command. Diagnose the root cause or formulate your final conclusion now.]'
            }
            if (isFinite(maxTurns) && runTurn >= maxTurns - 2) {
              finalOutput += `\n\n[⚠️ SYSTEM NOTICE: Turn ${runTurn}/${maxTurns} for current task. Approaching task turn limit. Conclude your findings and provide your final response on the next turn.]`
            }
            recentToolSignatures.push(sig)

            opts.onToolResult?.(toolName, finalOutput)

            if (toolName === 'manage_todos') {
              opts.onTodoUpdate?.(getActiveTodos())
            }

            // Append tool response to message history
            this.messages.push({
              role: 'tool',
              tool_call_id: tc.id,
              name: toolName,
              content: finalOutput,
            })

            // Save intermediate session progress
            saveSession(this.exportSession('active', costTracker.formatSummary(), runTurn))
          }
        } else {
          // No more tool calls: the agent has finished its work!
          isFinished = true
          const rawContent = assistantMsg.content || (assistantMsg as any).reasoning || ''
          if (!rawContent && choice.finish_reason === 'length') {
            finalAnswer = '[Notice: Model reached token generation limit before outputting text. Increase MAX_OUTPUT_TOKENS in .env.]'
          } else {
            finalAnswer = rawContent || '(Completed without output)'
          }
          opts.onComplete?.(finalAnswer, costTracker.formatSummary())
        }
      }

      if (!isFinished && isFinite(maxTurns) && runTurn >= maxTurns) {
        finalAnswer = `[Notice: Agent reached turn limit (${maxTurns}) for current task. You can continue or resume anytime using --resume or run with --unlimited.]\n\nLast thought:\n${this.messages[this.messages.length - 1]?.content || ''}`
      }

      if (isFinished) {
        this.completedTasks.push(this.currentGoal)
      }

      const finalStatus = isFinished ? 'completed' : 'interrupted'
      saveSession(this.exportSession(finalStatus, costTracker.formatSummary(), runTurn))

      return {
        finalAnswer,
        costSummary: costTracker.formatSummary(),
        sessionId: this.currentSessionId,
      }
    } catch (err: any) {
      saveSession(this.exportSession('error', costTracker.formatSummary(), runTurn))
      opts.onStep?.(runTurn, 'Error', err.message, costTracker.formatSummary())
      throw err
    } finally {
      process.removeListener('SIGINT', sigintHandler)
    }
  }
}
