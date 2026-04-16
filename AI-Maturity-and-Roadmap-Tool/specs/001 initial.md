
# Refactor code #

Tehtäväsi on lukea lähdekoodi täältä:
<hakemisto>

Sinun tehtäväsi on luoda ohjelmistosta yleisempi kopio tähän hakemistoon noudattaen seuraavia periaatteita:
1) Et saa käyttää firebase tietokantaa joka on konfiguroitu alkuperäiseen ohjelmistoon. Tätä varten pitää luoda uusi firebase tietokanta ja konfiguroida se tähän ohjelmistoon sopivaksi.
2) Et saa missään kohtaan kertoa, että kyse on Pihlajalinnan ohjelmistosta vaan tämä pitää korvata jollain asiakasyritykseen viittaavalla
3) Muuta brändi siten että se näyttää Siili Solutions yrityksen verkkobrändiltä
4) Koko lähdekoodi pitää sijaita nyt tässä hakemistossa jossa nyt olet

Onko jotain kysymyksiä ennen kuin teet ensimmäisen version?


# Vastauksia #

Nimi voisi viitata johonkin terveystoimijaan, voi olla hyvinvointialueeseen liittyvä. Käytä brändissä siilin osalta kohtuullisen vaaleaa dataa. Salasana on ROADMAP_PASSWORD-ympäristömuuttujassa (.env-tiedostossa) jota voit käyttää kryptaukseen liittyvän skriptin kopioinnissa. Mutta kohdehakemisto Github tilissä pitäisi olla ai-roadmap-tool nykyisen ai-demo sijaan. Data: tee tyhjä firebase konfiguraatio. Toimitan sinulle avaimet jne mutta älä kopioi dataa. Tarvitsen sinulta tiedon miten alustan firebase tietokannan.  

# Firestore #

Basic configuration:

<script type="module">
  // Import the functions you need from the SDKs you need
  import { initializeApp } from "https://www.gstatic.com/firebasejs/12.12.0/firebase-app.js";
  import { getAnalytics } from "https://www.gstatic.com/firebasejs/12.12.0/firebase-analytics.js";
  // TODO: Add SDKs for Firebase products that you want to use
  // https://firebase.google.com/docs/web/setup#available-libraries

  // Your web app's Firebase configuration
  // For Firebase JS SDK v7.20.0 and later, measurementId is optional
  const firebaseConfig = {
    apiKey: <redacted>,
    authDomain: "fir-ai-roadmap.firebaseapp.com",
    projectId: "fir-ai-roadmap",
    storageBucket: "fir-ai-roadmap.firebasestorage.app",
    messagingSenderId: "125389369558",
    appId: <redacted>,
    measurementId: "G-YPC3Q18EGE"
  };

  // Initialize Firebase
  const app = initializeApp(firebaseConfig);
  const analytics = getAnalytics(app);
</script>


More:

rules_version = '2';

service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if false;
    }
  }
}


{
  "type": "service_account",
  "project_id": "fir-ai-roadmap",
  "client_email": "firebase-adminsdk-fbsvc@fir-ai-roadmap.iam.gserviceaccount.com",
  "client_id": "100704120983678770777",
  "auth_uri": "https://accounts.google.com/o/oauth2/auth",
  "token_uri": "https://oauth2.googleapis.com/token",
  "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
  "client_x509_cert_url": "https://www.googleapis.com/robot/v1/metadata/x509/firebase-adminsdk-fbsvc%40fir-ai-roadmap.iam.gserviceaccount.com",
  "universe_domain": "googleapis.com"
}



# Varmistukset # 

Lue toteutus uudestaan läpi ja varmista, ettei missään puhuta pihlajalinna yrityksestä

