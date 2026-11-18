'use client'

import { useState } from 'react'
import { useStore } from '@/store'
import {
  Plus,
  MessageSquare,
  Trash2,
  Settings,
  ChevronLeft,
  ChevronRight,
  Zap,
  Skull,
  Terminal,
  Shield,
  Search,
  Code,
  Brain,
  Flame,
  BookOpen,
} from 'lucide-react'
import { PersonaSelector } from './PersonaSelector'
import { ModelSelector } from './ModelSelector'

interface SidebarProps {
  isOpen: boolean
  onToggle: () => void
}

export function Sidebar({ isOpen, onToggle }: SidebarProps) {
  const {
    conversations,
    currentConversationId,
    createConversation,
    addMessage,
    selectConversation,
    deleteConversation,
    setShowSettings,
    theme
  } = useStore()

  const [hoveredId, setHoveredId] = useState<string | null>(null)

  const handleNewChat = () => {
    createConversation()
  }

  return (
    <>
      {/* Toggle button when closed */}
      {!isOpen && (
        <button
          onClick={onToggle}
          className="fixed left-4 top-4 z-50 p-2 bg-theme-dim border border-theme-primary rounded-lg hover:glow-box transition-all"
          aria-label="Open sidebar"
        >
          <ChevronRight className="w-5 h-5 theme-primary" />
        </button>
      )}

      {/* Sidebar */}
      <aside
        className={`
          fixed md:relative z-40 h-screen
          bg-theme-dim border-r border-theme-primary
          transition-all duration-300 ease-in-out
          ${isOpen ? 'w-72' : 'w-0'}
          overflow-hidden
        `}
      >
        <div className="flex flex-col h-full w-72">
          {/* Header */}
          <div className="p-4 border-b border-theme-primary">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <span className="text-2xl relative -top-[2px]">🜏</span>
                <h1 className="text-xl font-bold theme-primary glitch glow-primary" data-text="G0DM0DƎ">
                  G0DM0<span className="flipped-e">D</span><span className="flipped-e-soft">E</span>
                </h1>
              </div>
              <button
                onClick={onToggle}
                className="p-1 hover:bg-theme-accent rounded transition-colors"
                aria-label="Close sidebar"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
            </div>

            {/* New Chat Button */}
            <button
              onClick={handleNewChat}
              className="w-full flex items-center justify-center gap-2 py-2 px-4
                border border-theme-primary rounded-lg
                hover:glow-box transition-all
                hacker-btn"
            >
              <Plus className="w-4 h-4" />
              <span>New Chat</span>
            </button>

            {/* Quick Specialist Agent Launch */}
            <div className="pt-3">
              <div className="text-[10px] font-mono theme-secondary uppercase tracking-wider mb-1.5 flex items-center justify-between">
                <span>Specialist Agents</span>
                <span className="text-cyan-400">/launch</span>
              </div>
              <div className="grid grid-cols-5 gap-1 text-center">
                <button
                  type="button"
                  onClick={() => {
                    const convId = createConversation()
                    addMessage(convId, {
                      role: 'assistant',
                      content: '### 🛡️ PENTEST AGENT READY\n\nEnter your target or vulnerability to audit below:\n\n*Example:* `/pentest audit upload endpoint for file bypass`',
                      model: 'system',
                    })
                  }}
                  title="Pentest Specialist Agent (/pentest)"
                  className="p-1.5 rounded-lg bg-red-950/20 border border-red-500/30 hover:border-red-500 text-red-400 flex flex-col items-center justify-center transition-all"
                >
                  <Shield className="w-3.5 h-3.5" />
                  <span className="text-[9px] font-mono mt-0.5">Pentest</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const convId = createConversation()
                    addMessage(convId, {
                      role: 'assistant',
                      content: '### 🔍 RESEARCH AGENT READY\n\nEnter your research objective or file to investigate below:\n\n*Example:* `/research inspect api/routes/chat.ts for security flaws`',
                      model: 'system',
                    })
                  }}
                  title="Research Specialist Agent (/research)"
                  className="p-1.5 rounded-lg bg-cyan-950/20 border border-cyan-500/30 hover:border-cyan-500 text-cyan-400 flex flex-col items-center justify-center transition-all"
                >
                  <Search className="w-3.5 h-3.5" />
                  <span className="text-[9px] font-mono mt-0.5">Audit</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const convId = createConversation()
                    addMessage(convId, {
                      role: 'assistant',
                      content: '### 💻 CODER AGENT READY\n\nEnter the code, feature, or tests you need to build:\n\n*Example:* `/code write a robust rate limiter with sliding window`',
                      model: 'system',
                    })
                  }}
                  title="Coding Specialist Agent (/code)"
                  className="p-1.5 rounded-lg bg-emerald-950/20 border border-emerald-500/30 hover:border-emerald-500 text-emerald-400 flex flex-col items-center justify-center transition-all"
                >
                  <Code className="w-3.5 h-3.5" />
                  <span className="text-[9px] font-mono mt-0.5">Code</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const convId = createConversation()
                    addMessage(convId, {
                      role: 'assistant',
                      content: '### 📐 PLANNER AGENT READY\n\nEnter your complex mission or architecture blueprint to plan:\n\n*Example:* `/plan architect migration to distributed microservices`',
                      model: 'system',
                    })
                  }}
                  title="Planner Specialist Agent (/plan)"
                  className="p-1.5 rounded-lg bg-purple-950/20 border border-purple-500/30 hover:border-purple-500 text-purple-400 flex flex-col items-center justify-center transition-all"
                >
                  <Brain className="w-3.5 h-3.5" />
                  <span className="text-[9px] font-mono mt-0.5">Plan</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const convId = createConversation()
                    addMessage(convId, {
                      role: 'assistant',
                      content: '### 🌋 ULTRAPLINIAN RACE READY\n\nEnter the challenge to race across multiple frontier models:\n\n*Example:* `/race what is the cleanest payload for DOM XSS in modern React?`',
                      model: 'system',
                    })
                  }}
                  title="ULTRAPLINIAN Multi-Model Race (/race)"
                  className="p-1.5 rounded-lg bg-orange-950/20 border border-orange-500/30 hover:border-orange-500 text-orange-400 flex flex-col items-center justify-center transition-all"
                >
                  <Flame className="w-3.5 h-3.5" />
                  <span className="text-[9px] font-mono mt-0.5">Race</span>
                </button>
              </div>
            </div>
          </div>

          {/* Model & Persona Selectors */}
          <div className="p-4 border-b border-theme-primary space-y-3">
            <ModelSelector />
            <PersonaSelector />
          </div>

          {/* Conversation List */}
          <div className="flex-1 overflow-y-auto p-2">
            {conversations.length === 0 ? (
              <div className="text-center py-8 theme-secondary text-sm">
                <Terminal className="w-8 h-8 mx-auto mb-2 opacity-50" />
                <p>No conversations yet</p>
                <p className="text-xs mt-1 opacity-70">Start a new chat to begin</p>
              </div>
            ) : (
              <div className="space-y-1">
                {conversations.map((conv) => (
                  <div
                    key={conv.id}
                    className={`
                      group flex items-center gap-2 p-2 rounded-lg cursor-pointer
                      transition-all duration-200
                      ${currentConversationId === conv.id
                        ? 'bg-theme-accent border border-theme-primary'
                        : 'hover:bg-theme-accent/50'
                      }
                    `}
                    onClick={() => selectConversation(conv.id)}
                    onMouseEnter={() => setHoveredId(conv.id)}
                    onMouseLeave={() => setHoveredId(null)}
                  >
                    <MessageSquare className="w-4 h-4 flex-shrink-0 theme-secondary" />
                    <span className="flex-1 truncate text-sm">
                      {conv.title}
                    </span>
                    {hoveredId === conv.id && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          deleteConversation(conv.id)
                        }}
                        className="p-1 hover:text-red-500 transition-colors"
                        aria-label="Delete conversation"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="p-4 border-t border-theme-primary">
            {/* Easter egg hints */}
            <div className="text-xs theme-secondary mb-3 text-center opacity-50">
              <span className="cursor-help" title="Try the Konami code...">
                ⌘ ↑↑↓↓←→←→BA
              </span>
            </div>

            <button
              onClick={() => setShowSettings(true)}
              className="w-full flex items-center justify-center gap-2 py-2 px-4
                border border-theme-primary rounded-lg
                hover:glow-box transition-all text-sm"
            >
              <Settings className="w-4 h-4" />
              <span>Settings</span>
            </button>

            {/* Credits */}
            <div className="mt-4 text-center">
              <p className="text-xs theme-secondary opacity-70">
                AGPL-3.0 | Forever Free
              </p>
              <p className="text-xs theme-secondary opacity-50 mt-1">
                Cognition without control
              </p>
            </div>
          </div>
        </div>
      </aside>
    </>
  )
}
