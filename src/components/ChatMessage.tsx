'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { Message, useStore } from '@/store'
import {
  Copy,
  Check,
  User,
  ThumbsUp,
  ThumbsDown,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  Brain,
  Terminal,
  Wrench,
} from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { atomDark } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { getContextLabel, PARAM_META } from '@/lib/autotune'

interface ParsedMessage {
  thinking: string | null
  isThinkingActive: boolean
  tools: Array<{
    name: string
    args?: string
    output?: string
  }>
  cleanContent: string
}

function parseMessageContent(raw: string, directReasoning?: string): ParsedMessage {
  let content = raw || ''
  let thinking: string | null = directReasoning || null
  let isThinkingActive = false

  // 1. Extract <thinking>, <thought>, <reasoning>
  const thinkingMatch = /<(thinking|thought|reasoning)>([\s\S]*?)(?:<\/\1>|$)/i.exec(content)
  if (thinkingMatch) {
    thinking = (thinking ? `${thinking}\n\n` : '') + thinkingMatch[2].trim()
    isThinkingActive = !content.includes(`</${thinkingMatch[1]}>`)
    content = content.replace(thinkingMatch[0], '').trim()
  }

  // 2. Extract tool call & result patterns
  const tools: Array<{ name: string; args?: string; output?: string }> = []

  // Match <tool_call ...> and <tool_result ...>
  const toolXmlRegex = /<tool_call(?:\s+name=["']([^"']+)["'])?>([\s\S]*?)<\/tool_call>(?:\s*<tool_result>([\s\S]*?)<\/tool_result>)?/gi
  content = content.replace(toolXmlRegex, (_, name, body, result) => {
    tools.push({
      name: name || 'tool_call',
      args: body?.trim(),
      output: result?.trim(),
    })
    return ''
  })

  // Match CLI / Agent execution patterns:
  // "▶ Executing: tool_name\n    Args: {...}\n  ✔ Result: ..."
  const cliToolRegex = /[▶►]\s*Executing:\s*([^\n]+)(?:\n\s*Args:\s*([^\n]+))?(?:\n\s*[✔✓]\s*Result:\s*([\s\S]*?)(?=(?:\n[▶►]\s*Executing:|\n\n[A-Z]|$)))?/gi
  content = content.replace(cliToolRegex, (_, name, args, output) => {
    tools.push({
      name: name.trim(),
      args: args?.trim(),
      output: output?.trim(),
    })
    return ''
  })

  return {
    thinking,
    isThinkingActive,
    tools,
    cleanContent: content.trim(),
  }
}

interface ChatMessageProps {
  message: Message
}

export function ChatMessage({ message }: ChatMessageProps) {
  const { personas, currentConversation, rateMessage, autoTuneEnabled, showMagic } = useStore()
  const [copied, setCopied] = useState(false)
  const [showTuneDetails, setShowTuneDetails] = useState(false)
  const [isLiquidMorphing, setIsLiquidMorphing] = useState(false)
  const prevContentRef = useRef(message.content)

  // Race response navigator state (0 = winner/default, 1..N = other responses)
  const [raceIndex, setRaceIndex] = useState(0)
  const raceNavRef = useRef<HTMLDivElement>(null)
  const raceResponses = message.raceResponses
  const hasRaceNav = raceResponses && raceResponses.length > 1
  const activeResponse = showMagic && hasRaceNav ? raceResponses[raceIndex] : null
  const displayContent = activeResponse ? activeResponse.content : message.content
  const displayModel = activeResponse ? activeResponse.model : message.model

  // Arrow key navigation for race responses
  const navigateRace = useCallback((direction: 'left' | 'right') => {
    if (!raceResponses || raceResponses.length <= 1) return
    setIsLiquidMorphing(true)
    setTimeout(() => setIsLiquidMorphing(false), 600)
    if (direction === 'left') {
      setRaceIndex(i => Math.max(0, i - 1))
    } else {
      setRaceIndex(i => Math.min(raceResponses.length - 1, i + 1))
    }
  }, [raceResponses])

  const handleRaceKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowLeft') {
      e.preventDefault()
      navigateRace('left')
    } else if (e.key === 'ArrowRight') {
      e.preventDefault()
      navigateRace('right')
    }
  }, [navigateRace])

  // Auto-focus the race navigator when race responses first arrive
  useEffect(() => {
    if (hasRaceNav && raceNavRef.current) {
      raceNavRef.current.focus()
    }
  }, [hasRaceNav])

  // Detect content changes for liquid animation (ULTRAPLINIAN leader upgrades)
  useEffect(() => {
    if (prevContentRef.current !== message.content && prevContentRef.current !== '' && message.content !== '') {
      setIsLiquidMorphing(true)
      const timer = setTimeout(() => setIsLiquidMorphing(false), 600)
      prevContentRef.current = message.content
      return () => clearTimeout(timer)
    }
    prevContentRef.current = message.content
  }, [message.content])

  const isUser = message.role === 'user'
  const persona = !isUser
    ? personas.find(p => p.id === (message.persona || currentConversation?.persona)) || personas[0]
    : null

  // Detect Agent badge
  let agentBadge: { label: string; color: string } | null = null
  let displayBody = displayContent

  if (isUser) {
    if (displayContent.startsWith('🛡️ [PENTEST AGENT]')) {
      agentBadge = { label: '🛡️ PENTEST SPECIALIST AGENT', color: 'bg-red-500/20 text-red-300 border-red-500/40' }
      displayBody = displayContent.replace('🛡️ [PENTEST AGENT]', '').trim()
    } else if (displayContent.startsWith('🔍 [RESEARCH AGENT]')) {
      agentBadge = { label: '🔍 RESEARCH SPECIALIST AGENT', color: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40' }
      displayBody = displayContent.replace('🔍 [RESEARCH AGENT]', '').trim()
    } else if (displayContent.startsWith('💻 [CODER AGENT]')) {
      agentBadge = { label: '💻 CODING SPECIALIST AGENT', color: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40' }
      displayBody = displayContent.replace('💻 [CODER AGENT]', '').trim()
    } else if (displayContent.startsWith('📐 [PLANNER AGENT]')) {
      agentBadge = { label: '📐 STRATEGIC PLANNER AGENT', color: 'bg-purple-500/20 text-purple-300 border-purple-500/40' }
      displayBody = displayContent.replace('📐 [PLANNER AGENT]', '').trim()
    } else if (displayContent.startsWith('🌋 [ULTRAPLINIAN RACE]')) {
      agentBadge = { label: '🌋 ULTRAPLINIAN CONSENSUS RACE', color: 'bg-orange-500/20 text-orange-300 border-orange-500/40' }
      displayBody = displayContent.replace('🌋 [ULTRAPLINIAN RACE]', '').trim()
    }
  }

  // Parse thinking process and tool actions for assistant messages
  const parsed = !isUser
    ? parseMessageContent(displayBody, (message as any).reasoning)
    : { thinking: null, isThinkingActive: false, tools: [], cleanContent: displayBody }

  const handleCopy = async () => {
    await navigator.clipboard.writeText(message.content)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div
      className={`
        flex gap-4 message-enter
        ${isUser ? 'flex-row-reverse' : 'flex-row'}
      `}
    >
      {/* Avatar */}
      <div
        className={`
          flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center
          ${isUser ? 'bg-theme-accent border border-theme-primary' : ''}
        `}
        style={!isUser ? { backgroundColor: persona?.color + '20' } : {}}
      >
        {isUser ? (
          <User className="w-5 h-5" />
        ) : (
          <span className="text-xl">{persona?.emoji}</span>
        )}
      </div>

      {/* Message content */}
      <div
        className={`
          flex-1 max-w-[85%] p-4 rounded-lg
          ${isUser
            ? 'bg-theme-accent border border-theme-primary'
            : 'bg-theme-dim border border-theme-primary/30'
          }
        `}
      >
        {/* Agent badge if applicable */}
        {agentBadge && (
          <div className="mb-2">
            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-mono font-bold border ${agentBadge.color}`}>
              {agentBadge.label}
            </span>
          </div>
        )}

        {/* Header */}
        <div className="flex items-center justify-between mb-2 text-xs theme-secondary">
          <span className="font-semibold">
            {isUser ? 'You' : persona?.name}
          </span>
          <div className="flex items-center gap-2">
            <span>
              {new Date(message.timestamp).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit'
              })}
            </span>
            <button
              onClick={handleCopy}
              className="p-1 hover:theme-primary transition-colors"
              aria-label="Copy message"
            >
              {copied ? (
                <Check className="w-3 h-3 text-green-500" />
              ) : (
                <Copy className="w-3 h-3" />
              )}
            </button>
          </div>
        </div>

        {/* Collapsible Thinking Process */}
        {parsed.thinking && (
          <CollapsibleThinking
            thinking={parsed.thinking}
            isThinkingActive={parsed.isThinkingActive}
          />
        )}

        {/* Collapsible Tool Actions & Monitoring */}
        {parsed.tools.length > 0 && (
          <CollapsibleToolActions tools={parsed.tools} />
        )}

        {/* Content */}
        {parsed.cleanContent && (
          <div className={`prose prose-invert max-w-none text-sm ${isLiquidMorphing ? 'liquid-morph' : ''}`}>
            <ReactMarkdown
              components={{
                code({ node, className, children, ...props }) {
                  const match = /language-(\w+)/.exec(className || '')
                  const inline = !match
                  const codeString = String(children).replace(/\n$/, '')

                  return !inline ? (
                    <CodeBlock language={match?.[1] || 'text'} code={codeString} />
                  ) : (
                    <code
                      className="px-1.5 py-0.5 rounded text-xs font-mono bg-cyan-950/40 text-cyan-300 border border-cyan-500/20"
                      {...props}
                    >
                      {children}
                    </code>
                  )
                },
                p({ children }) {
                  return <p className="mb-3 last:mb-0 leading-relaxed">{children}</p>
                },
                ul({ children }) {
                  return <ul className="list-disc pl-4 mb-3 space-y-1">{children}</ul>
                },
                ol({ children }) {
                  return <ol className="list-decimal pl-4 mb-3 space-y-1">{children}</ol>
                },
                a({ href, children }) {
                  return (
                    <a
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="theme-primary underline hover:glow-primary"
                    >
                      {children}
                    </a>
                  )
                },
                blockquote({ children }) {
                  return (
                    <blockquote className="border-l-2 border-theme-primary pl-4 italic opacity-80">
                      {children}
                    </blockquote>
                  )
                }
              }}
            >
              {parsed.cleanContent}
            </ReactMarkdown>
          </div>
        )}

        {/* Race response navigator — click to focus, then use ←/→ arrow keys */}
        {showMagic && hasRaceNav && !isUser && (
          <div
            ref={raceNavRef}
            tabIndex={0}
            onKeyDown={handleRaceKeyDown}
            className="mt-2 flex items-center gap-2 text-xs font-mono race-navigator
              rounded px-1 py-0.5 outline-none
              focus:ring-1 focus:ring-theme-primary/60 focus:bg-theme-primary/5
              cursor-pointer transition-all"
            aria-label={`Response navigator: ${raceIndex + 1} of ${raceResponses.length}. Use left and right arrow keys to browse.`}
            role="toolbar"
          >
            <button
              onClick={() => navigateRace('left')}
              disabled={raceIndex === 0}
              className="p-0.5 rounded border border-theme-primary/40 hover:border-theme-primary hover:glow-box
                transition-all disabled:opacity-20 disabled:cursor-not-allowed"
              aria-label="Previous response"
              tabIndex={-1}
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
            <span className="theme-secondary select-none">
              <span className="theme-primary font-bold">{raceIndex + 1}</span>
              <span className="opacity-50"> / </span>
              <span>{raceResponses.length}</span>
            </span>
            <button
              onClick={() => navigateRace('right')}
              disabled={raceIndex === raceResponses.length - 1}
              className="p-0.5 rounded border border-theme-primary/40 hover:border-theme-primary hover:glow-box
                transition-all disabled:opacity-20 disabled:cursor-not-allowed"
              aria-label="Next response"
              tabIndex={-1}
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
            {activeResponse && (
              <span className="ml-1 opacity-60">
                {activeResponse.model.split('/').pop()}
                <span className="ml-1 text-[10px]">
                  ({activeResponse.score}pts)
                </span>
                {activeResponse.isWinner && (
                  <span className="ml-1 theme-primary">&#x2726;</span>
                )}
              </span>
            )}
            <span className="ml-auto text-[9px] theme-secondary select-none arrow-hint">
              ← →
            </span>
          </div>
        )}

        {/* Model tag and feedback buttons for assistant messages */}
        {showMagic && !isUser && (
          <div className="mt-3 pt-2 border-t border-theme-primary/20 text-xs theme-secondary">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1">
                {displayModel && (
                  <>
                    <span className="text-[10px] opacity-60">&#x2726;</span>
                    <span>{displayModel.split('/').pop()}</span>
                  </>
                )}
              </div>

              {/* Feedback rating buttons */}
              {autoTuneEnabled && currentConversation && (
                <div className="flex items-center gap-1">
                  {message.autoTuneContext && (
                    <button
                      onClick={() => setShowTuneDetails(!showTuneDetails)}
                      className="text-[10px] font-mono theme-secondary mr-2 opacity-60 hover:opacity-100 hover:text-cyan-400 transition-all flex items-center gap-0.5"
                      title="Click to view AutoTune details"
                    >
                      {getContextLabel(message.autoTuneContext)}
                      {showTuneDetails ? <ChevronUp className="w-2.5 h-2.5" /> : <ChevronDown className="w-2.5 h-2.5" />}
                    </button>
                  )}
                  <button
                    onClick={() => rateMessage(currentConversation.id, message.id, 1)}
                    className={`p-1 rounded transition-all ${
                      message.feedbackRating === 1
                        ? 'text-green-400 bg-green-400/15'
                        : 'hover:text-green-400 hover:bg-green-400/10'
                    }`}
                    aria-label="Good response"
                    title="Good response — AutoTune learns from this"
                  >
                    <ThumbsUp className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => rateMessage(currentConversation.id, message.id, -1)}
                    className={`p-1 rounded transition-all ${
                      message.feedbackRating === -1
                        ? 'text-red-400 bg-red-400/15'
                        : 'hover:text-red-400 hover:bg-red-400/10'
                    }`}
                    aria-label="Bad response"
                    title="Bad response — AutoTune learns to avoid these params"
                  >
                    <ThumbsDown className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>

            {/* Expandable AutoTune Transparency Panel */}
            {showTuneDetails && message.autoTuneContext && (
              <div className="mt-2 p-2 bg-theme-dim rounded border border-theme-primary/30 space-y-2">
                {/* Context Competition */}
                {message.autoTuneContextScores && message.autoTuneContextScores.length > 1 && (
                  <div className="flex items-center gap-1 text-[10px] font-mono flex-wrap">
                    <span className="theme-secondary">CONTEXT:</span>
                    {message.autoTuneContextScores
                      .filter(s => s.percentage > 0)
                      .slice(0, 4)
                      .map((s, i) => (
                        <span key={s.type} className="flex items-center">
                          {i > 0 && <span className="text-gray-600 mx-0.5">&gt;</span>}
                          <span className={i === 0 ? 'text-cyan-400 font-bold' : 'theme-secondary'}>
                            {getContextLabel(s.type)} {s.percentage}%
                          </span>
                        </span>
                      ))}
                  </div>
                )}

                {/* Pattern Matches */}
                {message.autoTunePatternMatches && message.autoTunePatternMatches.length > 0 && (
                  <div className="text-[10px] font-mono">
                    <span className="theme-secondary">MATCHED: </span>
                    <span className="text-purple-400">
                      {message.autoTunePatternMatches
                        .slice(0, 3)
                        .map(p => p.pattern)
                        .join(' | ')}
                    </span>
                  </div>
                )}

                {/* Parameter Values with Deltas */}
                {message.autoTuneParams && (
                  <div className="grid grid-cols-6 gap-1">
                    {(Object.entries(message.autoTuneParams) as [keyof typeof PARAM_META, number][]).map(
                      ([key, value]) => {
                        const delta = message.autoTuneDeltas?.find(d => d.param === key)
                        const hasDelta = delta && Math.abs(delta.delta) > 0.001

                        return (
                          <div
                            key={key}
                            className={`text-center p-1 rounded text-[9px] ${
                              hasDelta ? 'bg-cyan-500/10' : 'bg-theme-bg'
                            }`}
                            title={delta?.reason}
                          >
                            <div className="theme-secondary font-mono">{PARAM_META[key].short}</div>
                            <div className="font-bold theme-primary font-mono">{value.toFixed(2)}</div>
                            {hasDelta && (
                              <div className={`font-mono ${delta.delta > 0 ? 'text-green-400' : 'text-red-400'}`}>
                                {delta.delta > 0 ? '+' : ''}{delta.delta.toFixed(2)}
                              </div>
                            )}
                          </div>
                        )
                      }
                    )}
                  </div>
                )}

                {/* Delta Reasons */}
                {message.autoTuneDeltas && message.autoTuneDeltas.length > 0 && (
                  <div className="text-[9px] font-mono theme-secondary">
                    {message.autoTuneDeltas.slice(0, 3).map((d, i) => (
                      <span key={`${d.param}-${i}`} className="mr-2">
                        <span className="text-cyan-400">{PARAM_META[d.param].short}</span>
                        <span className="text-purple-400"> {d.reason}</span>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function CollapsibleThinking({ thinking, isThinkingActive }: { thinking: string; isThinkingActive: boolean }) {
  const [isOpen, setIsOpen] = useState(isThinkingActive)
  const wordCount = thinking.trim().split(/\s+/).filter(Boolean).length

  return (
    <div className="my-2.5 rounded-lg border border-purple-500/30 bg-purple-950/20 shadow-md overflow-hidden transition-all duration-200">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between px-3.5 py-2 text-xs font-mono font-medium text-purple-300 hover:bg-purple-900/20 transition-colors"
        title="Toggle Thought Process"
      >
        <span className="flex items-center gap-2">
          <Brain className={`w-4 h-4 text-purple-400 ${isThinkingActive ? 'animate-pulse' : ''}`} />
          <span className="font-semibold text-purple-200">
            {isThinkingActive ? 'Thinking Process...' : 'Thought Process'}
          </span>
          <span className="text-[11px] text-purple-400/70 font-normal">
            ({isThinkingActive ? 'in progress' : `${wordCount} words`})
          </span>
        </span>
        <div className="flex items-center gap-1.5 text-purple-400">
          <span className="text-[10px] uppercase font-bold tracking-wider">{isOpen ? 'Hide' : 'Inspect'}</span>
          {isOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </div>
      </button>

      {isOpen && (
        <div className="px-4 py-3 bg-black/50 border-t border-purple-500/20 text-xs font-mono text-purple-200/90 whitespace-pre-wrap leading-relaxed max-h-96 overflow-y-auto selection:bg-purple-500/30">
          {thinking}
        </div>
      )}
    </div>
  )
}

function CollapsibleToolActions({ tools }: { tools: Array<{ name: string; args?: string; output?: string }> }) {
  const [isOpen, setIsOpen] = useState(false)
  const [openToolIndex, setOpenToolIndex] = useState<number | null>(null)

  if (tools.length === 0) return null

  return (
    <div className="my-2.5 rounded-lg border border-cyan-500/30 bg-cyan-950/20 shadow-md overflow-hidden transition-all duration-200">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between px-3.5 py-2 text-xs font-mono font-medium text-cyan-300 hover:bg-cyan-900/20 transition-colors"
        title="Toggle Tool Actions"
      >
        <span className="flex items-center gap-2">
          <Terminal className="w-4 h-4 text-cyan-400" />
          <span className="font-semibold text-cyan-200">
            Tool Monitoring
          </span>
          <span className="px-1.5 py-0.5 rounded text-[10px] bg-cyan-500/20 border border-cyan-500/40 text-cyan-300 font-bold">
            {tools.length} {tools.length === 1 ? 'call' : 'calls'}
          </span>
          <span className="text-[11px] text-gray-400 hidden sm:inline">
            ({tools.map(t => t.name).slice(0, 3).join(', ')}{tools.length > 3 ? ` +${tools.length - 3}` : ''})
          </span>
        </span>
        <div className="flex items-center gap-1.5 text-cyan-400">
          <span className="text-[10px] uppercase font-bold tracking-wider">{isOpen ? 'Hide' : 'Monitor'}</span>
          {isOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </div>
      </button>

      {isOpen && (
        <div className="p-3 bg-black/60 border-t border-cyan-500/20 space-y-2 max-h-96 overflow-y-auto font-mono text-xs">
          {tools.map((t, idx) => {
            const isToolExpanded = openToolIndex === idx || (openToolIndex === null && tools.length === 1)
            return (
              <div key={idx} className="rounded border border-cyan-500/20 bg-cyan-950/30 overflow-hidden">
                <button
                  type="button"
                  onClick={() => setOpenToolIndex(openToolIndex === idx ? -1 : idx)}
                  className="w-full flex items-center justify-between px-3 py-1.5 bg-cyan-950/50 hover:bg-cyan-900/40 text-left transition-colors"
                >
                  <span className="flex items-center gap-2 text-cyan-300 font-bold">
                    <Wrench className="w-3.5 h-3.5 text-cyan-400" />
                    <span>{t.name}</span>
                  </span>
                  <div className="flex items-center gap-2 text-[11px] text-gray-400">
                    <span className="text-emerald-400">✔ executed</span>
                    {isToolExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                  </div>
                </button>

                {isToolExpanded && (
                  <div className="p-2.5 space-y-2 border-t border-cyan-500/10 bg-black/40 text-[11px]">
                    {t.args && (
                      <div>
                        <div className="text-[10px] uppercase font-bold text-gray-400 mb-0.5">Parameters:</div>
                        <pre className="p-1.5 rounded bg-black/60 text-cyan-200 overflow-x-auto whitespace-pre-wrap">
                          {t.args}
                        </pre>
                      </div>
                    )}
                    {t.output && (
                      <div>
                        <div className="text-[10px] uppercase font-bold text-gray-400 mb-0.5">Execution Output:</div>
                        <pre className="p-1.5 rounded bg-black/80 text-emerald-300 overflow-x-auto whitespace-pre-wrap max-h-48">
                          {t.output}
                        </pre>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function CodeBlock({ language, code }: { language: string; code: string }) {
  const [copied, setCopied] = useState(false)
  const isToolOutput = ['tool', 'tool-output', 'bash-output', 'output', 'terminal'].includes(language.toLowerCase())
  const lineCount = code.split('\n').length
  const isLong = lineCount > 18
  const [isCollapsed, setIsCollapsed] = useState(isToolOutput && isLong)

  const handleCopyCode = async () => {
    await navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className={`relative group my-3 rounded-lg overflow-hidden border shadow-lg transition-all ${
      isToolOutput ? 'border-cyan-500/40 bg-black/80' : 'border-theme-primary/30 bg-theme-bg'
    }`}>
      <div className="flex items-center justify-between px-3.5 py-1.5 bg-theme-dim/90 border-b border-theme-primary/20 text-xs font-mono">
        <div className="flex items-center gap-2">
          {isToolOutput && <Terminal className="w-3.5 h-3.5 text-cyan-400" />}
          <span className="text-cyan-400 font-semibold uppercase tracking-wider">{language}</span>
          <span className="text-[10px] text-gray-400">({lineCount} {lineCount === 1 ? 'line' : 'lines'})</span>
        </div>
        <div className="flex items-center gap-2">
          {isLong && (
            <button
              type="button"
              onClick={() => setIsCollapsed(!isCollapsed)}
              className="flex items-center gap-1 text-[11px] text-gray-400 hover:text-cyan-300 transition-colors"
            >
              {isCollapsed ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
              <span>{isCollapsed ? 'Expand' : 'Collapse'}</span>
            </button>
          )}
          <button
            onClick={handleCopyCode}
            className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-theme-bg/60 border border-theme-primary/20 hover:border-cyan-400/50 text-[11px] text-gray-300 hover:text-cyan-300 transition-all"
            aria-label="Copy code block"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copied ? 'Copied!' : 'Copy Code'}</span>
          </button>
        </div>
      </div>
      {!isCollapsed && (
        <SyntaxHighlighter
          style={atomDark}
          language={language}
          PreTag="div"
          customStyle={{
            margin: 0,
            background: 'transparent',
            fontSize: '0.85rem',
            padding: '0.85rem',
            lineHeight: '1.45',
            maxHeight: isToolOutput ? '320px' : 'none',
          }}
        >
          {code}
        </SyntaxHighlighter>
      )}
      {isCollapsed && (
        <div
          onClick={() => setIsCollapsed(false)}
          className="px-4 py-2 text-xs font-mono text-cyan-400/70 hover:text-cyan-300 cursor-pointer bg-black/40 hover:bg-black/60 transition-colors"
        >
          {code.slice(0, 120).replace(/\n/g, ' ')}... <span className="underline ml-1">(click to expand {lineCount} lines)</span>
        </div>
      )}
    </div>
  )
}
