/**
 * readHead — bounded jsonl head reader for the external session scanner.
 *
 * Hard contract: never reads more than `cap` bytes from disk per call.
 * Used by both Claude and Codex paths so that a 34 MB jsonl costs the same as
 * an 8 KB one at scan time.
 */

import { promises as fsp } from 'fs'

const DEFAULT_CAP = 8192

export interface HeadReadResult {
  /** Raw text up to `cap` bytes, possibly truncated mid-line. */
  text: string
  /** Bytes actually read. May equal cap (file longer) or fewer (file shorter). */
  bytesRead: number
}

export const readHead = async (
  path: string,
  cap: number = DEFAULT_CAP,
): Promise<HeadReadResult> => {
  let fh: Awaited<ReturnType<typeof fsp.open>> | null = null
  try {
    fh = await fsp.open(path, 'r')
    const buf = Buffer.alloc(cap)
    const { bytesRead } = await fh.read(buf, 0, cap, 0)
    return {
      text: buf.subarray(0, bytesRead).toString('utf8'),
      bytesRead,
    }
  } finally {
    if (fh) await fh.close().catch(() => {})
  }
}

/**
 * Returns whole lines from a head read, discarding any trailing partial line.
 * Empty lines are skipped.
 */
export const readHeadLines = async (
  path: string,
  cap: number = DEFAULT_CAP,
): Promise<string[]> => {
  const { text, bytesRead } = await readHead(path, cap)
  if (bytesRead === 0) return []

  // If we hit EOF (read fewer than cap) the last line is complete; otherwise
  // the buffer was truncated mid-line and we discard the trailing fragment.
  const completeRegion =
    bytesRead < cap ? text : text.slice(0, text.lastIndexOf('\n') + 1)

  return completeRegion.split('\n').filter((l) => l.length > 0)
}

export const readFirstLine = async (
  path: string,
  cap: number = DEFAULT_CAP,
): Promise<string | null> => {
  const lines = await readHeadLines(path, cap)
  return lines.length > 0 ? lines[0] : null
}

export const safeJsonParse = <T = unknown>(s: string): T | null => {
  try {
    return JSON.parse(s) as T
  } catch {
    return null
  }
}
