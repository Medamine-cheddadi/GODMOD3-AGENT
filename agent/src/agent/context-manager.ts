import { ChatMessage } from './types'

/**
 * Truncates very long tool outputs (e.g. large build logs, full files)
 * so they don't blow up the context window.
 */
export function truncateToolOutput(output: string, maxChars = 4000): string {
  if (!output || output.length <= maxChars) {
    return output
  }

  const headChars = Math.floor(maxChars * 0.55)
  const tailChars = Math.floor(maxChars * 0.35)
  const omitted = output.length - headChars - tailChars

  const head = output.slice(0, headChars)
  const tail = output.slice(output.length - tailChars)

  return `${head}\n\n... [⚠️ G0DM0D3 CONTEXT OPTIMIZER: ${omitted} characters omitted to save tokens & context] ...\n\n${tail}`
}

/**
 * Compacts conversation history when it exceeds the token/character budget or message count.
 *
 * Rules:
 * 1. Always preserves System Prompt (index 0).
 * 2. Always preserves original User Goal (index 1).
 * 3. Keeps the most recent N messages in full fidelity.
 * 4. Ensures tool_calls and tool responses are never decoupled.
 * 5. Prevents conversation from exceeding backend message limits.
 */
export function compactHistory(
  messages: ChatMessage[],
  maxTotalChars = 24000,
  maxTotalMessages = 16,
  recentKeepCount = 6
): ChatMessage[] {
  const totalChars = messages.reduce((acc, m) => {
    let len = m.content?.length || 0
    if (m.tool_calls) {
      len += JSON.stringify(m.tool_calls).length
    }
    return acc + len
  }, 0)

  // If well under budget for both characters and message count, keep everything
  if (totalChars <= maxTotalChars && messages.length <= maxTotalMessages) {
    return messages
  }

  const systemMessage = messages[0]?.role === 'system' ? messages[0] : null
  const startIndex = systemMessage ? 1 : 0
  const initialUserMessage = messages[startIndex]?.role === 'user' ? messages[startIndex] : null

  // Determine cutoff for recent messages
  let cutoff = Math.max(
    (systemMessage ? 1 : 0) + (initialUserMessage ? 1 : 0),
    messages.length - recentKeepCount
  )

  // Ensure cutoff does not split in the middle of a tool response
  while (cutoff > 1 && messages[cutoff]?.role === 'tool') {
    cutoff--
  }

  const compacted: ChatMessage[] = []
  if (systemMessage) compacted.push(systemMessage)
  if (initialUserMessage) compacted.push(initialUserMessage)

  const omittedCount = cutoff - compacted.length
  if (omittedCount > 0) {
    compacted.push({
      role: 'user',
      content: `[Context Compactor: ${omittedCount} earlier tool execution turns omitted to preserve context window. Focus on current workspace state and recent observations below.]`,
    })
  }

  for (let i = cutoff; i < messages.length; i++) {
    const msg = messages[i]
    if (msg.role === 'tool') {
      compacted.push({
        ...msg,
        content: truncateToolOutput(msg.content || '', 3000),
      })
    } else {
      compacted.push(msg)
    }
  }

  return compacted
}
