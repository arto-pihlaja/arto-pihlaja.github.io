#!/usr/bin/env node
/**
 * Extract all data from index.html, encrypt, and upload to Firestore.
 *
 * Collections uploaded (each as a separate encrypted document):
 *   useCases, colorMap, maturityDims, axisLabels,
 *   categoryColorMap, miroImages, miroGroups, riceCriteria
 */

import 'dotenv/config'
import { initializeApp, cert } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { readFileSync } from 'fs'
import { join } from 'path'
import { randomBytes, pbkdf2Sync, createCipheriv, createDecipheriv } from 'crypto'

// ── Config ──────────────────────────────────────────────────────────
const PASSWORD = process.env.ROADMAP_PASSWORD
if (!PASSWORD) { console.error('Missing ROADMAP_PASSWORD in environment'); process.exit(1) }
const PROJECT_DIR = join(import.meta.dirname, '..')
const SA_PATH = join(PROJECT_DIR, 'firebase-service-account.json')
const COLLECTION = 'encrypted'
// ────────────────────────────────────────────────────────────────────

function encrypt(plaintext) {
  const salt = randomBytes(16)
  const iv = randomBytes(12)
  const key = pbkdf2Sync(PASSWORD, salt, 600000, 32, 'sha256')
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final(), cipher.getAuthTag()])
  return {
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    data: encrypted.toString('base64')
  }
}

function decrypt(doc) {
  const buf = Buffer.from(doc.data, 'base64')
  const key = pbkdf2Sync(PASSWORD, Buffer.from(doc.salt, 'base64'), 600000, 32, 'sha256')
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(doc.iv, 'base64'))
  decipher.setAuthTag(buf.subarray(buf.length - 16))
  return Buffer.concat([decipher.update(buf.subarray(0, buf.length - 16)), decipher.final()]).toString('utf-8')
}

// ── Extract data from index.html ──────────────────────────────────
console.log('=== Firebase Upload ===\n')
console.log('1. Reading index.html and extracting data...')

const html = readFileSync(join(PROJECT_DIR, 'index.html'), 'utf-8')

// Extract a JS block between markers using regex
function extractBlock(varName, isArray) {
  const open = isArray ? '\\[' : '\\{'
  const close = isArray ? '\\]' : '\\}'
  const re = new RegExp(`const\\s+${varName}\\s*=\\s*${open}`, 'm')
  const match = re.exec(html)
  if (!match) throw new Error(`Could not find "const ${varName}" in index.html`)

  const startIdx = match.index + match[0].length - 1
  let depth = 1
  let i = startIdx + 1
  while (i < html.length && depth > 0) {
    const ch = html[i]
    if (ch === (isArray ? '[' : '{')) depth++
    else if (ch === (isArray ? ']' : '}')) depth--
    else if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch
      i++
      while (i < html.length && html[i] !== quote) {
        if (html[i] === '\\') i++
        i++
      }
    }
    i++
  }

  const block = html.substring(startIdx, i)
  try {
    return new Function(`return (${block})`)()
  } catch (err) {
    throw new Error(`Failed to parse ${varName}: ${err.message}`)
  }
}

const collections = {
  useCases:         { data: extractBlock('useCases', true),         type: 'array' },
  colorMap:         { data: extractBlock('colorMap', false),        type: 'object' },
  maturityDims:     { data: extractBlock('maturityDims', false),    type: 'object' },
  axisLabels:       { data: extractBlock('axisLabels', false),      type: 'object' },
  categoryColorMap: { data: extractBlock('categoryColorMap', false),type: 'object' },
  miroImages:       { data: extractBlock('miroImages', true),       type: 'array' },
  miroGroups:       { data: extractBlock('miroGroups', true),       type: 'array' },
  riceCriteria:     { data: extractBlock('riceCriteria', false),    type: 'object' },
}

for (const [name, col] of Object.entries(collections)) {
  const count = Array.isArray(col.data) ? col.data.length + ' items' : Object.keys(col.data).length + ' keys'
  console.log(`   ✓ ${name}: ${count}`)
}

// ── Connect to Firestore ──────────────────────────────────────────
console.log('\n2. Connecting to Firestore...')
const serviceAccount = JSON.parse(readFileSync(SA_PATH, 'utf-8'))
initializeApp({ credential: cert(serviceAccount) })
const db = getFirestore()
console.log('   Connected to:', serviceAccount.project_id)

// ── Encrypt and upload ────────────────────────────────────────────
console.log('\n3. Encrypting and uploading...')

for (const [name, col] of Object.entries(collections)) {
  const json = JSON.stringify(col.data)
  const encrypted = encrypt(json)
  encrypted.updatedAt = new Date().toISOString()
  encrypted.collection = name

  await db.collection(COLLECTION).doc(name).set(encrypted)

  // Verify roundtrip
  const doc = await db.collection(COLLECTION).doc(name).get()
  const decrypted = decrypt(doc.data())
  const parsed = JSON.parse(decrypted)
  const ok = JSON.stringify(parsed) === json
  console.log(`   ${ok ? '✓' : '✗'} ${name}: ${(json.length / 1024).toFixed(1)} KB → ${(encrypted.data.length / 1024).toFixed(1)} KB encrypted ${ok ? '(verified)' : '(MISMATCH!)'}`)
  if (!ok) { console.error('ERROR: roundtrip failed for', name); process.exit(1) }
}

console.log('\n=== Upload complete! All collections encrypted and verified. ===')
