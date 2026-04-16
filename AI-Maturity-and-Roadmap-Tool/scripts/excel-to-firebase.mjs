#!/usr/bin/env node
/**
 * Read data from an Excel file (input_data/) and upload to Firebase Firestore.
 *
 * Maps:
 *   - Käyttötapaukset sheet → useCases, colorMap, maturityDims, axisLabels, categoryColorMap
 *   - RICE-kriteerit sheet → riceCriteria
 *   - Muutoshistoria sheet → changelog
 *   - Teema (Aikataulu) column → timelineLanes
 */

import 'dotenv/config'
import { initializeApp, cert } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { readFileSync } from 'fs'
import { join } from 'path'
import { randomBytes, pbkdf2Sync, createCipheriv, createDecipheriv } from 'crypto'
import ExcelJS from 'exceljs'

// ── Config ──────────────────────────────────────────────────────────
const PASSWORD = process.env.ROADMAP_PASSWORD
if (!PASSWORD) { console.error('Missing ROADMAP_PASSWORD in environment'); process.exit(1) }
const PROJECT_DIR = join(import.meta.dirname, '..')
const SA_PATH = join(PROJECT_DIR, 'firebase-service-account.json')
const EXCEL_PATH = join(PROJECT_DIR, 'input_data', 'ai_roadmap_demo.xlsx')
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

// ── competitionStatus → color mapping ───────────────────────────────
const STATUS_TO_COLOR = {
  'Kilpailuetu': 'Vihrea',
  'Hygieniatekijä': 'Keltainen',
  'Ei arvioitu': 'Harmaa',
  'Vähäinen strateginen vaikutus': 'Sininen'
}

function num(val) {
  if (val === null || val === undefined || val === '') return 0
  const n = Number(val)
  return isNaN(n) ? 0 : n
}

function str(val) {
  if (val === null || val === undefined) return ''
  return String(val)
}

// ── Read Excel ──────────────────────────────────────────────────────
console.log('=== Excel → Firebase Upload ===\n')
console.log(`1. Reading ${EXCEL_PATH}...`)

const workbook = new ExcelJS.Workbook()
await workbook.xlsx.readFile(EXCEL_PATH)

// ── Parse Käyttötapaukset ───────────────────────────────────────────
const usSheet = workbook.getWorksheet('Käyttötapaukset')
const useCases = []
const categories = new Set()
const timelineLaneNames = new Set()

usSheet.eachRow((row, rowNumber) => {
  if (rowNumber <= 3) return // skip title, blank, header rows
  const id = row.getCell(1).value
  if (id === null || id === undefined) return

  const competitionStatus = str(row.getCell(9).value)
  const color = STATUS_TO_COLOR[competitionStatus] || 'Harmaa'
  const category = str(row.getCell(4).value)
  const timelineLane = str(row.getCell(39).value) // AM column = 39

  if (category) categories.add(category)
  if (timelineLane) timelineLaneNames.add(timelineLane)

  useCases.push({
    id: num(id),
    tyyppi: str(row.getCell(2).value) || 'AI Käyttötapaus',
    roadmapPhase: str(row.getCell(3).value) || 'Ei aikataulutettu',
    timelineLane: timelineLane,
    category: category,
    usecase: str(row.getCell(5).value),
    shortDescription: str(row.getCell(6).value),
    description: str(row.getCell(7).value),
    comments: str(row.getCell(8).value),
    competitionStatus: competitionStatus,
    color: color,
    human: num(row.getCell(10).value),
    impact: num(row.getCell(11).value),
    combinedImpact: num(row.getCell(12).value),
    reach: num(row.getCell(13).value),
    confidence: num(row.getCell(14).value),
    effort: num(row.getCell(15).value),
    costs: num(row.getCell(16).value),
    vertailuluku: num(row.getCell(17).value),
    buildVsBuy: num(row.getCell(18).value),
    aiRoleNum: num(row.getCell(19).value),
    aiRoleLabel: str(row.getCell(20).value),
    maturityDimension: str(row.getCell(21).value),
    tenXPotential: str(row.getCell(22).value),
    tenXScore: num(row.getCell(23).value),
    buildCapability: str(row.getCell(24).value),
    feasibilityComments: str(row.getCell(25).value),
    riskComments: str(row.getCell(26).value),
    criticalHypotheses: str(row.getCell(27).value),
    nextSteps: str(row.getCell(28).value),
    impactA: num(row.getCell(29).value),
    impactD: num(row.getCell(30).value),
    impactE: num(row.getCell(31).value),
    impactJ: num(row.getCell(32).value),
    impactK: num(row.getCell(33).value),
  })
})

console.log(`   ✓ useCases: ${useCases.length} items`)

// ── Parse RICE-kriteerit (optional sheet) ──────────────────────────
const riceSheet = workbook.getWorksheet('RICE-kriteerit')
const riceCriteria = { reach: [], impact: [], confidence: [], effort: [] }

if (riceSheet) {
  riceSheet.eachRow((row, rowNumber) => {
    if (rowNumber <= 3) return // skip title rows
    const category = str(row.getCell(1).value).toLowerCase()
    const value = num(row.getCell(2).value)
    const label = str(row.getCell(3).value)
    const description = str(row.getCell(4).value)

    if (riceCriteria[category]) {
      riceCriteria[category].push({ value, label, description })
    }
  })
  console.log(`   ✓ riceCriteria: ${Object.keys(riceCriteria).map(k => `${k}:${riceCriteria[k].length}`).join(', ')}`)
} else {
  console.log(`   ⓘ riceCriteria: sheet "RICE-kriteerit" not found, using empty defaults`)
}

// ── Parse Muutoshistoria → changelog (optional sheet) ──────────────
const histSheet = workbook.getWorksheet('Muutoshistoria')
const changelog = []

if (histSheet) {
  histSheet.eachRow((row, rowNumber) => {
    if (rowNumber <= 1) return // skip header
    const timestamp = str(row.getCell(1).value)
    if (!timestamp) return

    changelog.push({
      timestamp: timestamp,
      user: str(row.getCell(2).value),
      useCaseId: num(row.getCell(3).value),
      useCaseName: str(row.getCell(4).value),
      field: str(row.getCell(5).value),
      oldValue: str(row.getCell(6).value),
      newValue: str(row.getCell(7).value)
    })
  })
  console.log(`   ✓ changelog: ${changelog.length} entries`)
} else {
  console.log(`   ⓘ changelog: sheet "Muutoshistoria" not found, uploading empty`)
}

// ── Build supporting collections ────────────────────────────────────

// colorMap
const colorMap = {
  'Vihreä': '#22c55e',
  'Keltainen': '#eab308',
  'Harmaa': '#9ca3af',
  'Sininen': '#3b82f6'
}
console.log(`   ✓ colorMap: ${Object.keys(colorMap).length} keys`)

// maturityDims
const maturityDims = {
  A: { letter: 'A', name: 'Asiakaskokemus', color: '#ef4444' },
  D: { letter: 'D', name: 'Data & infra', color: '#3b82f6' },
  E: { letter: 'E', name: 'Ekosysteemi', color: '#10b981' },
  J: { letter: 'J', name: 'Johtaminen', color: '#f59e0b' },
  K: { letter: 'K', name: 'Kapasiteetti', color: '#8b5cf6' }
}
console.log(`   ✓ maturityDims: ${Object.keys(maturityDims).length} keys`)

// axisLabels
const axisLabels = {
  impact: 'Impact (vaikuttavuus)',
  reach: 'Reach (laajuus)',
  human: 'Human (inhimillinen)',
  confidence: 'Confidence (luottamus)',
  effort: 'Effort (työmäärä)',
  combinedImpact: 'Yhdistetty vaikuttavuus',
  costs: 'Kustannukset (k€)',
  vertailuluku: 'Vertailuluku'
}
console.log(`   ✓ axisLabels: ${Object.keys(axisLabels).length} keys`)

// categoryColorMap
const catColors = ['#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899']
const categoryColorMap = {}
for (const [i, cat] of [...categories].sort().entries()) {
  categoryColorMap[cat] = catColors[i % catColors.length]
}
console.log(`   ✓ categoryColorMap: ${Object.keys(categoryColorMap).length} keys`)

// timelineLanes
const timelineLanes = [...timelineLaneNames].sort().map((name, i) => ({
  id: `lane_${i + 1}`,
  name: name
}))
console.log(`   ✓ timelineLanes: ${timelineLanes.length} lanes`)

// ── Connect to Firestore ──────────────────────────────────────────
console.log('\n2. Connecting to Firestore...')
const serviceAccount = JSON.parse(readFileSync(SA_PATH, 'utf-8'))
initializeApp({ credential: cert(serviceAccount) })
const db = getFirestore()
console.log('   Connected to:', serviceAccount.project_id)

// ── Encrypt and upload ────────────────────────────────────────────
console.log('\n3. Encrypting and uploading...')

const collections = {
  useCases,
  colorMap,
  maturityDims,
  axisLabels,
  categoryColorMap,
  riceCriteria,
  timelineLanes,
  miroImages: [],     // no miro images in Excel
  miroGroups: [],     // no miro groups in Excel
  categoryTimelines: {}
}

for (const [name, data] of Object.entries(collections)) {
  const json = JSON.stringify(data)
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

// Upload changelog separately (can be large, stored in dedicated doc)
console.log('\n4. Uploading changelog...')
const clJson = JSON.stringify(changelog)
const clEncrypted = encrypt(clJson)
clEncrypted.updatedAt = new Date().toISOString()
clEncrypted.collection = 'changelog'
await db.collection(COLLECTION).doc('changelog').set(clEncrypted)

// Verify
const clDoc = await db.collection(COLLECTION).doc('changelog').get()
const clDecrypted = decrypt(clDoc.data())
const clOk = JSON.stringify(JSON.parse(clDecrypted)) === clJson
console.log(`   ${clOk ? '✓' : '✗'} changelog: ${(clJson.length / 1024).toFixed(1)} KB → ${(clEncrypted.data.length / 1024).toFixed(1)} KB encrypted ${clOk ? '(verified)' : '(MISMATCH!)'}`)

console.log('\n=== Upload complete! All collections encrypted and verified. ===')
console.log('\nRefresh the app in browser and log in to see the data.')
