import fs from 'fs'
import path from 'path'
import { ToolDefinition } from '../agent/types'

function getSkillDirectories(): string[] {
  const dirs = [
    path.resolve(process.cwd(), 'skills'),
    path.resolve(process.cwd(), '.agents/skills'),
    path.resolve(__dirname, '../../../skills'),
    path.resolve(__dirname, '../../skills'),
    path.resolve(__dirname, '../skills'),
    '/Users/elamine/dev/custom-skills',
  ]
  return [...new Set(dirs)].filter(d => fs.existsSync(d))
}

export const manageSkillsDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'manage_skills',
    description: 'Discover, load, and create reusable agent skills (procedures, runbooks, and pentest methodologies).',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['list', 'load', 'create'],
          description: 'The action to perform: "list" to find skills, "load" to read a skill into context, "create" to write a new skill.',
        },
        skill_name: {
          type: 'string',
          description: 'The identifier/name of the skill (for "load" or "create").',
        },
        content: {
          type: 'string',
          description: 'The full markdown content of the SKILL.md file (required for "create"). Must include YAML frontmatter with name and description.',
        },
        destination_dir: {
          type: 'string',
          description: 'Directory where the skill should be created (defaults to "/Users/elamine/dev/custom-skills").',
        },
      },
      required: ['action'],
    },
  },
}

export async function manageSkillsHandler(args: {
  action: 'list' | 'load' | 'create'
  skill_name?: string
  content?: string
  destination_dir?: string
}): Promise<string> {
  const { action, skill_name, content, destination_dir } = args

  if (action === 'list') {
    const searchDirs = getSkillDirectories()
    if (searchDirs.length === 0) {
      return 'No skill directories found. You can create one with manage_skills(action="create").'
    }

    const discovered: Array<{ name: string; path: string; description: string }> = []
    for (const dir of searchDirs) {
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true })
        for (const entry of entries) {
          if (entry.isDirectory()) {
            const skillMdPath = path.join(dir, entry.name, 'SKILL.md')
            if (fs.existsSync(skillMdPath)) {
              let desc = 'No description'
              try {
                const text = fs.readFileSync(skillMdPath, 'utf-8')
                const match = text.match(/description:\s*([^\n\r]+)/i)
                if (match) desc = match[1].trim()
              } catch {}
              discovered.push({ name: entry.name, path: skillMdPath, description: desc })
            }
          }
        }
      } catch {}
    }

    if (discovered.length === 0) {
      return 'No skills found in search paths: ' + searchDirs.join(', ')
    }

    let out = `Discovered ${discovered.length} Skills:\n\n`
    for (const s of discovered) {
      out += `• **${s.name}**\n  Path: ${s.path}\n  Description: ${s.description}\n\n`
    }
    return out
  }

  if (action === 'load') {
    if (!skill_name) {
      return 'Error: skill_name is required for "load" action.'
    }
    const searchDirs = getSkillDirectories()
    for (const dir of searchDirs) {
      const target = path.join(dir, skill_name, 'SKILL.md')
      if (fs.existsSync(target)) {
        const data = fs.readFileSync(target, 'utf-8')
        return `[Skill Loaded: ${skill_name}]\nPath: ${target}\n\n${data}`
      }
    }
    return `Error: Skill "${skill_name}" not found in search paths: ${searchDirs.join(', ')}`
  }

  if (action === 'create') {
    if (!skill_name) {
      return 'Error: skill_name is required for "create" action.'
    }
    if (!content) {
      return 'Error: content is required for "create" action.'
    }

    const baseDir = destination_dir || '/Users/elamine/dev/custom-skills'
    const targetFolder = path.join(baseDir, skill_name)
    const targetFile = path.join(targetFolder, 'SKILL.md')

    try {
      fs.mkdirSync(targetFolder, { recursive: true })
      fs.writeFileSync(targetFile, content, 'utf-8')
      return `✓ Skill "${skill_name}" created successfully at ${targetFile}`
    } catch (err: any) {
      return `Error creating skill: ${err.message}`
    }
  }

  return `Unknown action "${action}". Must be "list", "load", or "create".`
}
