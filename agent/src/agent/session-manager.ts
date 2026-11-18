import fs from 'fs'
import path from 'path'
import { ChatMessage, AgentSession, TodoItem } from './types'

const SESSIONS_DIR = path.resolve(process.cwd(), '.godmod3/sessions')

function ensureDir(dirPath: string) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true })
  }
}

export function generateSessionId(): string {
  const timestamp = new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 14)
  const rand = Math.random().toString(36).substring(2, 6)
  return `sess_${timestamp}_${rand}`
}

/**
 * Save an active or completed agent session to disk
 */
export function saveSession(session: AgentSession): void {
  try {
    ensureDir(SESSIONS_DIR)
    session.updatedAt = Date.now()
    const filePath = path.join(SESSIONS_DIR, `${session.id}.json`)
    fs.writeFileSync(filePath, JSON.stringify(session, null, 2), 'utf-8')

    // Also update a 'latest.json' pointer
    const latestPath = path.join(SESSIONS_DIR, 'latest.json')
    fs.writeFileSync(latestPath, JSON.stringify({ id: session.id, updatedAt: session.updatedAt }), 'utf-8')
  } catch (err: any) {
    console.error(`[SessionManager] Failed to save session ${session.id}:`, err.message)
  }
}

/**
 * Load a session by ID, or load the most recent session if no ID given
 */
export function loadSession(idOrLatest?: string): AgentSession | null {
  try {
    ensureDir(SESSIONS_DIR)

    let targetId = idOrLatest
    if (!targetId || targetId === 'latest') {
      const latestPath = path.join(SESSIONS_DIR, 'latest.json')
      if (fs.existsSync(latestPath)) {
        const latestMeta = JSON.parse(fs.readFileSync(latestPath, 'utf-8'))
        targetId = latestMeta.id
      } else {
        // Fallback: pick the newest json file
        const files = fs.readdirSync(SESSIONS_DIR).filter(f => f.startsWith('sess_') && f.endsWith('.json'))
        if (files.length === 0) return null
        files.sort().reverse()
        targetId = files[0].replace('.json', '')
      }
    }

    if (!targetId) return null

    const sessionFile = path.join(SESSIONS_DIR, `${targetId.replace('.json', '')}.json`)
    if (!fs.existsSync(sessionFile)) {
      return null
    }

    const content = fs.readFileSync(sessionFile, 'utf-8')
    return JSON.parse(content) as AgentSession
  } catch (err: any) {
    console.error(`[SessionManager] Failed to load session:`, err.message)
    return null
  }
}

/**
 * List all saved agent sessions
 */
export function listSessions(): Array<{
  id: string
  createdAt: number
  updatedAt: number
  goal: string
  model: string
  turnsTaken: number
  status: string
  todoCount: number
}> {
  try {
    ensureDir(SESSIONS_DIR)
    const files = fs.readdirSync(SESSIONS_DIR).filter(f => f.startsWith('sess_') && f.endsWith('.json'))

    const sessions = files.map(file => {
      try {
        const content = fs.readFileSync(path.join(SESSIONS_DIR, file), 'utf-8')
        const data = JSON.parse(content) as AgentSession
        return {
          id: data.id,
          createdAt: data.createdAt,
          updatedAt: data.updatedAt,
          goal: data.goal,
          model: data.model,
          turnsTaken: data.turnsTaken,
          status: data.status,
          todoCount: data.todos?.length || 0,
        }
      } catch {
        return null
      }
    }).filter(Boolean) as any[]

    sessions.sort((a, b) => b.updatedAt - a.updatedAt)
    return sessions
  } catch {
    return []
  }
}

/**
 * Delete a session
 */
export function deleteSession(id: string): boolean {
  try {
    const file = path.join(SESSIONS_DIR, `${id.replace('.json', '')}.json`)
    if (fs.existsSync(file)) {
      fs.unlinkSync(file)
      return true
    }
    return false
  } catch {
    return false
  }
}
