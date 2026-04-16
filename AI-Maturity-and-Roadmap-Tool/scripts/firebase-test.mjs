#!/usr/bin/env node
/**
 * Firebase connectivity + encryption roundtrip test.
 *
 * 1. Connects to Firestore via service account
 * 2. Encrypts test data with the app password (AES-256-GCM, PBKDF2)
 * 3. Writes encrypted blob to Firestore
 * 4. Reads it back
 * 5. Decrypts and verifies roundtrip
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
// ────────────────────────────────────────────────────────────────────

console.log('=== Firebase Test ===\n')

// 1. Connect
console.log('1. Connecting to Firestore...')
const serviceAccount = JSON.parse(readFileSync(SA_PATH, 'utf-8'))
initializeApp({ credential: cert(serviceAccount) })
const db = getFirestore()
console.log('   Connected to project:', serviceAccount.project_id)

// 2. Encrypt test data
console.log('2. Encrypting test data...')
const testData = JSON.stringify({
  test: true,
  timestamp: new Date().toISOString(),
  message: 'Tämä on testitietue – ääkköset ja erikoismerkit toimivat!'
})

const salt = randomBytes(16)
const iv = randomBytes(12)
const key = pbkdf2Sync(PASSWORD, salt, 600000, 32, 'sha256')
const cipher = createCipheriv('aes-256-gcm', key, iv)
const encrypted = Buffer.concat([cipher.update(testData, 'utf-8'), cipher.final(), cipher.getAuthTag()])

const payload = {
  salt: salt.toString('base64'),
  iv: iv.toString('base64'),
  data: encrypted.toString('base64'),
  createdAt: new Date().toISOString()
}
console.log('   Encrypted size:', payload.data.length, 'bytes')

// 3. Write to Firestore
console.log('3. Writing to Firestore (encrypted/test)...')
await db.collection('encrypted').doc('test').set(payload)
console.log('   ✓ Written')

// 4. Read back
console.log('4. Reading back from Firestore...')
const doc = await db.collection('encrypted').doc('test').get()
if (!doc.exists) {
  console.error('   ERROR: document not found!')
  process.exit(1)
}
const read = doc.data()
console.log('   ✓ Read back, encrypted size:', read.data.length, 'bytes')

// 5. Decrypt and verify
console.log('5. Decrypting and verifying...')
const rBuf = Buffer.from(read.data, 'base64')
const rKey = pbkdf2Sync(PASSWORD, Buffer.from(read.salt, 'base64'), 600000, 32, 'sha256')
const decipher = createDecipheriv('aes-256-gcm', rKey, Buffer.from(read.iv, 'base64'))
decipher.setAuthTag(rBuf.subarray(rBuf.length - 16))
const plain = Buffer.concat([decipher.update(rBuf.subarray(0, rBuf.length - 16)), decipher.final()]).toString('utf-8')
const parsed = JSON.parse(plain)

if (parsed.message === 'Tämä on testitietue – ääkköset ja erikoismerkit toimivat!') {
  console.log('   ✓ Roundtrip OK!')
  console.log('   Decrypted:', parsed)
} else {
  console.error('   ERROR: data mismatch!')
  console.error('   Got:', parsed)
  process.exit(1)
}

console.log('\n=== Firebase test PASSED ===')
