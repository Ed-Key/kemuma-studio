export type ActionResult = {
  ok: boolean
  message: string
  jobId?: number
  detail?: string
  warnings?: string[]
}
