export interface TokenUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
  estimatedCostUsd: number
}

// Approximate pricing per 1M tokens on OpenRouter (as of late 2024 / 2025)
const MODEL_PRICING: Record<string, { promptPer1M: number; completionPer1M: number }> = {
  'z-ai/glm-5.3-flash': { promptPer1M: 0.04, completionPer1M: 0.078 },
  'google/gemini-2.5-flash': { promptPer1M: 0.15, completionPer1M: 0.60 },
  'deepseek/deepseek-v3.2': { promptPer1M: 0.26, completionPer1M: 0.38 },
  'deepseek/deepseek-chat': { promptPer1M: 0.14, completionPer1M: 0.28 },
  'qwen/qwen3-coder-flash': { promptPer1M: 0.195, completionPer1M: 0.975 },
  'qwen/qwen-2.5-72b-instruct': { promptPer1M: 0.35, completionPer1M: 0.40 },
  'anthropic/claude-sonnet-4.6': { promptPer1M: 3.00, completionPer1M: 15.00 },
  'openai/gpt-4o': { promptPer1M: 2.50, completionPer1M: 10.00 },
}

export class CostTracker {
  private totalPromptTokens = 0
  private totalCompletionTokens = 0
  private model: string

  constructor(model: string) {
    this.model = model
  }

  addUsage(usage?: { prompt_tokens?: number; completion_tokens?: number }) {
    if (!usage) return
    this.totalPromptTokens += usage.prompt_tokens || 0
    this.totalCompletionTokens += usage.completion_tokens || 0
  }

  getStats(): TokenUsage {
    const totalTokens = this.totalPromptTokens + this.totalCompletionTokens
    const pricing = MODEL_PRICING[this.model] || { promptPer1M: 0.20, completionPer1M: 0.50 }

    const costPrompt = (this.totalPromptTokens / 1_000_000) * pricing.promptPer1M
    const costCompletion = (this.totalCompletionTokens / 1_000_000) * pricing.completionPer1M
    const estimatedCostUsd = costPrompt + costCompletion

    return {
      promptTokens: this.totalPromptTokens,
      completionTokens: this.totalCompletionTokens,
      totalTokens,
      estimatedCostUsd,
    }
  }

  formatSummary(): string {
    const stats = this.getStats()
    const costStr = stats.estimatedCostUsd < 0.0001
      ? '< $0.0001'
      : `$${stats.estimatedCostUsd.toFixed(4)}`

    return `Tokens: ${stats.totalTokens.toLocaleString()} (Prompt: ${stats.promptTokens.toLocaleString()} | Completion: ${stats.completionTokens.toLocaleString()}) | Est. Cost: ${costStr}`
  }
}
