import { ToolDefinition, ToolHandler } from '../agent/types'
import { GodModeClient } from '../client/godmode-client'

const client = new GodModeClient()

export const ultraplinianRaceDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'ultraplinian_eval',
    description: 'Race multiple frontier LLMs in parallel via G0DM0D3 ULTRAPLINIAN engine to solve a complex sub-problem or verify a critical security/technical decision. Returns the winning consensus answer.',
    parameters: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: 'The specific prompt, challenge, or question to race across models.',
        },
        tier: {
          type: 'string',
          enum: ['fast', 'standard', 'smart', 'power', 'ultra'],
          description: 'The model speed and depth tier (defaults to "fast").',
        },
      },
      required: ['prompt'],
    },
  },
}

export const ultraplinianRaceHandler: ToolHandler = async (args: {
  prompt: string
  tier?: 'fast' | 'standard' | 'smart' | 'power' | 'ultra'
}) => {
  try {
    // Map tier: keep agent races fast & light (fast: 12 models)
    const effectiveTier = (args.tier === 'standard') ? 'standard' : 'fast'
    const result = await client.raceUltraplinian({
      prompt: args.prompt,
      tier: effectiveTier,
    })

    const summary = [
      `[ULTRAPLINIAN Race Winner: ${result.winner.model} (Score: ${result.winner.score}/100)]`,
      result.winner.content,
      `\n[Race Statistics: ${result.allResults.length} models competed]`,
    ].join('\n')

    return summary
  } catch (err: any) {
    return `ULTRAPLINIAN race failed: ${err.message}`
  }
}
