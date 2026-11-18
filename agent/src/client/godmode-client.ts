import { ChatMessage, ToolDefinition } from '../agent/types'
import { config } from '../config'
import { ensureBackendRunning } from './backend-launcher'

export interface GodModeCompletionOptions {
  model?: string
  messages: ChatMessage[]
  tools?: ToolDefinition[]
  temperature?: number
  max_tokens?: number
  godmode?: boolean
  autotune?: boolean
  parseltongue?: boolean
  stm_modules?: string[]
}

export interface GodModeCompletionResponse {
  id: string
  model: string
  choices: Array<{
    index: number
    message: ChatMessage
    finish_reason: string
  }>
  usage?: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
  }
  x_g0dm0d3?: {
    autotune?: any
    parseltongue?: any
    stm?: any
  }
}

export class GodModeClient {
  private baseUrl: string
  private openrouterApiKey: string
  private serverApiKey?: string

  constructor(opts?: { baseUrl?: string; openrouterApiKey?: string; serverApiKey?: string }) {
    this.baseUrl = opts?.baseUrl || config.godmodeApiUrl
    this.openrouterApiKey = opts?.openrouterApiKey || config.openrouterApiKey
    this.serverApiKey = opts?.serverApiKey || config.godmodeApiKey
  }

  /**
   * Health check to verify that G0DM0D3 API is running
   */
  async checkHealth(): Promise<{ ok: boolean; status?: any; error?: string }> {
    try {
      const url = `${this.baseUrl.replace(/\/v1\/?$/, '')}/v1/health`
      const res = await fetch(url, {
        headers: this.getHeaders(),
      })
      if (!res.ok) {
        return { ok: false, error: `HTTP ${res.status}: ${res.statusText}` }
      }
      const data = await res.json()
      return { ok: true, status: data }
    } catch (err: any) {
      return { ok: false, error: err.message }
    }
  }

  /**
   * Ensures the backend server is running, auto-launching it if offline.
   */
  async ensureBackend(timeoutMs?: number) {
    return ensureBackendRunning({ baseUrl: this.baseUrl, timeoutMs })
  }

  /**
   * Standard Chat Completion routed through G0DM0D3 pipeline
   */
  async chatCompletion(opts: GodModeCompletionOptions): Promise<GodModeCompletionResponse> {
    const url = `${this.baseUrl}/chat/completions`

    const body: Record<string, any> = {
      model: opts.model || config.defaultModel,
      messages: opts.messages,
      openrouter_api_key: this.openrouterApiKey,
      godmode: opts.godmode ?? true,
      autotune: opts.autotune ?? true,
      parseltongue: opts.parseltongue ?? false, // Disabled on tools by default to preserve tool schemas
      stm_modules: opts.stm_modules ?? ['hedge_reducer', 'direct_mode'],
    }

    if (opts.temperature !== undefined) {
      body.temperature = opts.temperature
    }

    body.max_tokens = opts.max_tokens ?? config.maxOutputTokens

    if (opts.tools && opts.tools.length > 0) {
      body.tools = opts.tools
      body.tool_choice = 'auto'
    }

    let lastError: any
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...this.getHeaders(),
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(120000),
        })

        if (!res.ok) {
          const errorText = await res.text()
          let parsedErr: any
          try {
            parsedErr = JSON.parse(errorText)
          } catch {
            parsedErr = { message: errorText }
          }
          throw new Error(
            `G0DM0D3 API Error (${res.status}): ${parsedErr.error?.message || parsedErr.message || errorText}`
          )
        }

        return (await res.json()) as GodModeCompletionResponse
      } catch (err: any) {
        lastError = err
        if (err.message.startsWith('G0DM0D3 API Error')) {
          throw err
        }
        if (attempt < 2) {
          await new Promise(r => setTimeout(r, 1000))
          continue
        }
        const causeStr = err.cause ? ` [Cause: ${err.cause.message || err.cause.code || err.cause}]` : ''
        throw new Error(`Connection Error to ${url}: ${err.message}${causeStr}`)
      }
    }
    throw lastError
  }

  /**
   * Query G0DM0D3's flagship multi-model racing engine (ULTRAPLINIAN)
   */
  async raceUltraplinian(opts: {
    prompt: string
    tier?: 'fast' | 'standard' | 'smart' | 'power' | 'ultra'
  }): Promise<{
    winner: { model: string; score: number; content: string }
    allResults: Array<{ model: string; score: number; duration_ms: number; success: boolean }>
  }> {
    const url = `${this.baseUrl}/ultraplinian/completions`

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...this.getHeaders(),
      },
      body: JSON.stringify({
        messages: [{ role: 'user', content: opts.prompt }],
        tier: opts.tier || 'fast',
        stream: false,
        openrouter_api_key: this.openrouterApiKey,
      }),
    })

    if (!res.ok) {
      const err = await res.text()
      throw new Error(`ULTRAPLINIAN Race Error (${res.status}): ${err}`)
    }

    const data = await res.json()
    return {
      winner: {
        model: data.winner?.model || 'unknown',
        score: data.winner?.score || 0,
        content: data.choices?.[0]?.message?.content || data.winner?.content || '',
      },
      allResults: data.race_metadata?.results || [],
    }
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {}
    if (this.serverApiKey) {
      headers['Authorization'] = `Bearer ${this.serverApiKey}`
    }
    return headers
  }
}
