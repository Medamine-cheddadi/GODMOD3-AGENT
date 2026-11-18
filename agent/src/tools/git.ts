import { execSync } from 'child_process'
import path from 'path'
import fs from 'fs'
import { ToolDefinition, ToolHandler } from '../agent/types'
import { checkpointManager } from '../agent/checkpoint-manager'

/**
 * Check if the current workspace is a git repository.
 */
function isGitRepo(): boolean {
  try {
    const res = execSync('git rev-parse --is-inside-work-tree', {
      stdio: ['pipe', 'pipe', 'ignore'],
    }).toString().trim()
    return res === 'true'
  } catch {
    return false
  }
}

// ── git_diff ───────────────────────────────────────────────────────────
export const gitDiffDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'git_diff',
    description: 'Inspect git working directory changes: view unstaged/staged diffs, list modified/untracked files, or view changes for a specific file.',
    parameters: {
      type: 'object',
      properties: {
        file_path: {
          type: 'string',
          description: 'Optional path to inspect diff for a specific file only.',
        },
        staged: {
          type: 'boolean',
          description: 'Whether to show staged changes (--cached) instead of unstaged changes (default: false).',
        },
        stat_only: {
          type: 'boolean',
          description: 'Show only a summary of changed files and line counts (--stat) instead of full unified diff.',
        },
      },
    },
  },
}

export const gitDiffHandler: ToolHandler = async (args: {
  file_path?: string
  staged?: boolean
  stat_only?: boolean
}) => {
  if (!isGitRepo()) {
    // If not a git repo, fall back to checkpoint manager file listing
    const checkpoints = checkpointManager.listCheckpoints()
    if (checkpoints.length === 0) {
      return 'Notice: Current working directory is not a git repository and no session checkpoints exist.'
    }
    const files = checkpoints.flatMap(c => c.files)
    return `[Non-git workspace] Files modified in active session checkpoints (${files.length}):\n${files.join('\n')}`
  }

  try {
    // 1. Get git status summary
    const statusOut = execSync('git status --short', { stdio: ['pipe', 'pipe', 'ignore'] }).toString().trim()

    // 2. Build diff command
    let cmd = 'git diff'
    if (args.staged) {
      cmd += ' --cached'
    }
    if (args.stat_only) {
      cmd += ' --stat'
    }
    if (args.file_path) {
      cmd += ` -- ${JSON.stringify(args.file_path)}`
    }

    const diffOut = execSync(cmd, { stdio: ['pipe', 'pipe', 'ignore'], maxBuffer: 1024 * 1024 }).toString().trim()

    // 3. Check for untracked files
    const untrackedOut = execSync('git ls-files --others --exclude-standard', {
      stdio: ['pipe', 'pipe', 'ignore'],
    }).toString().trim()

    let result = ''
    if (statusOut) {
      result += `[Git Status Overview]\n${statusOut}\n\n`
    }

    if (untrackedOut && !args.file_path && !args.staged) {
      result += `[Untracked Files]\n${untrackedOut}\n\n`
    }

    if (diffOut) {
      result += `[Unified Diff${args.staged ? ' (Staged)' : ''}]\n${diffOut}`
    } else {
      result += statusOut ? '(Working tree has untracked or staged files, but no unstaged diff)' : 'Working tree clean. No changes detected.'
    }

    return result
  } catch (err: any) {
    return `Error executing git diff: ${err.message}`
  }
}

// ── undo_changes ───────────────────────────────────────────────────────
export const undoChangesDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'undo_changes',
    description: 'Rollback file modifications made by the agent. Can undo the last turn, a specific turn, or all changes made during the entire session.',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['undo_last_turn', 'undo_all_session', 'list_checkpoints', 'restore_turn'],
          description: 'The undo action: "undo_last_turn" (default), "undo_all_session", "list_checkpoints", or "restore_turn".',
        },
        turn: {
          type: 'number',
          description: 'Turn number to restore (required for "restore_turn").',
        },
      },
      required: ['action'],
    },
  },
}

export const undoChangesHandler: ToolHandler = async (args: {
  action: 'undo_last_turn' | 'undo_all_session' | 'list_checkpoints' | 'restore_turn'
  turn?: number
}) => {
  const { action, turn } = args

  if (action === 'list_checkpoints') {
    const list = checkpointManager.listCheckpoints()
    if (list.length === 0) {
      return 'No checkpoints recorded in this session yet.'
    }
    let out = `Recorded Turn Checkpoints (${list.length}):\n\n`
    for (const cp of list) {
      const timeStr = new Date(cp.timestamp).toLocaleTimeString()
      out += `• Turn ${cp.turn} [${timeStr}] - ${cp.modifiedCount} modified, ${cp.createdCount} created\n`
      if (cp.files.length > 0) {
        out += `  Files: ${cp.files.join(', ')}\n`
      }
    }
    return out
  }

  if (action === 'undo_last_turn' || action === 'restore_turn') {
    const target = action === 'restore_turn' ? turn : undefined
    const res = checkpointManager.rollbackTurn(target)
    if (!res.success) {
      return `Rollback Failed: ${res.error}`
    }

    let out = `✓ Successfully rolled back Turn ${target !== undefined ? target : 'latest'}.\n`
    if (res.restoredFiles.length > 0) {
      out += `  Restored original content: ${res.restoredFiles.join(', ')}\n`
    }
    if (res.deletedFiles.length > 0) {
      out += `  Removed created files: ${res.deletedFiles.join(', ')}\n`
    }
    if (res.restoredFiles.length === 0 && res.deletedFiles.length === 0) {
      out += '  (No files were modified during that turn.)'
    }
    return out
  }

  if (action === 'undo_all_session') {
    const res = checkpointManager.rollbackAllSession()
    if (!res.success) {
      return `Rollback Failed: ${res.error}`
    }

    let out = `✓ Successfully rolled back all ${res.turnsReverted} turns from this session.\n`
    if (res.restoredFiles.length > 0) {
      out += `  Restored files: ${res.restoredFiles.join(', ')}\n`
    }
    if (res.deletedFiles.length > 0) {
      out += `  Deleted created files: ${res.deletedFiles.join(', ')}\n`
    }
    if (res.restoredFiles.length === 0 && res.deletedFiles.length === 0) {
      out += '  (No files were modified in this session.)'
    }
    return out
  }

  return `Unknown action "${action}". Must be "undo_last_turn", "undo_all_session", "list_checkpoints", or "restore_turn".`
}
