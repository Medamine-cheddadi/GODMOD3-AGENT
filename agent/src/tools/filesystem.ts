import fs from 'fs/promises'
import path from 'path'
import { ToolDefinition, ToolHandler } from '../agent/types'
import { config } from '../config'
import { checkpointManager } from '../agent/checkpoint-manager'

function resolvePath(filePath: string): string {
  if (path.isAbsolute(filePath)) {
    return filePath
  }
  return path.resolve(config.workDir, filePath)
}

// ── read_file ──────────────────────────────────────────────────────────
export const readFileDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'read_file',
    description: 'Read the contents of a text file. Returns numbered lines.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'The path to the file to read (absolute or relative to current directory).',
        },
        startLine: {
          type: 'number',
          description: 'Optional 1-based start line number to begin reading from.',
        },
        endLine: {
          type: 'number',
          description: 'Optional 1-based end line number (inclusive).',
        },
      },
      required: ['path'],
    },
  },
}

export const readFileHandler: ToolHandler = async (args: { path: string; startLine?: number; endLine?: number }) => {
  const fullPath = resolvePath(args.path)
  try {
    const content = await fs.readFile(fullPath, 'utf-8')
    const lines = content.split('\n')
    const start = Math.max(1, args.startLine || 1) - 1
    const end = Math.min(lines.length, args.endLine || lines.length)

    const slice = lines.slice(start, end)
    const formatted = slice.map((l, idx) => `${start + idx + 1}: ${l}`).join('\n')
    return `[File: ${args.path} (${lines.length} total lines)]\n${formatted}`
  } catch (err: any) {
    return `Error reading file ${args.path}: ${err.message}`
  }
}

// ── write_file ─────────────────────────────────────────────────────────
export const writeFileDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'write_file',
    description: 'Create a new file or overwrite an existing file with the provided contents.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'The path to the file to write.',
        },
        content: {
          type: 'string',
          description: 'The full text content to write to the file.',
        },
      },
      required: ['path', 'content'],
    },
  },
}

export const writeFileHandler: ToolHandler = async (args: { path: string; content: string }) => {
  const fullPath = resolvePath(args.path)
  checkpointManager.backupFileBeforeChange(fullPath)
  try {
    await fs.mkdir(path.dirname(fullPath), { recursive: true })
    await fs.writeFile(fullPath, args.content, 'utf-8')
    return `Successfully wrote ${args.content.length} characters to ${args.path}`
  } catch (err: any) {
    return `Error writing file ${args.path}: ${err.message}`
  }
}

// ── edit_file ──────────────────────────────────────────────────────────
export const editFileDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'edit_file',
    description: 'Replace an exact target substring with replacement text in a file.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'The path to the file to edit.',
        },
        target: {
          type: 'string',
          description: 'The exact character sequence to replace (must match exactly).',
        },
        replacement: {
          type: 'string',
          description: 'The replacement string.',
        },
      },
      required: ['path', 'target', 'replacement'],
    },
  },
}

export const editFileHandler: ToolHandler = async (args: { path: string; target: string; replacement: string }) => {
  const fullPath = resolvePath(args.path)
  checkpointManager.backupFileBeforeChange(fullPath)
  try {
    const content = await fs.readFile(fullPath, 'utf-8')
    if (!content.includes(args.target)) {
      return `Error: Target string not found in ${args.path}`
    }
    const updated = content.replaceAll(args.target, args.replacement)
    await fs.writeFile(fullPath, updated, 'utf-8')
    return `Successfully updated ${args.path}`
  } catch (err: any) {
    return `Error editing file ${args.path}: ${err.message}`
  }
}

// ── list_directory ─────────────────────────────────────────────────────
export const listDirectoryDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'list_directory',
    description: 'List files and directories in a given directory path.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Directory path to list (defaults to current working directory).',
        },
      },
    },
  },
}

export const listDirectoryHandler: ToolHandler = async (args: { path?: string }) => {
  const dirPath = resolvePath(args.path || '.')
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true })
    const list = entries.map(e => `${e.isDirectory() ? '[DIR]  ' : '[FILE] '} ${e.name}`).join('\n')
    return `Contents of ${args.path || '.'}:\n${list || '(empty)'}`
  } catch (err: any) {
    return `Error listing directory ${args.path || '.'}: ${err.message}`
  }
}
