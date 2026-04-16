#!/usr/bin/env node
/**
 * Read and inspect changelog from Firebase.
 * Shows total entries, entries per user, and date ranges.
 */

import 'dotenv/config'
import { initializeApp, cert } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { readFileSync } from 'fs'
import { join } from 'path'
import { pbkdf2Sync, createDecipheriv } from 'crypto'

const PASSWORD = process.env.ROADMAP_PASSWORD
if (!PASSWORD) { console.error('Missing ROADMAP_PASSWORD in environment'); process.exit(1) }
const PROJECT_DIR = join(import.meta.dirname, '..')
const SA_PATH = join(PROJECT_DIR, 'firebase-service-account.json')

function decrypt(doc) {
  const buf = Buffer.from(doc.data, 'base64')
  const key = pbkdf2Sync(PASSWORD, Buffer.from(doc.salt, 'base64'), 600000, 32, 'sha256')
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(doc.iv, 'base64'))
  decipher.setAuthTag(buf.subarray(buf.length - 16))
  return Buffer.concat([decipher.update(buf.subarray(0, buf.length - 16)), decipher.final()]).toString('utf-8')
}

console.log('=== Firebase Changelog Inspector ===\n')

const serviceAccount = JSON.parse(readFileSync(SA_PATH, 'utf-8'))
initializeApp({ credential: cert(serviceAccount) })
const db = getFirestore()

// Read changelog
const doc = await db.collection('encrypted').doc('changelog').get()
if (!doc.exists) {
  console.log('No changelog document found in Firebase!')
  process.exit(0)
}

const changelog = JSON.parse(decrypt(doc.data()))
console.log('Total changelog entries:', changelog.length)

// Count by user
const byUser = {}
for (const entry of changelog) {
  const user = entry.user || '(unknown)'
  byUser[user] = (byUser[user] || 0) + 1
}
console.log('\nEntries per user:')
for (const [user, count] of Object.entries(byUser).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${user}: ${count}`)
}

// Date range
const timestamps = changelog.map(e => e.timestamp).filter(Boolean).sort()
console.log('\nDate range:')
console.log('  Earliest:', timestamps[0])
console.log('  Latest:', timestamps[timestamps.length - 1])

// Count by date
const byDate = {}
for (const entry of changelog) {
  if (!entry.timestamp) continue
  const date = entry.timestamp.substring(0, 10)
  byDate[date] = (byDate[date] || 0) + 1
}
console.log('\nEntries per date:')
for (const [date, count] of Object.entries(byDate).sort()) {
  console.log(`  ${date}: ${count}`)
}
