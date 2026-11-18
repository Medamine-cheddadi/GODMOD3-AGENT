import { ToolDefinition, ToolHandler } from '../agent/types'

export const fetchWebPageDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'fetch_web_page',
    description: 'Fetch the text/markdown content of a web page URL (documentation, GitHub raw files, security advisories, articles).',
    parameters: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'The HTTP or HTTPS URL of the web page to fetch.',
        },
        max_length: {
          type: 'number',
          description: 'Maximum characters of text to return (default: 8000).',
        },
      },
      required: ['url'],
    },
  },
}

export const fetchWebPageHandler: ToolHandler = async (args: { url: string; max_length?: number }) => {
  const { url, max_length = 8000 } = args

  if (!url || (!url.startsWith('http://') && !url.startsWith('https://'))) {
    return 'Error: URL must begin with http:// or https://'
  }

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.7',
      },
      signal: AbortSignal.timeout(15000),
    })

    if (!res.ok) {
      return `Failed to fetch URL: HTTP ${res.status} ${res.statusText}`
    }

    const contentType = res.headers.get('content-type') || ''
    const raw = await res.text()

    if (contentType.includes('application/json') || url.endsWith('.json')) {
      const truncated = raw.length > max_length ? raw.slice(0, max_length) + '\n... [truncated]' : raw
      return `[JSON Response from ${url}]\n${truncated}`
    }

    // Clean HTML to readable text / markdown
    let clean = raw
      // Remove scripts and styles
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
      // Replace headers
      .replace(/<h[1-6][^>]*>(.*?)<\/h[1-6]>/gi, '\n### $1\n')
      // Replace links
      .replace(/<a\b[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi, '$2 ($1)')
      // Replace code blocks
      .replace(/<pre[^>]*><code[^>]*>([\s\S]*?)<\/code><\/pre>/gi, '\n```\n$1\n```\n')
      // Replace paragraphs & breaks
      .replace(/<br\s*[\/]?>/gi, '\n')
      .replace(/<p[^>]*>/gi, '\n\n')
      // Remove all remaining tags
      .replace(/<[^>]+>/g, '')
      // Decode HTML entities
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, ' ')
      // Clean extra blank lines
      .replace(/\n\s*\n\s*\n/g, '\n\n')
      .trim()

    if (clean.length > max_length) {
      clean = clean.slice(0, max_length) + `\n\n... [Omitted remaining characters; total: ${clean.length}]`
    }

    return `[Content from ${url}]\n\n${clean}`
  } catch (err: any) {
    return `Error fetching web page "${url}": ${err.message}`
  }
}
