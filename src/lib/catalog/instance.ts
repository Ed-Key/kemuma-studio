import path from 'node:path'
import { openDb, type Db } from './db'

let db: Db | null = null

export function getCatalogDb(): Db {
  if (!db) db = openDb(path.join(process.cwd(), 'data', 'catalog.sqlite'))
  return db
}

export function dataDir(): string {
  return path.join(process.cwd(), 'data')
}
