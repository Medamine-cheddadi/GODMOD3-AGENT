import { ToolDefinition, TodoItem } from '../agent/types'

// Shared in-memory todo list for the active agent session
let currentTodos: TodoItem[] = []

export function getActiveTodos(): TodoItem[] {
  return [...currentTodos]
}

export function setActiveTodos(todos: TodoItem[]): void {
  currentTodos = [...todos]
}

export const manageTodosDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'manage_todos',
    description: 'Create, update, track, and complete tasks/subtasks in your plan. Essential for complex, multi-step goals.',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['add', 'update', 'list', 'complete', 'clear'],
          description: 'The action to perform on the task list',
        },
        task: {
          type: 'string',
          description: 'Description of the task to add (for action="add")',
        },
        tasks: {
          type: 'array',
          items: { type: 'string' },
          description: 'List of task descriptions to add in batch (for action="add")',
        },
        id: {
          type: 'string',
          description: 'ID of the task to update (e.g. "1", "2") (for action="update" or "complete")',
        },
        status: {
          type: 'string',
          enum: ['pending', 'in_progress', 'completed', 'cancelled'],
          description: 'New status for the task (for action="update")',
        },
      },
      required: ['action'],
    },
  },
}

export async function manageTodosHandler(args: {
  action: 'add' | 'update' | 'list' | 'complete' | 'clear'
  task?: string
  tasks?: string[]
  id?: string
  status?: 'pending' | 'in_progress' | 'completed' | 'cancelled'
}): Promise<string> {
  const { action, task, tasks, id, status } = args

  switch (action) {
    case 'add': {
      const itemsToAdd = tasks || (task ? [task] : [])
      if (itemsToAdd.length === 0) {
        return 'Error: Must provide "task" (string) or "tasks" (array of strings) to add.'
      }
      for (const t of itemsToAdd) {
        const nextId = String(currentTodos.length + 1)
        currentTodos.push({
          id: nextId,
          task: t.trim(),
          status: 'pending',
        })
      }
      return formatTodoList(`Added ${itemsToAdd.length} task(s). Current checklist:`)
    }

    case 'update': {
      if (!id) return 'Error: "id" is required to update a task.'
      const item = currentTodos.find(t => t.id === id)
      if (!item) return `Error: Task with ID "${id}" not found.`
      if (status) item.status = status
      return formatTodoList(`Updated task #${id} to ${status || item.status}:`)
    }

    case 'complete': {
      if (!id) return 'Error: "id" is required to complete a task.'
      const item = currentTodos.find(t => t.id === id)
      if (!item) return `Error: Task with ID "${id}" not found.`
      item.status = 'completed'
      return formatTodoList(`Marked task #${id} completed:`)
    }

    case 'clear': {
      currentTodos = []
      return 'Checklist cleared.'
    }

    case 'list':
    default: {
      return formatTodoList('Current checklist:')
    }
  }
}

function formatTodoList(title: string): string {
  if (currentTodos.length === 0) {
    return `${title} (No tasks registered yet. Use manage_todos with action="add" to plan your steps.)`
  }

  const icons = {
    completed: '✔ [DONE]',
    in_progress: '▶ [IN PROGRESS]',
    pending: '⏳ [TODO]',
    cancelled: '✖ [CANCELLED]',
  }

  const lines = currentTodos.map(
    t => `  ${t.id}. ${icons[t.status] || t.status} ${t.task}`
  )

  const completed = currentTodos.filter(t => t.status === 'completed').length
  const total = currentTodos.length
  const progress = Math.round((completed / total) * 100)

  return `${title}\n${lines.join('\n')}\n\nProgress: ${completed}/${total} completed (${progress}%)`
}
