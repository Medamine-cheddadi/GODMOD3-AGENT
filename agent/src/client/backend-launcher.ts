import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import chalk from 'chalk'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

/**
 * Locate the G0DM0D3 repository containing the backend API.
 */
export function findBackendDirectory(): string | null {
  const candidates = [
    process.env.G0DM0D3_PATH,
    process.cwd(),
    path.resolve(__dirname, '../../..'),
    path.resolve(__dirname, '../..'),
    path.resolve(__dirname, '..'),
    path.resolve(process.cwd(), '../G0DM0D3'),
    path.resolve(process.cwd(), 'G0DM0D3'),
    '/Users/elamine/dev/G0DM0D3',
  ].filter(Boolean) as string[]

  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.existsSync(path.join(candidate, 'api/server.ts'))) {
      return path.resolve(candidate)
    }
  }

  return null
}

export interface EnsureBackendOptions {
  baseUrl?: string
  timeoutMs?: number
  logOutput?: boolean
}

/**
 * Checks if the backend API is online. If not, automatically launches it in the background
 * and waits until it becomes ready.
 */
export async function ensureBackendRunning(options?: EnsureBackendOptions): Promise<{
  online: boolean
  launched: boolean
  pid?: number
  url: string
  error?: string
}> {
  const rawUrl = options?.baseUrl || process.env.GODMODE_API_URL || 'http://localhost:7860/v1'
  const normalizedBase = rawUrl.replace(/\/v1\/?$/, '')
  const healthUrl = `${normalizedBase}/v1/health`
  const timeoutMs = options?.timeoutMs || 20000

  // 1. Check if backend is already online (fast check: localhost responds in <1ms)
  try {
    const res = await fetch(healthUrl, { signal: AbortSignal.timeout(350) })
    if (res.ok) {
      const data = (await res.json().catch(() => ({}))) as any
      if (data?.status === 'ok') {
        return { online: true, launched: false, url: normalizedBase }
      }
    }
  } catch {
    // Not reachable, proceed to launch
  }

  // Only auto-launch if targeting localhost
  const isLocalhost =
    normalizedBase.includes('localhost') ||
    normalizedBase.includes('127.0.0.1') ||
    normalizedBase.includes('0.0.0.0')

  if (!isLocalhost) {
    return {
      online: false,
      launched: false,
      url: normalizedBase,
      error: `Backend at remote URL (${normalizedBase}) is unreachable.`,
    }
  }

  // 2. Locate backend repository
  const backendDir = findBackendDirectory()
  if (!backendDir) {
    return {
      online: false,
      launched: false,
      url: normalizedBase,
      error: 'Could not find G0DM0D3 backend repository. Set G0DM0D3_PATH in .env.',
    }
  }

  console.log(chalk.yellow(`\n[G0DM0D3 Agent] Backend API is offline. Auto-launching from ${backendDir}...`))

  // Extract port from baseUrl if present
  let port = '7860'
  try {
    const parsed = new URL(normalizedBase)
    if (parsed.port) port = parsed.port
  } catch {}

  // 3. Spawn the backend process in background
  const logFile = path.join(backendDir, '.api-server.log')
  const outStream = fs.openSync(logFile, 'a')

  const child = spawn('npx', ['tsx', 'api/server.ts'], {
    cwd: backendDir,
    env: {
      ...process.env,
      PORT: port,
    },
    detached: true,
    stdio: ['ignore', outStream, outStream],
  })

  child.unref()

  const pid = child.pid
  console.log(chalk.gray(`[G0DM0D3 Agent] Spawned server process (PID: ${pid}), waiting for readiness...`))

  // 4. Poll /v1/health until online or timeout (quick 150ms intervals)
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, 150))
    try {
      const res = await fetch(healthUrl, { signal: AbortSignal.timeout(500) })
      if (res.ok) {
        const data = (await res.json().catch(() => ({}))) as any
        if (data?.status === 'ok') {
          console.log(chalk.green(`[G0DM0D3 Agent] ✓ Backend API is online on port ${port}!\n`))
          return { online: true, launched: true, pid, url: normalizedBase }
        }
      }
    } catch {
      // Continue polling
    }
  }

  return {
    online: false,
    launched: true,
    pid,
    url: normalizedBase,
    error: `Backend spawned (PID: ${pid}) but did not become ready within ${timeoutMs / 1000}s. Check ${logFile}`,
  }
}
