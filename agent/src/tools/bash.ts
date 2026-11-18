import { exec } from 'child_process'
import { promisify } from 'util'
import { ToolDefinition, ToolHandler } from '../agent/types'
import { config } from '../config'

const execAsync = promisify(exec)

export const executeCommandDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'execute_command',
    description: 'Execute a bash/zsh shell command in the workspace and return stdout and stderr.',
    parameters: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'The exact command line string to run (e.g. "ls -la", "git status", "npm test")',
        },
        timeoutMs: {
          type: 'number',
          description: 'Optional execution timeout in milliseconds (defaults to 60000)',
        },
      },
      required: ['command'],
    },
  },
}

export const executeCommandHandler: ToolHandler = async (args: { command: string; timeoutMs?: number }) => {
  const timeout = args.timeoutMs || config.executionTimeoutMs || 60000
  try {
    const { stdout, stderr } = await execAsync(args.command, {
      cwd: config.workDir,
      timeout,
      maxBuffer: 10 * 1024 * 1024,
    })

    const output = [
      stdout ? `[stdout]\n${stdout}` : '',
      stderr ? `[stderr]\n${stderr}` : '',
    ].filter(Boolean).join('\n')

    return output || '(Command completed successfully with no output)'
  } catch (err: any) {
    return `[Command Failed]\nExit Code: ${err.code ?? 'unknown'}\nError: ${err.message}\n${err.stdout ? `stdout:\n${err.stdout}` : ''}\n${err.stderr ? `stderr:\n${err.stderr}` : ''}`
  }
}
