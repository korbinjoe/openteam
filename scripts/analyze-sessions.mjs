#!/usr/bin/env node
/**
 * Claude Code Session JSONL Analyzer
 * Analyzes Claude Code session data for a given project
 */
import fs from 'fs'
import path from 'path'
import readline from 'readline'
import { homedir } from 'os'
import { fileURLToPath } from 'url'

const PROJECTS = {
  openteam: path.join(homedir(), '.claude/projects', `-Users-${process.env.USER}-work-openteam`),
}

// Collect all JSONL files (excluding subagent)
function collectJsonlFiles(dir) {
  const files = []
  function walk(d) {
    if (!fs.existsSync(d)) return
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name)
      if (entry.isDirectory()) {
        walk(full)
      } else if (entry.name.endsWith('.jsonl')) {
        files.push(full)
      }
    }
  }
  walk(dir)
  return files
}

// Parse a single JSONL file
async function parseJsonl(filePath) {
  const lines = []
  const rl = readline.createInterface({
    input: fs.createReadStream(filePath),
    crlfDelay: Infinity,
  })
  for await (const line of rl) {
    try {
      lines.push(JSON.parse(line))
    } catch {}
  }
  return lines
}

// Analyze a single session
function analyzeSession(entries, filePath) {
  const isSubagent = filePath.includes('/subagents/')
  const sessionId = path.basename(filePath, '.jsonl')

  const userMessages = entries.filter(e => e.type === 'user')
  const assistantMessages = entries.filter(e => e.type === 'assistant')

  // Time range
  const timestamps = entries.filter(e => e.timestamp).map(e => new Date(e.timestamp))
  const startTime = timestamps.length ? new Date(Math.min(...timestamps)) : null
  const endTime = timestamps.length ? new Date(Math.max(...timestamps)) : null
  const durationMs = startTime && endTime ? endTime - startTime : 0

  // Token usage
  let totalInputTokens = 0
  let totalOutputTokens = 0
  let totalCacheCreation = 0
  let totalCacheRead = 0

  // Tool usage stats
  const toolUsage = {}
  let totalToolCalls = 0

  // Error stats
  let errorCount = 0
  const errorTypes = {}

  // User message content (for topic extraction)
  const userTexts = []

  // Model usage
  const models = {}

  // Branch info
  const branches = new Set()

  // Permission mode
  const permModes = new Set()

  for (const entry of entries) {
    // Branch
    if (entry.gitBranch) branches.add(entry.gitBranch)

    // Permission mode
    if (entry.permissionMode) permModes.add(entry.permissionMode)

    if (entry.type === 'user' && entry.message?.content) {
      const content = typeof entry.message.content === 'string'
        ? entry.message.content
        : entry.message.content.filter(c => c.type === 'text').map(c => c.text).join(' ')
      if (content.trim()) userTexts.push(content.trim().slice(0, 500))
    }

    if (entry.type === 'assistant' && entry.message) {
      const msg = entry.message

      // Model
      if (msg.model) models[msg.model] = (models[msg.model] || 0) + 1

      // Token
      if (msg.usage) {
        totalInputTokens += msg.usage.input_tokens || 0
        totalOutputTokens += msg.usage.output_tokens || 0
        totalCacheCreation += msg.usage.cache_creation_input_tokens || 0
        totalCacheRead += msg.usage.cache_read_input_tokens || 0
      }

      // Tool usage
      if (msg.content && Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (block.type === 'tool_use') {
            const toolName = block.name || 'unknown'
            toolUsage[toolName] = (toolUsage[toolName] || 0) + 1
            totalToolCalls++
          }
        }
      }
    }

    // Errors in tool results
    if (entry.type === 'tool_result' || entry.type === 'tool_use_result') {
      const content = entry.message?.content || entry.content
      if (content && typeof content === 'string' && (content.includes('Error') || content.includes('error'))) {
        errorCount++
        // Simple categorization
        if (content.includes('ENOENT')) errorTypes['ENOENT (file not found)'] = (errorTypes['ENOENT (file not found)'] || 0) + 1
        else if (content.includes('Permission denied')) errorTypes['Permission error'] = (errorTypes['Permission error'] || 0) + 1
        else if (content.includes('SyntaxError')) errorTypes['Syntax error'] = (errorTypes['Syntax error'] || 0) + 1
        else if (content.includes('TypeScript') || content.includes('type error') || content.includes('TypeError')) errorTypes['Type error'] = (errorTypes['Type error'] || 0) + 1
        else if (content.includes('timeout') || content.includes('Timeout')) errorTypes['Timeout'] = (errorTypes['Timeout'] || 0) + 1
        else if (content.includes('not unique')) errorTypes['Edit not unique'] = (errorTypes['Edit not unique'] || 0) + 1
        else errorTypes['Other errors'] = (errorTypes['Other errors'] || 0) + 1
      }
    }
  }

  return {
    sessionId,
    isSubagent,
    filePath,
    fileSize: fs.statSync(filePath).size,
    startTime,
    endTime,
    durationMs,
    userMessageCount: userMessages.length,
    assistantMessageCount: assistantMessages.length,
    totalInputTokens,
    totalOutputTokens,
    totalCacheCreation,
    totalCacheRead,
    toolUsage,
    totalToolCalls,
    errorCount,
    errorTypes,
    userTexts,
    models,
    branches: [...branches],
    permModes: [...permModes],
    entryCount: entries.length,
  }
}

// Extract session topic (from user's first message)
function extractTopic(session) {
  if (!session.userTexts.length) return '(empty session)'
  const first = session.userTexts[0]
  // Take the first 100 chars as topic
  return first.slice(0, 100).replace(/\n/g, ' ')
}

// Detect repeated file editing pattern
function detectChurnPattern(sessions) {
  const fileEditCounts = {}
  for (const s of sessions) {
    for (const [tool, count] of Object.entries(s.toolUsage)) {
      if (tool === 'Edit' || tool === 'Write') {
        // Cannot get filenames from tool_use directly, but we can count occurrences
        fileEditCounts[s.sessionId] = (fileEditCounts[s.sessionId] || 0) + count
      }
    }
  }
  return fileEditCounts
}

// Detect session continuation chains
function detectContinuations(sessions) {
  const continuations = []
  for (const s of sessions) {
    for (const text of s.userTexts) {
      if (text.includes('continued') || text.includes('continue') || text.includes('resume')) {
        continuations.push(s.sessionId)
        break
      }
    }
  }
  return continuations
}

// Extract high-frequency user instruction keywords
function extractKeywords(sessions) {
  const keywords = {}
  const patterns = [
    [/bug|fix/i, 'Bug fix'],
    [/refactor/i, 'Refactor'],
    [/performance|perf|optimi/i, 'Performance'],
    [/terminal|xterm|pty/i, 'Terminal'],
    [/websocket|ws|connection/i, 'WebSocket'],
    [/session/i, 'Session mgmt'],
    [/test/i, 'Testing'],
    [/design|proposal/i, 'Design'],
    [/review/i, 'Code review'],
    [/commit|git/i, 'Git ops'],
    [/deploy|release|publish/i, 'Deploy'],
    [/UI|style|css|tailwind/i, 'UI/Style'],
    [/analy|report/i, 'Analysis'],
    [/electron/i, 'Electron'],
    [/pua|skill/i, 'PUA/Skill'],
  ]

  for (const s of sessions) {
    if (s.isSubagent) continue
    for (const text of s.userTexts) {
      for (const [pattern, label] of patterns) {
        if (pattern.test(text)) {
          keywords[label] = (keywords[label] || 0) + 1
        }
      }
    }
  }
  return keywords
}

// Analyze time distribution
function analyzeTimeDistribution(sessions) {
  const hourDist = Array(24).fill(0)
  const dayDist = Array(7).fill(0) // 0=Sun
  const dateDist = {}

  for (const s of sessions) {
    if (s.isSubagent || !s.startTime) continue
    hourDist[s.startTime.getHours()]++
    dayDist[s.startTime.getDay()]++
    const dateKey = s.startTime.toISOString().slice(0, 10)
    dateDist[dateKey] = (dateDist[dateKey] || 0) + 1
  }
  return { hourDist, dayDist, dateDist }
}

// Estimate token cost (based on Claude Opus pricing)
function estimateCost(inputTokens, outputTokens, cacheCreation, cacheRead) {
  // Opus pricing: $15/M input, $75/M output, cache creation $18.75/M, cache read $1.875/M
  const inputCost = (inputTokens / 1_000_000) * 15
  const outputCost = (outputTokens / 1_000_000) * 75
  const cacheCreateCost = (cacheCreation / 1_000_000) * 18.75
  const cacheReadCost = (cacheRead / 1_000_000) * 1.875
  return { inputCost, outputCost, cacheCreateCost, cacheReadCost, total: inputCost + outputCost + cacheCreateCost + cacheReadCost }
}

// Detect "retry" pattern - many edits in a session may indicate trial-and-error
function detectRetryPatterns(sessions) {
  const highChurnSessions = []
  for (const s of sessions) {
    if (s.isSubagent) continue
    const editCount = (s.toolUsage.Edit || 0) + (s.toolUsage.Write || 0)
    const readCount = s.toolUsage.Read || 0
    const bashCount = s.toolUsage.Bash || 0

    // If edits > 20 and errors > 5, likely in trial-and-error loop
    if (editCount > 20 && s.errorCount > 5) {
      highChurnSessions.push({
        sessionId: s.sessionId,
        topic: extractTopic(s),
        editCount,
        errorCount: s.errorCount,
        duration: Math.round(s.durationMs / 60000),
      })
    }
  }
  return highChurnSessions
}

// Detect overly long sessions
function detectLongSessions(sessions, thresholdMinutes = 60) {
  return sessions
    .filter(s => !s.isSubagent && s.durationMs > thresholdMinutes * 60 * 1000)
    .map(s => ({
      sessionId: s.sessionId,
      topic: extractTopic(s),
      durationMinutes: Math.round(s.durationMs / 60000),
      userMessages: s.userMessageCount,
      totalTokens: s.totalInputTokens + s.totalOutputTokens,
    }))
    .sort((a, b) => b.durationMinutes - a.durationMinutes)
}

// Detect high token consumption sessions
function detectHighTokenSessions(sessions, threshold = 500000) {
  return sessions
    .filter(s => !s.isSubagent && (s.totalInputTokens + s.totalOutputTokens) > threshold)
    .map(s => ({
      sessionId: s.sessionId.slice(0, 8),
      topic: extractTopic(s),
      inputTokens: s.totalInputTokens,
      outputTokens: s.totalOutputTokens,
      cacheCreation: s.totalCacheCreation,
      totalTokens: s.totalInputTokens + s.totalOutputTokens + s.totalCacheCreation,
    }))
    .sort((a, b) => b.totalTokens - a.totalTokens)
}

// ===== Main =====
async function main() {
  const results = {}

  for (const [projectName, projectDir] of Object.entries(PROJECTS)) {
    console.log(`\nAnalyzing ${projectName}...`)
    const files = collectJsonlFiles(projectDir)
    console.log(`  Found ${files.length} JSONL files`)

    const sessions = []
    let processed = 0

    for (const file of files) {
      try {
        const entries = await parseJsonl(file)
        const session = analyzeSession(entries, file)
        sessions.push(session)
        processed++
        if (processed % 50 === 0) console.log(`  Processed ${processed}/${files.length}`)
      } catch (e) {
        console.error(`  Parse failed: ${file}: ${e.message}`)
      }
    }

    const mainSessions = sessions.filter(s => !s.isSubagent)
    const subagentSessions = sessions.filter(s => s.isSubagent)

    // Aggregate stats
    const totalInputTokens = sessions.reduce((s, x) => s + x.totalInputTokens, 0)
    const totalOutputTokens = sessions.reduce((s, x) => s + x.totalOutputTokens, 0)
    const totalCacheCreation = sessions.reduce((s, x) => s + x.totalCacheCreation, 0)
    const totalCacheRead = sessions.reduce((s, x) => s + x.totalCacheRead, 0)

    // Tool summary
    const totalTools = {}
    for (const s of sessions) {
      for (const [tool, count] of Object.entries(s.toolUsage)) {
        totalTools[tool] = (totalTools[tool] || 0) + count
      }
    }

    // Error summary
    const totalErrors = {}
    let totalErrorCount = 0
    for (const s of sessions) {
      totalErrorCount += s.errorCount
      for (const [type, count] of Object.entries(s.errorTypes)) {
        totalErrors[type] = (totalErrors[type] || 0) + count
      }
    }

    // All branches
    const allBranches = new Set()
    sessions.forEach(s => s.branches.forEach(b => allBranches.add(b)))

    // Permission mode stats
    const permStats = {}
    mainSessions.forEach(s => s.permModes.forEach(p => { permStats[p] = (permStats[p] || 0) + 1 }))

    results[projectName] = {
      totalFiles: files.length,
      mainSessions: mainSessions.length,
      subagentSessions: subagentSessions.length,
      totalInputTokens,
      totalOutputTokens,
      totalCacheCreation,
      totalCacheRead,
      cost: estimateCost(totalInputTokens, totalOutputTokens, totalCacheCreation, totalCacheRead),
      totalTools,
      totalErrorCount,
      totalErrors,
      keywords: extractKeywords(sessions),
      timeDist: analyzeTimeDistribution(sessions),
      retryPatterns: detectRetryPatterns(sessions),
      longSessions: detectLongSessions(sessions),
      highTokenSessions: detectHighTokenSessions(sessions),
      branches: [...allBranches],
      permStats,
      // Detailed session list (main sessions)
      sessionDetails: mainSessions.map(s => ({
        id: s.sessionId.slice(0, 8),
        topic: extractTopic(s),
        start: s.startTime?.toISOString(),
        durationMin: Math.round(s.durationMs / 60000),
        userMsgs: s.userMessageCount,
        tools: s.totalToolCalls,
        errors: s.errorCount,
        tokens: s.totalInputTokens + s.totalOutputTokens,
        models: Object.keys(s.models),
      })).sort((a, b) => (a.start || '').localeCompare(b.start || '')),
    }
  }

  // Output JSON results
  const outputPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'session-analysis-data.json')
  fs.writeFileSync(outputPath, JSON.stringify(results, null, 2))
  console.log(`\nAnalysis complete, results saved to ${outputPath}`)
}

main().catch(console.error)
