/* =========================================================================
   Pixelkiez — Formular-Gegenstelle

   Nimmt die Anfrage aus dem Kontaktformular als JSON entgegen und stellt sie
   per SMTP ins Postfach zu. Absender ist das eigene Postfach, Antwortadresse
   die des Interessenten — ein Klick auf "Antworten" geht damit direkt an ihn.

   Bewusst ohne Framework: eine Route, eine Aufgabe. Jede Abhaengigkeit hier
   waere eine Angriffsflaeche mehr auf dem Weg zwischen Kunde und Postfach.

   Konfiguration ausschliesslich ueber Umgebungsvariablen — im Code steht
   kein einziges Geheimnis:

     SMTP_HOST      z. B. smtp.ionos.de
     SMTP_PORT      465 (implizites TLS) oder 587 (STARTTLS)
     SMTP_USER      das Postfach, ueber das versendet wird
     SMTP_PASS      dessen Kennwort
     MAIL_TO        wohin die Anfrage geht
     MAIL_FROM      Absenderadresse, muss zur SMTP-Domain passen
     ALLOWED_ORIGIN erlaubte Herkunft, z. B. https://pixelkiez.de
     PORT           von Railway gesetzt

   Fehlen SMTP_HOST oder MAIL_TO, weist der Dienst Anfragen mit 503 ab. Das
   Formular zeigt dann die Adresse zum direkten Anschreiben. Eine Erfolgs-
   meldung ohne Zustellung gibt es bewusst nicht — eine lautlos verlorene
   Anfrage waere schlimmer als eine sichtbar gescheiterte.
   MAIL_DRYRUN=1 nimmt zu Testzwecken an, ohne zu versenden.
   ========================================================================= */

import { createServer } from 'node:http';
import { setDefaultResultOrder } from 'node:dns';
import { lookup } from 'node:dns/promises';
import net from 'node:net';
import nodemailer from 'nodemailer';

/* IPv4 erzwingen.

   Der Container hat keine Route ins IPv6-Netz. Hostingers Mailserver liegt
   hinter Cloudflare und hat eine AAAA-Adresse; der Verbindungsversuch dorthin
   endet in ENETUNREACH oder einem Timeout — auf jedem Port. Im Protokoll
   sieht das aus wie ein falsches Kennwort, dabei hat die Anmeldung nie
   stattgefunden.

   Drei Riegel, weil einer allein nicht reicht:
     · ipv4first sortiert die Aufloesung, aber Node 20+ probiert seit
       "Happy Eyeballs" beide Familien PARALLEL — der IPv6-Versuch lief also
       trotzdem und schlug durch;
     · autoSelectFamily(false) schaltet genau dieses Parallelprobieren ab;
     · family:4 am Transport (weiter unten) schliesst IPv6 endgueltig aus.

   Muss vor dem ersten Verbindungsaufbau stehen. */
setDefaultResultOrder('ipv4first');
if (typeof net.setDefaultAutoSelectFamily === 'function') {
  net.setDefaultAutoSelectFamily(false);
}

const PORT           = Number(process.env.PORT || 3000);
const SMTP_HOST      = process.env.SMTP_HOST || '';
const SMTP_PORT      = Number(process.env.SMTP_PORT || 465);
const SMTP_USER      = process.env.SMTP_USER || '';
const SMTP_PASS      = process.env.SMTP_PASS || '';
const RESEND_KEY     = process.env.RESEND_KEY || '';
const MAIL_TO        = process.env.MAIL_TO || '';
const MAIL_FROM      = process.env.MAIL_FROM || SMTP_USER;
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '';

// Fehlt der SMTP-Zugang, kann nichts zugestellt werden. Der Dienst meldet das
// dann als Fehler, damit das Formular auf den E-Mail-Pfad ausweicht und die
// Adresse zum direkten Anschreiben zeigt. Ein "Angekommen" ohne Zustellung
// waere die schlimmste Variante: die Anfrage waere lautlos verloren.
// MAIL_DRYRUN=1 erlaubt bewusstes Annehmen ohne Versand — nur zum Testen.
/* Zwei Versandwege, der Dienst waehlt selbst:

     RESEND_KEY gesetzt → HTTPS an api.resend.com (Port 443)
     sonst              → SMTP an SMTP_HOST

   Der HTTPS-Weg ist der, der auf Railway funktioniert: ausgehendes SMTP ist
   dort gesperrt, Verbindungen auf 465 und 587 laufen in einen Timeout. Der
   SMTP-Weg bleibt trotzdem drin — auf einem Server, der ihn zulaesst (etwa
   bei Hostinger selbst), genuegt dann das Entfernen des Schluessels.

   In beiden Faellen geht die Mail an MAIL_TO. Wo sie landet, entscheiden die
   MX-Eintraege der Domain, und die zeigen auf Hostinger.

   Das Kennwort zaehlt zur Konfiguration dazu. Ohne es meldete der Dienst
   "versandbereit" und scheiterte erst beim Versand — eine Anzeige, die gruen
   zeigt und trotzdem nichts zustellt, ist schlimmer als gar keine. */
const PER_HTTPS = !!RESEND_KEY;
const NICHT_KONFIGURIERT = !MAIL_TO || (PER_HTTPS
  ? false
  : (!SMTP_HOST || (!!SMTP_USER && !SMTP_PASS)));
const DRYRUN = /^(1|true|ja)$/i.test(process.env.MAIL_DRYRUN || '');
const TROCKENLAUF = NICHT_KONFIGURIERT;

/* --- Grenzen ------------------------------------------------------------
   Alles, was von aussen kommt, bekommt eine Obergrenze. Ohne die waere ein
   einzelner Aufruf mit ein paar Megabyte genug, um den Dienst lahmzulegen. */
const MAX_BODY   = 16 * 1024;          // 16 KB reichen fuer jedes Formular
const MAX_FELD   = { name: 120, kontakt: 160, unternehmen: 160, paket: 60, ausgangspunkt: 120, anliegen: 4000, quelle: 200 };
const FENSTER_MS = 10 * 60 * 1000;     // Ratenbegrenzung: Zeitfenster
const MAX_PRO_IP = 5;                  // und erlaubte Anfragen darin

const versuche = new Map();            // IP -> Zeitstempel[]

function darfSenden(ip) {
  const jetzt = Date.now();
  const liste = (versuche.get(ip) || []).filter((t) => jetzt - t < FENSTER_MS);
  if (liste.length >= MAX_PRO_IP) { versuche.set(ip, liste); return false; }
  liste.push(jetzt);
  versuche.set(ip, liste);
  // Aufraeumen, damit die Map nicht unbegrenzt waechst
  if (versuche.size > 5000) {
    for (const [k, v] of versuche) {
      if (!v.some((t) => jetzt - t < FENSTER_MS)) versuche.delete(k);
    }
  }
  return true;
}

/* --- Saeuberung ---------------------------------------------------------
   Zeilenumbrueche muessen raus, bevor etwas in eine Kopfzeile wandert.
   Sonst liesse sich ueber den Namen ein zusaetzliches Bcc: einschleusen und
   die Anfrage ginge still an einen Dritten mit. */
// \u2028 und \u2029 sind in JavaScript ebenfalls Zeilenenden und werden von
// manchen Mailservern als solche gelesen — sie muessen genauso weg wie \r\n.
const einzeilig = (s, max) =>
  String(s == null ? '' : s).replace(/[\r\n\u2028\u2029]+/g, ' ').trim().slice(0, max);

const mehrzeilig = (s, max) =>
  String(s == null ? '' : s)
    .replace(/\r\n?/g, '\n')          // auch ein einzelnes \r
    .replace(/[\u2028\u2029]/g, '\n')
    .trim().slice(0, max);

// Bewusst nachsichtig: das Feld nimmt E-Mail ODER Telefonnummer entgegen.
const istMail = (s) => /^[^\s@,;:<>"']+@[^\s@,;:<>"']+\.[A-Za-z]{2,}$/.test(s);

/* --- SMTP --------------------------------------------------------------- */
// Ueblich ist 465 mit implizitem TLS und 587 mit STARTTLS. Manche Anbieter
// weichen davon ab, deshalb laesst sich SMTP_SECURE setzen; ohne Angabe
// entscheidet die Portnummer. Unverschluesselt versendet wird nie:
// requireTLS bricht ab, wenn ein Server kein STARTTLS anbietet.
const SICHER = process.env.SMTP_SECURE
  ? /^(1|true|ja)$/i.test(process.env.SMTP_SECURE)
  : SMTP_PORT === 465;

/* Der Namen wird hier selbst aufgeloest, und zwar ausdruecklich auf IPv4.

   Weder ipv4first noch autoSelectFamily(false) noch family:4 am Transport
   haben den IPv6-Versuch verhindert — nodemailer reicht die Socket-Option
   nicht bis zum Verbindungsaufbau durch. Uebergibt man dagegen gleich eine
   IPv4-Adresse, gibt es nichts mehr zu waehlen.

   servername traegt weiterhin den Hostnamen, damit das Zertifikat gegen
   smtp.hostinger.com geprueft wird und nicht gegen die nackte Adresse.
   Schlaegt die Aufloesung fehl, bleibt es beim Namen — dann ist der Zustand
   wie vorher, aber nicht schlechter. */
let smtpZiel = SMTP_HOST;
if (!TROCKENLAUF && !PER_HTTPS) {
  try {
    const { address } = await lookup(SMTP_HOST, { family: 4 });
    smtpZiel = address;
    console.log(`SMTP-Ziel: ${SMTP_HOST} → ${address} (IPv4)`);
  } catch (e) {
    console.log(`SMTP-Ziel: IPv4-Aufloesung fehlgeschlagen (${e.message}), nutze ${SMTP_HOST}`);
  }
}

const transport = (TROCKENLAUF || PER_HTTPS) ? null : nodemailer.createTransport({
  host: smtpZiel,
  port: SMTP_PORT,
  secure: SICHER,
  auth: SMTP_USER ? { user: SMTP_USER, pass: SMTP_PASS } : undefined,
  tls: { servername: SMTP_HOST },   // Zertifikat gegen den Namen, nicht die Adresse
  requireTLS: !SICHER,
  connectionTimeout: 10000,
  greetingTimeout: 10000,
  socketTimeout: 20000,
});

/* --- Antworten ---------------------------------------------------------- */
function kopfzeilen(req) {
  const h = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  };
  // Nur setzen, wenn die Herkunft passt. Ohne ALLOWED_ORIGIN laeuft der
  // Dienst hinter dem eigenen Reverse-Proxy und braucht kein CORS.
  const origin = req.headers.origin;
  if (ALLOWED_ORIGIN && origin === ALLOWED_ORIGIN) {
    h['Access-Control-Allow-Origin'] = origin;
    h['Vary'] = 'Origin';
    h['Access-Control-Allow-Headers'] = 'Content-Type';
    h['Access-Control-Allow-Methods'] = 'POST, OPTIONS';
    h['Access-Control-Max-Age'] = '86400';
  }
  return h;
}

const antwort = (req, res, code, daten) => {
  res.writeHead(code, kopfzeilen(req));
  res.end(JSON.stringify(daten));
};

/* --- Server ------------------------------------------------------------- */
const server = createServer((req, res) => {
  const pfad = new URL(req.url, 'http://x').pathname;

  if (req.method === 'OPTIONS') { res.writeHead(204, kopfzeilen(req)); res.end(); return; }

  if (pfad === '/api/health' || pfad === '/health') {
    return antwort(req, res, 200, {
      ok: true,
      versandbereit: !TROCKENLAUF,
      modus: NICHT_KONFIGURIERT ? (DRYRUN ? "Trockenlauf — nimmt an, versendet nicht" : "NICHT EINGERICHTET — Anfragen werden abgewiesen") : "versendet",
    });
  }

  if (pfad !== '/api/kontakt') return antwort(req, res, 404, { ok: false, fehler: 'unbekannter Pfad' });
  if (req.method !== 'POST')   return antwort(req, res, 405, { ok: false, fehler: 'nur POST' });

  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim()
          || req.socket.remoteAddress || 'unbekannt';

  if (!darfSenden(ip)) return antwort(req, res, 429, { ok: false, fehler: 'zu viele Anfragen' });

  let roh = '', zuGross = false;
  req.on('data', (stueck) => {
    if (zuGross) return;
    roh += stueck;
    if (roh.length > MAX_BODY) {
      zuGross = true; roh = '';
      // Erst antworten, dann abschneiden. Umgekehrt saehe der Absender nur
      // einen abgerissenen Verbindungsversuch und wuesste nicht, warum.
      antwort(req, res, 413, { ok: false, fehler: 'Anfrage zu gross' });
      res.on('finish', () => req.destroy());
    }
  });

  req.on('end', async () => {
    if (zuGross) return;

    let d;
    try { d = JSON.parse(roh); } catch { return antwort(req, res, 400, { ok: false, fehler: 'kein gueltiges JSON' }); }
    if (!d || typeof d !== 'object') return antwort(req, res, 400, { ok: false, fehler: 'unerwartete Daten' });

    // Honigtopf: fuellt ihn etwas aus, war es kein Mensch. Nach aussen sieht
    // das aus wie Erfolg — ein Bot soll nicht lernen, woran er gescheitert ist.
    if (einzeilig(d.firma, 200) !== '') return antwort(req, res, 200, { ok: true });

    const name     = einzeilig(d.name, MAX_FELD.name);
    const kontakt  = einzeilig(d.kontakt, MAX_FELD.kontakt);
    /* Das Feld hiess bis August "branche". Beide Namen werden gelesen, damit
       ein noch nicht neu ausgeliefertes Frontend nicht still ein leeres Feld
       schickt — Dienst und Website werden getrennt deployt. */
    const ausgangspunkt = einzeilig(d.ausgangspunkt ?? d.branche, MAX_FELD.ausgangspunkt);
    const quelle   = einzeilig(d.quelle, MAX_FELD.quelle);
    const anliegen = mehrzeilig(d.anliegen, MAX_FELD.anliegen);
    /* Unternehmen ist freiwillig und darf leer bleiben. Es heisst bewusst
       NICHT "firma": diesen Namen traegt der Honigtopf, und ein ausgefuelltes
       Feld dieses Namens laesst die Anfrage lautlos fallen. Wer das eine fuer
       das andere haelt, verliert jede Anfrage eines Unternehmens. */
    const unternehmen = einzeilig(d.unternehmen, MAX_FELD.unternehmen);
    /* Das angefragte Paket setzt die Preiskarte, nicht der Absender. */
    const paket = einzeilig(d.paket, MAX_FELD.paket);

    if (!name)    return antwort(req, res, 400, { ok: false, fehler: 'Name fehlt' });
    if (!kontakt) return antwort(req, res, 400, { ok: false, fehler: 'Kontaktangabe fehlt' });
    if (d.consent !== true) return antwort(req, res, 400, { ok: false, fehler: 'Einwilligung fehlt' });

    /* Das Paket steht als erste Zeile im Text und zusaetzlich im Betreff —
       wer die Mail oeffnet, soll nicht erst im Anliegen danach suchen. Ohne
       Paket faellt die Zeile ganz weg, statt ein "—" zu zeigen: die meisten
       Anfragen kommen nicht aus einer Preiskarte. */
    const text =
      'Neue Anfrage über die Website\n' +
      '─────────────────────────────\n\n' +
      (paket ? 'ANGEFRAGTES PAKET: ' + paket + '\n\n' : '') +
      'Name:          ' + name + '\n' +
      (unternehmen ? 'Unternehmen:   ' + unternehmen + '\n' : '') +
      'Kontakt:       ' + kontakt + '\n' +
      'Ausgangspunkt: ' + (ausgangspunkt || 'keine Angabe') + '\n' +
      'Herkunft:      ' + (quelle || '—') + '\n' +
      'Eingang:       ' + new Date().toLocaleString('de-DE', { timeZone: 'Europe/Berlin' }) + '\n\n' +
      'Anliegen:\n' + (anliegen || '—') + '\n\n' +
      '─────────────────────────────\n' +
      'Einwilligung zur Kontaktaufnahme wurde erteilt.\n' +
      (istMail(kontakt)
        ? 'Ein Klick auf "Antworten" geht direkt an den Interessenten.'
        : 'Die Kontaktangabe ist keine E-Mail-Adresse — bitte telefonisch antworten.');

    if (NICHT_KONFIGURIERT) {
      if (DRYRUN) {
        console.log('[Trockenlauf] Anfrage angenommen, nicht versendet:\n' + text + '\n');
        return antwort(req, res, 200, { ok: true, hinweis: 'Trockenlauf — nicht versendet' });
      }
      console.error('Anfrage NICHT zustellbar — Versand nicht eingerichtet (RESEND_KEY oder SMTP-Zugang und MAIL_TO). Von: ' + name);
      return antwort(req, res, 503, { ok: false, fehler: 'Versand nicht eingerichtet' });
    }

    /* Das Paket steht direkt hinter "Anfrage" und damit im sichtbaren Teil
       der Betreffzeile — Postfachlisten kuerzen hinten ab, nicht vorn. */
    const betreff = (paket ? 'Paket ' + paket + ' · Anfrage: ' : 'Website-Anfrage: ')
      + name + (ausgangspunkt ? ' · ' + ausgangspunkt : '');

    /* Der Absender traegt den Interessenten im ANZEIGENAMEN, die Adresse
       bleibt die eigene.

       Warum nicht gleich seine Adresse als Absender: dann behauptete dieser
       Server, fuer fremde Domains zu sprechen. SPF und DKIM fallen durch, die
       Mail landet im Spam oder wird abgewiesen.

       Postfaecher zeigen in der Uebersicht den Anzeigenamen, nicht die
       Adresse. In der Liste steht damit "Max Mustermann · max@example.com"
       statt immer nur der eigenen Adresse — sortierbar und auf einen Blick
       zuzuordnen.

       Anfuehrungszeichen und Backslash muessen raus: sie wuerden die
       Namensangabe zerlegen. Zeilenumbrueche hat einzeilig() schon entfernt,
       das ist der Riegel gegen eingeschleuste Kopfzeilen. */
    const anzeige = (name + ' · ' + kontakt).replace(/[\\"]/g, ' ').trim().slice(0, 120);
    const absender = '"' + anzeige + '" <' + MAIL_FROM + '>';
    // Nur setzen, wenn es wirklich eine Adresse ist. Sonst wuerde eine
    // Telefonnummer als Antwortadresse landen und die Antwort verpuffen.
    const antwortAn = istMail(kontakt) ? kontakt : undefined;

    try {
      if (PER_HTTPS) {
        const r = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization: 'Bearer ' + RESEND_KEY,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: absender,               // Name des Interessenten, Adresse die eigene
            to: [MAIL_TO],
            subject: betreff,
            text,
            reply_to: antwortAn,
          }),
          signal: AbortSignal.timeout(15000),
        });
        if (!r.ok) {
          // Grund aus der Antwort holen, damit im Protokoll steht, WORAN es
          // lag — nicht bestaetigte Domain, falscher Schluessel, Kontingent.
          let grund = 'HTTP ' + r.status;
          try { const j = await r.json(); if (j && j.message) grund += ' — ' + j.message; } catch {}
          throw new Error(grund);
        }
      } else {
        await transport.sendMail({
          from: absender,                 // Name des Interessenten, Adresse die eigene
          to: MAIL_TO,
          subject: betreff,
          text,
          replyTo: antwortAn,
        });
      }
      console.log('Anfrage zugestellt an ' + MAIL_TO + ' — von ' + name);
      return antwort(req, res, 200, { ok: true });
    } catch (e) {
      // Der Grund gehoert ins Protokoll, nicht in die Antwort: er verraet
      // sonst Einzelheiten der Mailinfrastruktur.
      console.error('Versand fehlgeschlagen:', e && e.message);
      return antwort(req, res, 502, { ok: false, fehler: 'Versand fehlgeschlagen' });
    }
  });
});

server.listen(PORT, () => {
  console.log('BDS-Formulardienst auf Port ' + PORT);
  console.log(TROCKENLAUF
    ? 'Modus: TROCKENLAUF — nichts wird versendet (RESEND_KEY oder SMTP-Zugang und MAIL_TO fehlen)'
    : PER_HTTPS
      ? 'Modus: Versand über HTTPS (Resend), Absender ' + MAIL_FROM + ', Ziel ' + MAIL_TO
      : 'Modus: Versand über SMTP ' + SMTP_HOST + ':' + SMTP_PORT + ' an ' + MAIL_TO);
});
