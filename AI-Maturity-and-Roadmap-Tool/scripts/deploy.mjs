#!/usr/bin/env node
/**
 * Encrypt and deploy the AI Roadmap & Maturity Tool demo.
 *
 * Usage: node scripts/deploy.mjs
 *
 * What it does:
 *   1. Reads index.html
 *   2. Reads miroImages metadata from Firebase, inlines screenshots as base64
 *   3. Embeds miroImages + miroGroups into the HTML so deployed version has images
 *   4. Encrypts with AES-256-GCM (PBKDF2 key derivation, 600k iterations)
 *   5. Wraps in a password-prompt HTML page
 *   6. Writes to the ai-roadmap-tool repo folder
 */

import 'dotenv/config'
import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { randomBytes, pbkdf2Sync, createCipheriv, createDecipheriv } from 'crypto'
import { initializeApp, cert } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

// ── Config ──────────────────────────────────────────────────────────
const PASSWORD = process.env.ROADMAP_PASSWORD
if (!PASSWORD) { console.error('Missing ROADMAP_PASSWORD in environment'); process.exit(1) }
const OUTPUT_DIR = '/Users/tapio.pitkaranta/Documents/GitHub/ai-roadmap-tool'
const PROJECT_DIR = join(import.meta.dirname, '..')
const SA_PATH = join(PROJECT_DIR, 'firebase-service-account.json')
// ────────────────────────────────────────────────────────────────────

function decryptFirebase(doc) {
  const buf = Buffer.from(doc.data, 'base64')
  const key = pbkdf2Sync(PASSWORD, Buffer.from(doc.salt, 'base64'), 600000, 32, 'sha256')
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(doc.iv, 'base64'))
  decipher.setAuthTag(buf.subarray(buf.length - 16))
  return Buffer.concat([decipher.update(buf.subarray(0, buf.length - 16)), decipher.final()]).toString('utf-8')
}

console.log('=== Deploy: AI Roadmap & Maturity Tool ===\n')

// 1. Read HTML
console.log('1. Reading index.html...')
let appHtml = readFileSync(join(PROJECT_DIR, 'index.html'), 'utf-8')
console.log('   HTML size:', (appHtml.length / 1024).toFixed(0), 'KB')

// 2. Connect to Firebase and read miroImages + miroGroups
console.log('2. Reading miroImages from Firebase...')
const serviceAccount = JSON.parse(readFileSync(SA_PATH, 'utf-8'))
initializeApp({ credential: cert(serviceAccount) })
const db = getFirestore()

const [miroImagesDoc, miroGroupsDoc] = await Promise.all([
  db.collection('encrypted').doc('miroImages').get(),
  db.collection('encrypted').doc('miroGroups').get(),
])
const miroImages = JSON.parse(decryptFirebase(miroImagesDoc.data()))
const miroGroups = JSON.parse(decryptFirebase(miroGroupsDoc.data()))
console.log('   Found', miroImages.length, 'images,', miroGroups.length, 'groups')

// 3. Inline screenshot files as base64 data URLs
console.log('3. Inlining Miro screenshots as base64...')
let totalImgSize = 0
for (const img of miroImages) {
  if (img.file.startsWith('data:')) {
    console.log('   ⏭ Already base64:', img.title)
    continue
  }
  const fullPath = join(PROJECT_DIR, img.file)
  try {
    const buffer = readFileSync(fullPath)
    const b64 = buffer.toString('base64')
    img.file = `data:image/png;base64,${b64}`
    totalImgSize += b64.length
    console.log('   ✓', img.title, '→', (b64.length / 1024).toFixed(0), 'KB base64')
  } catch (err) {
    console.error('   ✗ Failed to read:', fullPath, err.message)
    process.exit(1)
  }
}
console.log('   Total image data:', (totalImgSize / 1024 / 1024).toFixed(1), 'MB')

// 4. Embed miroImages and miroGroups into the HTML
console.log('4. Embedding miroImages data into HTML...')
const miroImagesJson = JSON.stringify(miroImages)
const miroGroupsJson = JSON.stringify(miroGroups)

appHtml = appHtml.replace(
  /let miroImages\s*=\s*\[\s*\]/,
  `let miroImages = ${miroImagesJson}`
)
appHtml = appHtml.replace(
  /let miroGroups\s*=\s*\[\s*\]/,
  `let miroGroups = ${miroGroupsJson}`
)
console.log('   HTML size with images:', (appHtml.length / 1024 / 1024).toFixed(1), 'MB')

// 5. Encrypt (AES-256-GCM, native crypto)
console.log('5. Encrypting...')
const salt = randomBytes(16)
const iv = randomBytes(12)
const key = pbkdf2Sync(PASSWORD, salt, 600000, 32, 'sha256')
const cipher = createCipheriv('aes-256-gcm', key, iv)
const encrypted = Buffer.concat([cipher.update(appHtml, 'utf-8'), cipher.final(), cipher.getAuthTag()])

const saltB64 = salt.toString('base64')
const ivB64 = iv.toString('base64')
const encB64 = encrypted.toString('base64')
console.log('   Encrypted size:', (encB64.length / 1024 / 1024).toFixed(1), 'MB')

// 6. Verify decryption roundtrip
console.log('6. Verifying...')
const vBuf = Buffer.from(encB64, 'base64')
const vKey = pbkdf2Sync(PASSWORD, Buffer.from(saltB64, 'base64'), 600000, 32, 'sha256')
const vDec = createDecipheriv('aes-256-gcm', vKey, Buffer.from(ivB64, 'base64'))
vDec.setAuthTag(vBuf.subarray(vBuf.length - 16))
const plain = Buffer.concat([vDec.update(vBuf.subarray(0, vBuf.length - 16)), vDec.final()]).toString('utf-8')
if (plain !== appHtml) { console.error('ERROR: verification failed'); process.exit(1) }
console.log('   OK – roundtrip verified')

// 7. Build the password page
console.log('7. Writing output...')

const loginPage = [
  '<!DOCTYPE html>',
  '<html lang="fi"><head>',
  '<meta charset="UTF-8">',
  '<meta name="viewport" content="width=device-width,initial-scale=1.0">',
  '<title>AI Roadmap Tool</title>',
  '<style>',
  '*{margin:0;padding:0;box-sizing:border-box}',
  'body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#f8fafc;min-height:100vh;display:flex;align-items:center;justify-content:center}',
  '.box{background:#fff;border-radius:16px;box-shadow:0 4px 24px rgba(0,0,0,.08);padding:48px;max-width:420px;width:90%;text-align:center}',
  '.icon{font-size:48px;margin-bottom:16px}',
  '.logo{font-size:28px;font-weight:700;color:#FF6B4A;margin-bottom:32px}',
  '.field{position:relative;margin-bottom:16px}',
  'input{width:100%;padding:14px 48px 14px 16px;border:2px solid #e2e8f0;border-radius:12px;font-size:16px;outline:none;transition:border-color .2s}',
  'input:focus{border-color:#FF6B4A}',
  '.eye{position:absolute;right:12px;top:50%;transform:translateY(-50%);background:none;border:none;cursor:pointer;color:#94a3b8;font-size:18px;padding:4px}',
  '.go{width:100%;padding:14px;background:#FF6B4A;color:#fff;border:none;border-radius:12px;font-size:16px;font-weight:600;cursor:pointer;transition:background .2s}',
  '.go:hover{background:#E5553A}.go:disabled{background:#94a3b8;cursor:not-allowed}',
  '.err{color:#dc2626;font-size:13px;margin-top:12px;display:none}',
  '.spin{display:inline-block;width:18px;height:18px;border:2px solid rgba(255,255,255,.3);border-top-color:#fff;border-radius:50%;animation:s .6s linear infinite;vertical-align:middle;margin-right:8px}',
  '@keyframes s{to{transform:rotate(360deg)}}',
  '</style>',
  '</head><body>',
  '<div class="box">',
  '  <div class="icon">\uD83D\uDD12</div>',
  '  <div class="logo">AI Roadmap Tool</div>',
  '  <form id="f">',
  '    <div class="field" style="margin-bottom:12px">',
  '      <input type="text" id="nm" placeholder="Etunimi tai nimimerkki" autocomplete="name" autofocus style="padding:14px 16px">',
  '    </div>',
  '    <div class="field">',
  '      <input type="password" id="pw" placeholder="Salasana" autocomplete="off">',
  '      <button type="button" class="eye" id="eye">\uD83D\uDC41</button>',
  '    </div>',
  '    <button type="submit" class="go" id="go">Avaa sovellus</button>',
  '  </form>',
  '  <div class="err" id="err">V\u00E4\u00E4r\u00E4 salasana. Yrit\u00E4 uudelleen.</div>',
  '  <div class="err" id="nerr" style="color:#dc2626">Anna etunimi tai nimimerkki.</div>',
  '</div>',
  '<script>',
  "var S='" + saltB64 + "',V='" + ivB64 + "',E='" + encB64 + "';",
  'function b(s){for(var a=atob(s),r=new Uint8Array(a.length),i=0;i<a.length;i++)r[i]=a.charCodeAt(i);return r}',
  'var f=document.getElementById("f"),nm=document.getElementById("nm"),pw=document.getElementById("pw"),go=document.getElementById("go"),err=document.getElementById("err"),nerr=document.getElementById("nerr");',
  '(function(){var s=localStorage.getItem("roadmap_username");if(s)nm.value=s})();',
  'document.getElementById("eye").onclick=function(){pw.type=pw.type==="password"?"text":"password"};',
  'f.onsubmit=function(e){',
  '  e.preventDefault();err.style.display="none";nerr.style.display="none";',
  '  if(!nm.value.trim()){nerr.style.display="block";nm.focus();return}',
  '  go.disabled=true;',
  '  go.innerHTML=\'<span class="spin"></span>Puretaan...\';',
  '  var t=new TextEncoder();',
  '  crypto.subtle.importKey("raw",t.encode(pw.value),"PBKDF2",false,["deriveKey"])',
  '  .then(function(km){return crypto.subtle.deriveKey({name:"PBKDF2",salt:b(S),iterations:600000,hash:"SHA-256"},km,{name:"AES-GCM",length:256},false,["decrypt"])})',
  '  .then(function(k){return crypto.subtle.decrypt({name:"AES-GCM",iv:b(V)},k,b(E))})',
  '  .then(function(buf){',
  '    var h=new TextDecoder().decode(buf);',
  '    window.__deployPassword=pw.value;window.__deployUser=nm.value.trim();',
  '    localStorage.setItem("roadmap_username",nm.value.trim());',
  '    document.open();document.write(h);document.close();',
  '  })',
  '  .catch(function(){err.style.display="block";go.disabled=false;go.textContent="Avaa demo";pw.select()});',
  '};',
  '</script>',
  '</body></html>',
].join('\n')

mkdirSync(OUTPUT_DIR, { recursive: true })
writeFileSync(join(OUTPUT_DIR, 'index.html'), loginPage)
writeFileSync(join(OUTPUT_DIR, '.nojekyll'), '')

console.log('\n=== Done! ===')
console.log('Output:', join(OUTPUT_DIR, 'index.html'))
console.log('Size:', (loginPage.length / 1024 / 1024).toFixed(1), 'MB')
console.log('Next: commit & push the ai-roadmap-tool repo, then enable GitHub Pages.')
