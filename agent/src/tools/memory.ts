import { ToolDefinition } from '../agent/types'

let memoryStore: Record<string, string> = {}

export function getActiveMemory(): Record<string, string> {
  return { ...memoryStore }
}

export function setActiveMemory(mem: Record<string, string>): void {
  memoryStore = { ...mem }
}

export const memoryToolDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'manage_memory',
    description: 'Store or recall key facts, discoveries, file paths, credentials, or intermediate findings into persistent session memory.',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['store', 'recall', 'list', 'delete', 'clear'],
          description: 'Memory action to perform',
        },
        key: {
          type: 'string',
          description: 'Unique key or topic label (e.g. "target_api_port", "sqli_payload")',
        },
        value: {
          type: 'string',
          description: 'The information or finding to store (for action="store")',
        },
      },
      required: ['action'],
    },
  },
}

export async function memoryToolHandler(args: {
  action: 'store' | 'recall' | 'list' | 'delete' | 'clear'
  key?: string
  value?: string
}): Promise<string> {
  const { action, key, value } = args

  switch (action) {
    case 'store': {
      if (!key || value === undefined) {
        return 'Error: Both "key" and "value" are required for store action.'
      }
      memoryStore[key] = value
      return `Stored memory [${key}] successfully.`
    }

    case 'recall': {
      if (!key) return 'Error: "key" is required to recall memory.'
      if (key in memoryStore) {
        return `[Memory: ${key}]\n${memoryStore[key]}`
      }
      return `No memory entry found for key "${key}".`
    }

    case 'delete': {
      if (!key) return 'Error: "key" is required to delete memory.'
      if (key in memoryStore) {
        delete memoryStore[key]
        return `Deleted memory entry [${key}].`
      }
      return `No memory entry found for key "${key}".`
    }

    case 'clear': {
      memoryStore = {}
      return 'Session memory cleared.'
    }

    case 'list':
    default: {
      const keys = Object.keys(memoryStore)
      if (keys.length === 0) {
        return 'Session memory is currently empty.'
      }
      const list = keys.map(k => `  • [${k}]: ${memoryStore[k].slice(0, 100)}${memoryStore[k].length > 100 ? '...' : ''}`)
      return `Saved Session Memories (${keys.length}):\n${list.join('\n')}`
    }
  }
}
