
/**
 *  switch  default  union case
 * TypeScript
 */
export const assertNever = (value: never): never => {
  throw new Error(`Unexpected value: ${JSON.stringify(value)}`)
}

// ── Agent Instance ID ──
// Instance IDs allow multiple copies of the same agent in a mission.
// Format: "agentId:N" where N >= 2 (first instance has no suffix).

export const INSTANCE_SEPARATOR = ':'

export const parseInstanceId = (instanceId: string): { baseId: string; instance: number } => {
  const sepIdx = instanceId.lastIndexOf(INSTANCE_SEPARATOR)
  if (sepIdx === -1) return { baseId: instanceId, instance: 1 }
  const suffix = instanceId.slice(sepIdx + 1)
  const n = Number(suffix)
  if (!Number.isInteger(n) || n < 2) return { baseId: instanceId, instance: 1 }
  return { baseId: instanceId.slice(0, sepIdx), instance: n }
}

export const makeInstanceId = (baseId: string, instance: number): string =>
  instance <= 1 ? baseId : `${baseId}${INSTANCE_SEPARATOR}${instance}`

export const nextInstanceId = (baseId: string, existingIds: string[]): string => {
  let maxInstance = 0
  for (const id of existingIds) {
    const { baseId: b, instance } = parseInstanceId(id)
    if (b === baseId) maxInstance = Math.max(maxInstance, instance)
  }
  return makeInstanceId(baseId, maxInstance + 1)
}
