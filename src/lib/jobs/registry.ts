const running = new Map<number, AbortController>()

export function registerJob(
  jobId: number,
  controller = new AbortController()
): AbortController {
  running.set(jobId, controller)
  return controller
}

export function unregisterJob(jobId: number): void {
  running.delete(jobId)
}

export function runningJobIds(): number[] {
  return [...running.keys()]
}

export function cancelJob(jobId: number): boolean {
  const controller = running.get(jobId)
  if (!controller) return false
  controller.abort()
  return true
}
