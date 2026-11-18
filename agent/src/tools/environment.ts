import os from 'os'
import { execSync } from 'child_process'
import { ToolDefinition, ToolHandler } from '../agent/types'

export const inspectEnvironmentDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'inspect_environment',
    description: 'Inspect the host workspace environment: OS, Node version, Git branch/status, hardware, and available CLI tools (git, python, docker, curl, etc.).',
    parameters: {
      type: 'object',
      properties: {},
    },
  },
}

export const inspectEnvironmentHandler: ToolHandler = async () => {
  const platform = os.platform()
  const release = os.release()
  const arch = os.arch()
  const cpus = os.cpus().length
  const freeMemMb = Math.round(os.freemem() / (1024 * 1024))
  const totalMemMb = Math.round(os.totalmem() / (1024 * 1024))
  const cwd = process.cwd()

  // Check common CLI tools
  const commonTools = ['git', 'python3', 'python', 'docker', 'curl', 'jq', 'tar', 'unzip', 'nmap', 'sqlmap']
  const installedTools: string[] = []

  for (const t of commonTools) {
    try {
      execSync(`command -v ${t}`, { stdio: 'ignore' })
      installedTools.push(t)
    } catch {}
  }

  // Check git status if in repo
  let gitInfo = 'Not a git repository'
  try {
    const branch = execSync('git rev-parse --abbrev-ref HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
    const status = execSync('git status --short', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
    const changedCount = status ? status.split('\n').length : 0
    gitInfo = `Branch: ${branch} (${changedCount} modified/untracked files)`
  } catch {}

  return `[Host Environment Inspection]
• OS: ${platform} (${release}) ${arch}
• Hardware: ${cpus} CPU cores | Memory: ${freeMemMb}MB free / ${totalMemMb}MB total
• Working Directory: ${cwd}
• Node Version: ${process.version}
• Git: ${gitInfo}
• Installed CLI Tools: ${installedTools.join(', ') || 'none detected'}
`
}
