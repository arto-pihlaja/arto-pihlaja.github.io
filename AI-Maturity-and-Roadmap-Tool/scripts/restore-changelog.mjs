#!/usr/bin/env node
/**
 * Restore missing changelog entries from a backup Excel file into Firebase.
 * Reads the Muutoshistoria sheet, merges with existing Firebase changelog,
 * and saves back — preserving all existing entries and adding missing ones.
 */

import 'dotenv/config'
import { initializeApp, cert } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { readFileSync } from 'fs'
import { join } from 'path'
import { randomBytes, pbkdf2Sync, createCipheriv, createDecipheriv } from 'crypto'
import ExcelJS from 'exceljs'

const PASSWORD = process.env.ROADMAP_PASSWORD
if (!PASSWORD) { console.error('Missing ROADMAP_PASSWORD in environment'); process.exit(1) }
const PROJECT_DIR = join(import.meta.dirname, '..')
const SA_PATH = join(PROJECT_DIR, 'firebase-service-account.json')
// Update this path to point to your Excel backup file
const XLSX_PATH = join(PROJECT_DIR, 'Data/backup.xlsx')

function encrypt(plaintext) {
  const salt = randomBytes(16)
  const iv = randomBytes(12)
  const key = pbkdf2Sync(PASSWORD, salt, 600000, 32, 'sha256')
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final(), cipher.getAuthTag()])
  return { salt: salt.toString('base64'), iv: iv.toString('base64'), data: encrypted.toString('base64') }
}

function decrypt(doc) {
  const buf = Buffer.from(doc.data, 'base64')
  const key = pbkdf2Sync(PASSWORD, Buffer.from(doc.salt, 'base64'), 600000, 32, 'sha256')
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(doc.iv, 'base64'))
  decipher.setAuthTag(buf.subarray(buf.length - 16))
  return Buffer.concat([decipher.update(buf.subarray(0, buf.length - 16)), decipher.final()]).toString('utf-8')
}

console.log('=== Changelog Restore ===\n')

// 1. Read Excel backup
console.log('1. Reading Excel backup...')
const workbook = new ExcelJS.Workbook()
await workbook.xlsx.readFile(XLSX_PATH)
const sheet = workbook.worksheets.find(s => s.name.includes('Muutoshistoria'))
if (!sheet) { console.error('Muutoshistoria sheet not found!'); process.exit(1) }

const headers = []
sheet.getRow(1).eachCell((cell, col) => { headers[col] = String(cell.value || '').trim() })

const excelEntries = []
for (let r = 2; r <= sheet.rowCount; r++) {
  const row = sheet.getRow(r)
  const obj = {}
  let hasData = false
  sheet.getRow(1).eachCell((cell, col) => {
    const key = headers[col]
    const val = row.getCell(col).value
    if (key && val !== null && val !== undefined && val !== '') { obj[key] = val; hasData = true }
  })
  if (hasData) excelEntries.push(obj)
}

// Convert Excel rows to changelog format
const excelChangelog = excelEntries.map(e => ({
  timestamp: String(e['Aikaleima (ISO 8601)'] || ''),
  user: String(e['Käyttäjä'] || ''),
  useCaseId: Number(e['Käyttötapaus ID']),
  useCaseName: String(e['Käyttötapaus'] || ''),
  field: String(e['Kenttä'] || ''),
  oldValue: e['Vanha arvo'] !== undefined ? String(e['Vanha arvo']) : '',
  newValue: e['Uusi arvo'] !== undefined ? String(e['Uusi arvo']) : ''
}))

console.log(`   Excel entries: ${excelChangelog.length}`)

// 2. Read current Firebase changelog
console.log('2. Reading current Firebase changelog...')
const serviceAccount = JSON.parse(readFileSync(SA_PATH, 'utf-8'))
initializeApp({ credential: cert(serviceAccount) })
const db = getFirestore()

const doc = await db.collection('encrypted').doc('changelog').get()
let firebaseChangelog = []
if (doc.exists) {
  firebaseChangelog = JSON.parse(decrypt(doc.data()))
}
console.log(`   Firebase entries: ${firebaseChangelog.length}`)

// 3. Merge: add Excel entries that are missing from Firebase
console.log('3. Merging...')
const existingKeys = new Set(firebaseChangelog.map(e => `${e.timestamp}|${e.useCaseId}|${e.field}|${e.user}`))

let added = 0
for (const entry of excelChangelog) {
  const key = `${entry.timestamp}|${entry.useCaseId}|${entry.field}|${entry.user}`
  if (!existingKeys.has(key)) {
    firebaseChangelog.push(entry)
    existingKeys.add(key)
    added++
  }
}

// Sort by timestamp
firebaseChangelog.sort((a, b) => (a.timestamp || '').localeCompare(b.timestamp || ''))

console.log(`   Added ${added} missing entries`)
console.log(`   Total after merge: ${firebaseChangelog.length}`)

// 4. Save merged changelog to Firebase
console.log('\n4. Saving merged changelog to Firebase...')
const json = JSON.stringify(firebaseChangelog)
const encrypted = encrypt(json)
encrypted.collection = 'changelog'
encrypted.updatedAt = new Date().toISOString()
await db.collection('encrypted').doc('changelog').set(encrypted)

// 5. Verify roundtrip
console.log('5. Verifying...')
const verifyDoc = await db.collection('encrypted').doc('changelog').get()
const verified = JSON.parse(decrypt(verifyDoc.data()))
if (verified.length === firebaseChangelog.length) {
  console.log(`   ✓ Verified: ${verified.length} entries in Firebase`)
} else {
  console.error(`   ✗ MISMATCH: expected ${firebaseChangelog.length}, got ${verified.length}`)
  process.exit(1)
}

// Also save backup
console.log('6. Saving backup copy...')
const backupEncrypted = encrypt(json)
backupEncrypted.collection = 'changelog_backup_a'
backupEncrypted.updatedAt = new Date().toISOString()
await db.collection('encrypted').doc('changelog_backup_a').set(backupEncrypted)
console.log('   ✓ Backup saved')

console.log('\n=== Restore complete! ===')
