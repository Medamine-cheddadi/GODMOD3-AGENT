import fs from 'fs'
import path from 'path'
import { execSync } from 'child_process'

export interface PersistedSnapshot {
  turn: number
  timestamp: number
  gitCommitBefore?: string
  modifiedFiles: string[] // relative paths
  createdFiles: string[] // relative paths
  backupFilesDir: string
}

class CheckpointManager {
  private currentSessionId: string = ''
  private currentTurn: number = 0

  private getSessionDir(sessionId: string): string {
    const dir = path.resolve(process.cwd(), '.godmod3/checkpoints', sessionId || 'default')
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
    return dir
  }

  setContext(sessionId: string, turn: number) {
    this.currentSessionId = sessionId
    this.currentTurn = turn

    const sessionDir = this.getSessionDir(sessionId)
    const turnFile = path.join(sessionDir, `turn_${turn}.json`)

    if (!fs.existsSync(turnFile)) {
      let gitCommitBefore: string | undefined
      try {
        gitCommitBefore = execSync('git rev-parse HEAD', { stdio: ['pipe', 'pipe', 'ignore'] }).toString().trim()
      } catch {}

      const backupDir = path.join(sessionDir, `backup_turn_${turn}`)
      if (!fs.existsSync(backupDir)) {
        fs.mkdirSync(backupDir, { recursive: true })
      }

      const initialData: PersistedSnapshot = {
        turn,
        timestamp: Date.now(),
        gitCommitBefore,
        modifiedFiles: [],
        createdFiles: [],
        backupFilesDir: backupDir,
      }
      fs.writeFileSync(turnFile, JSON.stringify(initialData, null, 2), 'utf-8')
    }
  }

  getCurrentSessionId(): string {
    return this.currentSessionId
  }

  getCurrentTurn(): number {
    return this.currentTurn
  }

  /**
   * Called before write_file or edit_file modifies a file.
   * Backs up the original file content to disk or records it as newly created.
   */
  backupFileBeforeChange(filePath: string) {
    if (!this.currentSessionId || this.currentTurn <= 0) return

    const fullPath = path.resolve(filePath)
    const relPath = path.relative(process.cwd(), fullPath)
    const sessionDir = this.getSessionDir(this.currentSessionId)
    const turnFile = path.join(sessionDir, `turn_${this.currentTurn}.json`)

    if (!fs.existsSync(turnFile)) {
      this.setContext(this.currentSessionId, this.currentTurn)
    }

    let snapshot: PersistedSnapshot
    try {
      snapshot = JSON.parse(fs.readFileSync(turnFile, 'utf-8'))
    } catch {
      return
    }

    // If already recorded in this turn, don't overwrite initial pre-modification backup
    if (snapshot.modifiedFiles.includes(relPath) || snapshot.createdFiles.includes(relPath)) {
      return
    }

    try {
      if (fs.existsSync(fullPath)) {
        // Back up existing file content
        const backupTarget = path.join(snapshot.backupFilesDir, relPath.replace(/\//g, '__SLASH__'))
        fs.mkdirSync(path.dirname(backupTarget), { recursive: true })
        fs.copyFileSync(fullPath, backupTarget)
        snapshot.modifiedFiles.push(relPath)
      } else {
        // Mark as newly created file
        snapshot.createdFiles.push(relPath)
      }
      fs.writeFileSync(turnFile, JSON.stringify(snapshot, null, 2), 'utf-8')
    } catch {}
  }

  /**
   * Undo changes made during the specified turn or the latest turn.
   */
  rollbackTurn(targetTurn?: number): {
    success: boolean
    restoredFiles: string[]
    deletedFiles: string[]
    error?: string
  } {
    const sessionDir = this.getSessionDir(this.currentSessionId)

    let turnToRevert = targetTurn
    if (turnToRevert === undefined) {
      const files = fs.readdirSync(sessionDir).filter(f => f.startsWith('turn_') && f.endsWith('.json'))
      if (files.length === 0) {
        return {
          success: false,
          restoredFiles: [],
          deletedFiles: [],
          error: `No checkpoints found in session ${this.currentSessionId}.`,
        }
      }
      const turnNums = files.map(f => parseInt(f.replace('turn_', '').replace('.json', ''), 10)).sort((a, b) => b - a)

      // Find the most recent turn that actually contains file modifications or creations
      for (const t of turnNums) {
        try {
          const data: PersistedSnapshot = JSON.parse(fs.readFileSync(path.join(sessionDir, `turn_${t}.json`), 'utf-8'))
          if (data.modifiedFiles.length > 0 || data.createdFiles.length > 0) {
            turnToRevert = t
            break
          }
        } catch {}
      }

      if (turnToRevert === undefined) {
        turnToRevert = turnNums[0]
      }
    }

    const turnFile = path.join(sessionDir, `turn_${turnToRevert}.json`)
    if (!fs.existsSync(turnFile)) {
      return {
        success: false,
        restoredFiles: [],
        deletedFiles: [],
        error: `Checkpoint file for turn ${turnToRevert} not found on disk.`,
      }
    }

    let snapshot: PersistedSnapshot
    try {
      snapshot = JSON.parse(fs.readFileSync(turnFile, 'utf-8'))
    } catch (err: any) {
      return {
        success: false,
        restoredFiles: [],
        deletedFiles: [],
        error: `Could not parse turn ${turnToRevert} checkpoint: ${err.message}`,
      }
    }

    const restoredFiles: string[] = []
    const deletedFiles: string[] = []

    try {
      // 1. Restore modified files from backup
      for (const relPath of snapshot.modifiedFiles) {
        const fullPath = path.resolve(process.cwd(), relPath)
        const backupTarget = path.join(snapshot.backupFilesDir, relPath.replace(/\//g, '__SLASH__'))
        if (fs.existsSync(backupTarget)) {
          fs.mkdirSync(path.dirname(fullPath), { recursive: true })
          fs.copyFileSync(backupTarget, fullPath)
          restoredFiles.push(relPath)
        }
      }

      // 2. Delete newly created files
      for (const relPath of snapshot.createdFiles) {
        const fullPath = path.resolve(process.cwd(), relPath)
        if (fs.existsSync(fullPath)) {
          fs.unlinkSync(fullPath)
          deletedFiles.push(relPath)
        }
      }

      // Clean up backup directory and turn file
      try {
        fs.rmSync(snapshot.backupFilesDir, { recursive: true, force: true })
        fs.unlinkSync(turnFile)
      } catch {}

      return {
        success: true,
        restoredFiles,
        deletedFiles,
      }
    } catch (err: any) {
      return {
        success: false,
        restoredFiles,
        deletedFiles,
        error: `Failed to rollback turn ${turnToRevert}: ${err.message}`,
      }
    }
  }

  /**
   * Roll back all changes made across the entire session.
   */
  rollbackAllSession(): {
    success: boolean
    turnsReverted: number
    restoredFiles: string[]
    deletedFiles: string[]
    error?: string
  } {
    const sessionDir = this.getSessionDir(this.currentSessionId)
    if (!fs.existsSync(sessionDir)) {
      return {
        success: true,
        turnsReverted: 0,
        restoredFiles: [],
        deletedFiles: [],
      }
    }

    const files = fs.readdirSync(sessionDir).filter(f => f.startsWith('turn_') && f.endsWith('.json'))
    const turnNums = files.map(f => parseInt(f.replace('turn_', '').replace('.json', ''), 10)).sort((a, b) => b - a)

    const allRestored: Set<string> = new Set()
    const allDeleted: Set<string> = new Set()

    for (const turn of turnNums) {
      const res = this.rollbackTurn(turn)
      if (!res.success) {
        return {
          success: false,
          turnsReverted: turnNums.length,
          restoredFiles: Array.from(allRestored),
          deletedFiles: Array.from(allDeleted),
          error: res.error,
        }
      }
      res.restoredFiles.forEach(f => allRestored.add(f))
      res.deletedFiles.forEach(f => allDeleted.add(f))
    }

    return {
      success: true,
      turnsReverted: turnNums.length,
      restoredFiles: Array.from(allRestored),
      deletedFiles: Array.from(allDeleted),
    }
  }

  /**
   * List all stored checkpoints in the active session.
   */
  listCheckpoints(): Array<{
    turn: number
    timestamp: number
    modifiedCount: number
    createdCount: number
    files: string[]
  }> {
    const sessionDir = this.getSessionDir(this.currentSessionId)
    if (!fs.existsSync(sessionDir)) {
      return []
    }

    const files = fs.readdirSync(sessionDir).filter(f => f.startsWith('turn_') && f.endsWith('.json'))
    const list: Array<{
      turn: number
      timestamp: number
      modifiedCount: number
      createdCount: number
      files: string[]
    }> = []

    for (const file of files) {
      try {
        const data: PersistedSnapshot = JSON.parse(fs.readFileSync(path.join(sessionDir, file), 'utf-8'))
        const allFiles = [
          ...data.modifiedFiles,
          ...data.createdFiles.map(f => `${f} (new)`),
        ]
        list.push({
          turn: data.turn,
          timestamp: data.timestamp,
          modifiedCount: data.modifiedFiles.length,
          createdCount: data.createdFiles.length,
          files: allFiles,
        })
      } catch {}
    }

    return list.sort((a, b) => a.turn - b.turn)
  }
}

export const checkpointManager = new CheckpointManager()
