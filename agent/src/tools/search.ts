import fs from 'fs'
import path from 'path'
import { ToolDefinition, ToolHandler } from '../agent/types'

export const webSearchDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'web_search',
    description: 'Search the web using DuckDuckGo to find documentation, code examples, or research information.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The search query to look up.',
        },
      },
      required: ['query'],
    },
  },
}

export const webSearchHandler: ToolHandler = async (args: { query: string }) => {
  try {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(args.query)}`
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    })
    if (!res.ok) {
      return `Search failed with status ${res.status}`
    }
    const html = await res.text()

    const titleRegex = /<a class="result__snippet[^>]*>([\s\S]*?)<\/a>/g
    const snippets: string[] = []
    let match
    while ((match = titleRegex.exec(html)) !== null && snippets.length < 5) {
      snippets.push(match[1].replace(/<[^>]+>/g, '').trim())
    }

    if (snippets.length === 0) {
      return `No direct search snippets found for "${args.query}".`
    }

    return `Search Results for "${args.query}":\n\n` + snippets.map((s, i) => `[Result ${i + 1}]\n${s}`).join('\n\n')
  } catch (err: any) {
    return `Web search error: ${err.message}`
  }
}

export const searchFilesDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'search_files',
    description: 'Search the workspace for files matching a filename pattern or containing specific text.',
    parameters: {
      type: 'object',
      properties: {
        pattern: {
          type: 'string',
          description: 'Filename pattern or substring to match (e.g. "SKILL.md", "*.ts", "sqli")',
        },
        content_query: {
          type: 'string',
          description: 'Optional text string to search for inside file contents (like grep)',
        },
        directory: {
          type: 'string',
          description: 'Root directory to start searching from (default: ".")',
        },
        max_results: {
          type: 'number',
          description: 'Maximum matching files to return (default: 20)',
        },
      },
      required: ['pattern'],
    },
  },
}

export const searchFilesHandler: ToolHandler = async (args: {
  pattern: string
  content_query?: string
  directory?: string
  max_results?: number
}) => {
  const root = path.resolve(process.cwd(), args.directory || '.')
  const maxResults = args.max_results || 20
  const pattern = args.pattern.toLowerCase()
  const contentQuery = args.content_query

  if (!fs.existsSync(root)) {
    return `Error: Directory "${root}" does not exist.`
  }

  const results: Array<{ path: string; matchLine?: string }> = []
  const ignoreDirs = new Set(['node_modules', '.git', '.next', 'dist', 'out', '.godmod3'])

  function walk(currentDir: string) {
    if (results.length >= maxResults) return

    let entries: fs.Dirent[] = []
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true })
    } catch {
      return
    }

    for (const entry of entries) {
      if (results.length >= maxResults) break

      const fullPath = path.join(currentDir, entry.name)
      const relPath = path.relative(process.cwd(), fullPath)

      if (entry.isDirectory()) {
        if (!ignoreDirs.has(entry.name)) {
          walk(fullPath)
        }
      } else if (entry.isFile()) {
        const lowerName = entry.name.toLowerCase()
        const lowerRel = relPath.toLowerCase()
        let nameMatches = pattern === '*' || lowerName.includes(pattern) || lowerRel.includes(pattern)
        if (!nameMatches && pattern.startsWith('*.')) {
          nameMatches = lowerName.endsWith(pattern.slice(1))
        } else if (!nameMatches && pattern.startsWith('.')) {
          nameMatches = lowerName.endsWith(pattern)
        }

        if (nameMatches) {
          if (contentQuery) {
            try {
              const fileContent = fs.readFileSync(fullPath, 'utf-8')
              const lines = fileContent.split('\n')
              const matchingLine = lines.find(l => l.includes(contentQuery))
              if (matchingLine) {
                results.push({
                  path: relPath,
                  matchLine: matchingLine.trim().slice(0, 120),
                })
              }
            } catch {}
          } else {
            results.push({ path: relPath })
          }
        }
      }
    }
  }

  walk(root)

  if (results.length === 0) {
    return `No files found matching pattern "${args.pattern}"${contentQuery ? ` with content "${contentQuery}"` : ''}.`
  }

  const lines = results.map(
    r => `  • ${r.path}${r.matchLine ? ` (Matches: "${r.matchLine}")` : ''}`
  )

  return `Found ${results.length} matching file(s):\n${lines.join('\n')}`
}
