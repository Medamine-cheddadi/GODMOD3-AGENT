import dotenv from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// 1. Load default package .env (from godmod3-agent root)
dotenv.config({ path: path.resolve(__dirname, '../.env') })
// 2. Fallback to G0DM0D3 backend .env if available
dotenv.config({ path: '/Users/elamine/dev/G0DM0D3/.env' })
// 3. Load cwd .env if present (allows per-folder or per-agent overrides)
dotenv.config()

export type ModelProfileName = 'cheap' | 'deepseek' | 'qwen' | 'glm' | 'smart' | 'local'

export const MODEL_PROFILES: Record<ModelProfileName, { model: string; description: string; contextWindow: string }> = {
  cheap: {
    model: 'google/gemini-2.5-flash',
    description: 'Extremely fast and ultra-cheap (~$0.15/1M tokens) with massive 1M context window',
    contextWindow: '1,000,000 tokens',
  },
  deepseek: {
    model: 'deepseek/deepseek-v3.2',
    description: 'DeepSeek V3.2 unified coding & reasoning flagship ($0.26/1M in, $0.38/1M out)',
    contextWindow: '163,840 tokens',
  },
  qwen: {
    model: 'qwen/qwen3-coder-flash',
    description: 'Alibaba Qwen 3 Coder Flash: dedicated coding model with 1M context ($0.19/1M tokens)',
    contextWindow: '1,000,000 tokens',
  },
  glm: {
    model: 'z-ai/glm-5.3-flash',
    description: 'Zhipu AI GLM 5.3 Flash: 1M context, ultra-cheap Chinese model ($0.04/1M in)',
    contextWindow: '1,048,576 tokens',
  },
  smart: {
    model: 'anthropic/claude-sonnet-4.6',
    description: 'Frontier reasoning and coding (more expensive, higher precision)',
    contextWindow: '200,000 tokens',
  },
  local: {
    model: 'qwen2.5-coder:7b',
    description: '100% Free local inference via Ollama / LM Studio (0 tokens billed)',
    contextWindow: '32,000+ tokens',
  },
}

export interface ModelPeerInfo {
  model: string
  contextWindow: string
  pricing: string
  tier: 'flash_cheap' | 'mid_coder' | 'frontier' | 'local'
  peers: string[]
}

export const MODEL_CATALOG: Record<string, ModelPeerInfo> = {
  'z-ai/glm-5.3-flash': {
    model: 'z-ai/glm-5.3-flash',
    contextWindow: '1M tokens (1,048,576)',
    pricing: '$0.04/1M in, $0.08/1M out',
    tier: 'flash_cheap',
    peers: [
      'google/gemini-2.5-flash',
      'qwen/qwen3-coder-flash',
      'deepseek/deepseek-v3.2',
    ],
  },
  'google/gemini-2.5-flash': {
    model: 'google/gemini-2.5-flash',
    contextWindow: '1M tokens (1,000,000)',
    pricing: '$0.15/1M in, $0.60/1M out',
    tier: 'flash_cheap',
    peers: [
      'z-ai/glm-5.3-flash',
      'qwen/qwen3-coder-flash',
      'deepseek/deepseek-v3.2',
    ],
  },
  'qwen/qwen3-coder-flash': {
    model: 'qwen/qwen3-coder-flash',
    contextWindow: '1M tokens (1,000,000)',
    pricing: '$0.19/1M in, $0.76/1M out',
    tier: 'flash_cheap',
    peers: [
      'z-ai/glm-5.3-flash',
      'google/gemini-2.5-flash',
      'deepseek/deepseek-v3.2',
    ],
  },
  'deepseek/deepseek-v3.2': {
    model: 'deepseek/deepseek-v3.2',
    contextWindow: '164k tokens (163,840)',
    pricing: '$0.26/1M in, $0.38/1M out',
    tier: 'mid_coder',
    peers: [
      'qwen/qwen3-coder-flash',
      'z-ai/glm-5.3-flash',
      'google/gemini-2.5-flash',
    ],
  },
  'anthropic/claude-sonnet-4.6': {
    model: 'anthropic/claude-sonnet-4.6',
    contextWindow: '200k tokens (200,000)',
    pricing: '$3.00/1M in, $15.00/1M out',
    tier: 'frontier',
    peers: [
      'openai/gpt-4o',
      'google/gemini-2.5-pro',
      'deepseek/deepseek-r1',
    ],
  },
  'openai/gpt-4o': {
    model: 'openai/gpt-4o',
    contextWindow: '128k tokens (128,000)',
    pricing: '$2.50/1M in, $10.00/1M out',
    tier: 'frontier',
    peers: [
      'anthropic/claude-sonnet-4.6',
      'google/gemini-2.5-pro',
      'deepseek/deepseek-r1',
    ],
  },
}

/**
 * Returns a list of equivalent peer models matching the active model's
 * context window size, intelligence tier, and cost profile.
 */
export function getEquivalentPeerModels(activeModel: string): string[] {
  // 1. Direct match in catalog
  if (MODEL_CATALOG[activeModel]?.peers) {
    return MODEL_CATALOG[activeModel].peers
  }

  // 2. Fuzzy match
  const normalized = activeModel.toLowerCase()
  for (const [key, val] of Object.entries(MODEL_CATALOG)) {
    if (normalized.includes(key.toLowerCase()) || key.toLowerCase().includes(normalized)) {
      return val.peers
    }
  }

  // 3. Fallback to flash-tier peers (1M context, low cost)
  return [
    'google/gemini-2.5-flash',
    'qwen/qwen3-coder-flash',
    'deepseek/deepseek-v3.2',
  ]
}

export interface AgentConfig {
  godmodeApiUrl: string
  openrouterApiKey: string
  godmodeApiKey?: string
  defaultModel: string
  maxTurns: number
  maxRefusals: number
  maxOutputTokens: number
  maxToolOutputChars: number
  executionTimeoutMs: number
  workDir: string
}

export const config: AgentConfig = {
  godmodeApiUrl: process.env.GODMODE_API_URL || 'http://localhost:7860/v1',
  openrouterApiKey: process.env.OPENROUTER_API_KEY || '',
  godmodeApiKey: process.env.GODMODE_API_KEY || '',
  defaultModel: process.env.DEFAULT_MODEL || MODEL_PROFILES.glm.model,
  maxTurns: parseInt(process.env.MAX_TURNS || '0', 10), // 0 = unlimited by default
  maxRefusals: parseInt(process.env.MAX_REFUSALS || '3', 10),
  maxOutputTokens: parseInt(process.env.MAX_OUTPUT_TOKENS || '8192', 10),
  maxToolOutputChars: parseInt(process.env.MAX_TOOL_OUTPUT_CHARS || '4000', 10),
  executionTimeoutMs: parseInt(process.env.EXECUTION_TIMEOUT_MS || '120000', 10),
  workDir: process.cwd(),
}
