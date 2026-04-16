# Firebase-tietokannan alustusohje

## 1. Luo Firebase-projekti

1. Mene [Firebase Console](https://console.firebase.google.com/)
2. Klikkaa **Add project** / **Lisää projekti**
3. Anna projektin nimi (esim. `ai-roadmap-tool`)
4. Voit kytkeä Google Analyticsin pois (ei tarvita)
5. Klikkaa **Create project**

## 2. Luo Firestore-tietokanta

1. Firebase Consolessa, valitse **Build > Firestore Database**
2. Klikkaa **Create database**
3. Valitse **Start in production mode**
4. Valitse sijainti: `europe-west1` (Belgia) tai `europe-west3` (Frankfurt)
5. Klikkaa **Enable**

## 3. Aseta Firestore-säännöt

Firebase Console > Firestore > Rules -välilehdellä, korvaa oletussäännöt:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /encrypted/{document=**} {
      allow read, write: if true;
    }
  }
}
```

> **Huom:** Nämä säännöt sallivat kaikki luku- ja kirjoitusoperaatiot. Data on kuitenkin AES-256-GCM -salattu, joten tietokannasta luettu data on hyödytöntä ilman salasanaa. Tämä on tietoinen valinta yksinkertaisuuden vuoksi.

## 4. Luo Web App -konfiguraatio

1. Firebase Console > Project Settings (hammasratas-ikoni)
2. Scrollaa alas kohtaan **Your apps**
3. Klikkaa **Web** (</>-ikoni)
4. Anna sovellukselle nimi (esim. `ai-roadmap-web`)
5. **Älä** kytke Firebase Hostingia päälle
6. Kopioi `firebaseConfig`-objekti

Päivitä `index.html` -tiedoston Firebase-konfiguraatio (rivi ~1936):

```javascript
const firebaseConfig = {
  apiKey: "...",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.firebasestorage.app",
  messagingSenderId: "...",
  appId: "..."
};
```

## 5. Luo Service Account (Node.js-skriptejä varten)

1. Firebase Console > Project Settings > **Service accounts** -välilehti
2. Klikkaa **Generate new private key**
3. Tallenna ladattu JSON-tiedosto projektin juureen nimellä:
   ```
   firebase-service-account.json
   ```
4. Tämä tiedosto on `.gitignore`:ssa — **älä koskaan committoi sitä repoon!**

## 6. Alusta data (valinnainen)

Kun Firebase on konfiguroitu, voit alustaa tyhjän tietokannan suorittamalla:

```bash
npm install
node scripts/firebase-test.mjs
```

Tämä testaa yhteyden ja salauksen toimivuuden.

Jos haluat ladata dataa index.html:stä Firebaseen:

```bash
node scripts/firebase-upload.mjs
```

## 7. Firestore-kokoelmarakenne

Sovellus käyttää yhtä `encrypted`-kokoelmaa, jossa jokainen dokumentti on salattu AES-256-GCM:llä:

| Dokumentti | Sisältö |
|---|---|
| `useCases` | AI-käyttötapaukset (array) |
| `colorMap` | Värikonfiguraatio (object) |
| `maturityDims` | Maturiteettiulottuvuudet (object) |
| `axisLabels` | Kaavion akselien nimet (object) |
| `categoryColorMap` | Kategorioiden värit (object) |
| `miroImages` | Miro-kuvakaappaukset base64:nä (array) |
| `miroGroups` | Miro-ryhmät (array) |
| `riceCriteria` | RICE-priorisointikriteerit (object) |
| `changelog` | Muutoshistoria (array) |
| `changelogArchive` | Vanhempi muutoshistoria (array) |
| `feedback` | Kehitysehdotukset (array) |
| `presence` | Käyttäjien läsnäolotiedot (object) |
| `timelineLanes` | Aikataulun teemat/kaistat (array) |
| `timelineConfig` | Aikataulun asetukset (object) |

Jokainen dokumentti sisältää:
- `salt` — PBKDF2-suolaus (base64)
- `iv` — AES-GCM initialization vector (base64)
- `data` — Salattu data (base64)
- `updatedAt` — Viimeisin päivitysaikaleima

## 8. Deploy (GitHub Pages)

Kun haluat julkaista salatun version:

1. Luo GitHub-repo nimellä `ai-roadmap-tool`
2. Aja: `node scripts/deploy.mjs`
3. Commitoi ja pushaa `ai-roadmap-tool`-repoon
4. GitHub > Settings > Pages > Source: Deploy from a branch > `main` / `root`
