'use client'

import { useStore } from '@/store'
import {
  Key,
  Terminal,
  Shield,
  Search,
  Code,
  Brain,
  Flame,
  BookOpen,
  ArrowRight,
  Sparkles,
} from 'lucide-react'

interface WelcomeScreenProps {
  onOpenSettings: () => void
}

export function WelcomeScreen({ onOpenSettings }: WelcomeScreenProps) {
  const { apiKey, ultraplinianApiUrl, ultraplinianApiKey, createConversation, addMessage, theme } = useStore()

  // Proxy mode: API server available, no personal key needed
  const proxyMode = !apiKey && !!ultraplinianApiUrl && !!ultraplinianApiKey

  const handleStart = () => {
    if (apiKey || proxyMode) {
      createConversation()
    } else {
      onOpenSettings()
    }
  }

  const handleLaunchAgent = (commandPrefix: string, placeholderPrompt: string) => {
    if (!apiKey && !proxyMode) {
      onOpenSettings()
      return
    }
    const convId = createConversation()
    addMessage(convId, {
      role: 'assistant',
      content: `### 🤖 ${commandPrefix.replace('/', '').toUpperCase()} AGENT READY\n\nEnter your objective after \`${commandPrefix}\` or type your goal directly below:\n\n*Example:* \`${commandPrefix} ${placeholderPrompt}\``,
      model: 'system',
    })
  }

  return (
    <div className="flex-1 flex flex-col items-center justify-center p-6 md:p-8 relative overflow-y-auto">
      {/* Background effects */}
      {theme === 'matrix' && (
        <div className="absolute inset-0 opacity-10 pointer-events-none">
          <div className="matrix-rain-bg" />
        </div>
      )}

      {/* Hero Badge */}
      <div className="flex items-center gap-2 px-3 py-1 mb-3 rounded-full bg-theme-dim border border-cyan-500/30 text-xs font-mono text-cyan-400">
        <Sparkles className="w-3.5 h-3.5 text-cyan-400 animate-pulse" />
        <span>AUTONOMOUS REACT ENGINE // 41+ PENTEST SKILLS UNIFIED</span>
      </div>

      {/* ASCII Art Logo (desktop) */}
      <pre className="ascii-art text-center mb-1 hidden md:block">
{`
 ██████╗  ██████╗ ██████╗ ███╗   ███╗ ██████╗ ██████╗ ███████╗
██╔════╝ ██╔═══██╗██╔══██╗████╗ ████║██╔═══██╗██╔══██╗╚════██║
██║  ███╗██║   ██║██║  ██║██╔████╔██║██║   ██║██║  ██║ █████╔╝
██║   ██║██║   ██║██║  ██║██║╚██╔╝██║██║   ██║██║  ██║╔════██║
╚██████╔╝╚██████╔╝██████╔╝██║ ╚═╝ ██║╚██████╔╝██████╔╝███████╝
 ╚═════╝  ╚═════╝ ╚═════╝ ╚═╝     ╚═╝ ╚═════╝ ╚═════╝ ╚══════╝
`}
      </pre>

      <div className="flex items-center gap-2 mb-3">
        <span className="text-2xl relative -top-[2px]">🜏</span>
        <h1 className="text-xl font-bold theme-primary glitch glow-primary" data-text="G0DM0DƎ">
          G0DM0<span className="flipped-e">D</span><span className="flipped-e-soft">E</span>
          <span className="text-xs ml-2 px-2 py-0.5 rounded bg-cyan-500/20 text-cyan-300 font-mono border border-cyan-500/40">v1.1 AGENTIC</span>
        </h1>
      </div>

      {/* Tagline */}
      <p className="text-sm md:text-base theme-secondary mb-6 text-center max-w-xl">
        Liberated cognition without control. ReAct autonomous tool engine, specialist subagents, and consensus racing.
      </p>

      {/* Specialist Agent Quick Launch Cards */}
      <div className="w-full max-w-3xl mb-6">
        <div className="text-xs font-mono theme-secondary uppercase tracking-wider mb-2.5 flex items-center justify-between">
          <span>Specialist Agent Personas</span>
          <span className="text-gray-400 text-[11px]">Type / in chat for menu</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
          <AgentActionCard
            icon={<Shield className="w-5 h-5 text-red-400" />}
            role="Pentest Agent"
            cmd="/pentest"
            desc="Offensive auditing, exact exploit payloads & WAF bypass logic"
            accent="border-red-500/30 hover:border-red-500/60 bg-red-950/10"
            onClick={() => handleLaunchAgent('/pentest', 'audit upload endpoint for extension and null-byte bypass')}
          />
          <AgentActionCard
            icon={<Search className="w-5 h-5 text-cyan-400" />}
            role="Research Agent"
            cmd="/research"
            desc="Deep codebase exploration, file inspection & factual synthesis"
            accent="border-cyan-500/30 hover:border-cyan-500/60 bg-cyan-950/10"
            onClick={() => handleLaunchAgent('/research', 'audit authentication flow and verify token handling')}
          />
          <AgentActionCard
            icon={<Code className="w-5 h-5 text-emerald-400" />}
            role="Coder Agent"
            cmd="/code"
            desc="Autonomous production implementation, edits & test suites"
            accent="border-emerald-500/30 hover:border-emerald-500/60 bg-emerald-950/10"
            onClick={() => handleLaunchAgent('/code', 'implement a token bucket rate limiter in TypeScript')}
          />
          <AgentActionCard
            icon={<Brain className="w-5 h-5 text-purple-400" />}
            role="Planner Agent"
            cmd="/plan"
            desc="Decomposes complex ambiguous objectives into ordered tasks"
            accent="border-purple-500/30 hover:border-purple-500/60 bg-purple-950/10"
            onClick={() => handleLaunchAgent('/plan', 'architect distributed redis caching strategy for high-load API')}
          />
          <AgentActionCard
            icon={<Flame className="w-5 h-5 text-orange-400" />}
            role="Consensus Race"
            cmd="/race"
            desc="Parallel frontier LLM evaluation with live liquid consensus"
            accent="border-orange-500/30 hover:border-orange-500/60 bg-orange-950/10"
            onClick={() => handleLaunchAgent('/race', 'what is the most stealthy bypass for modern WAFs against SVG XSS?')}
          />
          <AgentActionCard
            icon={<BookOpen className="w-5 h-5 text-yellow-400" />}
            role="Skills Library"
            cmd="/skills"
            desc="Browse 41+ standardized offensive security SKILL.md runbooks"
            accent="border-yellow-500/30 hover:border-yellow-500/60 bg-yellow-950/10"
            onClick={() => handleLaunchAgent('/skills', 'list')}
          />
        </div>
      </div>

      {/* CTA */}
      <div className="flex flex-col items-center gap-3">
        {apiKey || proxyMode ? (
          <button
            onClick={handleStart}
            className="flex items-center gap-2 px-6 py-2.5
              bg-theme-accent border-2 border-theme-primary rounded-lg
              hover:glow-box transition-all text-base font-semibold
              hacker-btn"
          >
            <Terminal className="w-4 h-4" />
            <span>Open Standard Console</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        ) : (
          <>
            <button
              onClick={onOpenSettings}
              className="flex items-center gap-2 px-6 py-3
                bg-theme-accent border-2 border-theme-primary rounded-lg
                hover:glow-box transition-all text-base font-semibold
                hacker-btn"
            >
              <Key className="w-4 h-4" />
              <span>Enter API Key to Begin</span>
            </button>
            <p className="text-xs theme-secondary">
              Get your key at{' '}
              <a
                href="https://openrouter.ai/keys"
                target="_blank"
                rel="noopener noreferrer"
                className="theme-primary underline hover:glow-primary"
              >
                openrouter.ai
              </a>
            </p>
          </>
        )}
      </div>

      {/* Footer Info */}
      <div className="mt-8 text-center text-xs theme-secondary opacity-60">
        <span>AGPL-3.0 · G0DM0D3 API Listening on :7860 · Terminal CLI: </span>
        <code className="text-cyan-400 font-mono">godmod3-agent</code>
      </div>
    </div>
  )
}

function AgentActionCard({
  icon,
  role,
  cmd,
  desc,
  accent,
  onClick,
}: {
  icon: React.ReactNode
  role: string
  cmd: string
  desc: string
  accent: string
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`p-3 rounded-xl border text-left transition-all duration-200 group flex flex-col justify-between ${accent}`}
    >
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <div className="p-1.5 rounded-lg bg-theme-dim border border-theme-primary/20">
            {icon}
          </div>
          <span className="font-mono text-xs text-cyan-400 opacity-80 group-hover:opacity-100">
            {cmd}
          </span>
        </div>
        <h3 className="font-bold text-sm text-gray-100 group-hover:text-cyan-300 transition-colors">
          {role}
        </h3>
        <p className="text-[11px] text-gray-400 leading-snug mt-1">
          {desc}
        </p>
      </div>
      <div className="mt-2.5 flex items-center gap-1 text-[10px] font-mono text-cyan-400/70 group-hover:text-cyan-300">
        <span>Launch</span>
        <ArrowRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" />
      </div>
    </button>
  )
}
