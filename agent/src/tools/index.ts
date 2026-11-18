import { RegisteredTool, ToolDefinition } from '../agent/types'
import { executeCommandDefinition, executeCommandHandler } from './bash'
import {
  readFileDefinition,
  readFileHandler,
  writeFileDefinition,
  writeFileHandler,
  editFileDefinition,
  editFileHandler,
  listDirectoryDefinition,
  listDirectoryHandler,
} from './filesystem'
import {
  webSearchDefinition,
  webSearchHandler,
  searchFilesDefinition,
  searchFilesHandler,
} from './search'
import { fetchWebPageDefinition, fetchWebPageHandler } from './web'
import { inspectEnvironmentDefinition, inspectEnvironmentHandler } from './environment'
import {
  spawnSubagentDefinition,
  spawnSubagentHandler,
  parallelSubagentsDefinition,
  parallelSubagentsHandler,
} from './subagent'
import { ultraplinianRaceDefinition, ultraplinianRaceHandler } from './ultraplinian'
import { manageTodosDefinition, manageTodosHandler } from './todos'
import { memoryToolDefinition, memoryToolHandler } from './memory'
import { manageSkillsDefinition, manageSkillsHandler } from './skills'
import {
  gitDiffDefinition,
  gitDiffHandler,
  undoChangesDefinition,
  undoChangesHandler,
} from './git'

export const registeredTools: Record<string, RegisteredTool> = {
  execute_command: {
    definition: executeCommandDefinition,
    handler: executeCommandHandler,
  },
  read_file: {
    definition: readFileDefinition,
    handler: readFileHandler,
  },
  write_file: {
    definition: writeFileDefinition,
    handler: writeFileHandler,
  },
  edit_file: {
    definition: editFileDefinition,
    handler: editFileHandler,
  },
  list_directory: {
    definition: listDirectoryDefinition,
    handler: listDirectoryHandler,
  },
  search_files: {
    definition: searchFilesDefinition,
    handler: searchFilesHandler,
  },
  web_search: {
    definition: webSearchDefinition,
    handler: webSearchHandler,
  },
  fetch_web_page: {
    definition: fetchWebPageDefinition,
    handler: fetchWebPageHandler,
  },
  inspect_environment: {
    definition: inspectEnvironmentDefinition,
    handler: inspectEnvironmentHandler,
  },
  manage_todos: {
    definition: manageTodosDefinition,
    handler: manageTodosHandler,
  },
  manage_memory: {
    definition: memoryToolDefinition,
    handler: memoryToolHandler,
  },
  manage_skills: {
    definition: manageSkillsDefinition,
    handler: manageSkillsHandler,
  },
  git_diff: {
    definition: gitDiffDefinition,
    handler: gitDiffHandler,
  },
  undo_changes: {
    definition: undoChangesDefinition,
    handler: undoChangesHandler,
  },
  spawn_subagent: {
    definition: spawnSubagentDefinition,
    handler: spawnSubagentHandler,
  },
  parallel_subagents: {
    definition: parallelSubagentsDefinition,
    handler: parallelSubagentsHandler,
  },
  ultraplinian_eval: {
    definition: ultraplinianRaceDefinition,
    handler: ultraplinianRaceHandler,
  },
}

export function getAllToolDefinitions(excludedTools: string[] = []): ToolDefinition[] {
  return Object.entries(registeredTools)
    .filter(([name, t]) => !excludedTools.includes(name) && t && t.definition)
    .map(([_, t]) => t.definition)
}

export async function dispatchToolCall(name: string, rawArgs: string | Record<string, any>): Promise<string> {
  const tool = registeredTools[name]
  if (!tool) {
    return `Error: Unknown tool "${name}". Available tools: ${Object.keys(registeredTools).join(', ')}`
  }

  let parsedArgs: any = rawArgs
  if (typeof rawArgs === 'string') {
    try {
      parsedArgs = JSON.parse(rawArgs)
    } catch (err: any) {
      return `Error: Failed to parse tool arguments as JSON: ${err.message}`
    }
  }

  return await tool.handler(parsedArgs)
}
