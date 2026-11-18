export interface ToolCall {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string
  }
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null
  name?: string
  tool_call_id?: string
  tool_calls?: ToolCall[]
}

export interface ToolDefinition {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: {
      type: 'object'
      properties: Record<string, any>
      required?: string[]
    }
  }
}

export type ToolHandler = (args: any) => Promise<string>

export interface RegisteredTool {
  definition: ToolDefinition
  handler: ToolHandler
}

export interface StepResult {
  thought?: string
  response?: string
  toolCalls?: ToolCall[]
  toolOutputs?: Array<{ id: string; name: string; output: string }>
  isComplete: boolean
  error?: string
}

export interface TodoItem {
  id: string
  task: string
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled'
}

export interface AgentSession {
  id: string
  createdAt: number
  updatedAt: number
  goal: string
  model: string
  messages: ChatMessage[]
  todos: TodoItem[]
  memory: Record<string, string>
  turnsTaken: number
  currentRunTurns?: number
  completedTasks?: string[]
  maxTurns: number
  costSummary: string
  status: 'active' | 'completed' | 'interrupted' | 'error'
}

export interface AgentRunOptions {
  task: string
  model?: string
  maxTurns?: number
  unlimited?: boolean
  maxRefusals?: number
  fallbackModels?: string[]
  sessionId?: string
  resumeSession?: AgentSession
  requireApproval?: boolean
  onStep?: (turn: number, action: string, detail?: string, costSummary?: string) => void
  onToolCall?: (toolName: string, args: any) => void
  onToolResult?: (toolName: string, result: string) => void
  onComplete?: (finalOutput: string, costSummary?: string) => void
  onTodoUpdate?: (todos: TodoItem[]) => void
  onApprovalRequest?: (toolName: string, args: any) => Promise<boolean>
  onTurnLimitReached?: (currentTurn: number) => Promise<boolean | number>
  onRefusal?: (count: number, max: number, refusalText: string) => void
  onModelChange?: (oldModel: string, newModel: string, reason: string) => void
}
