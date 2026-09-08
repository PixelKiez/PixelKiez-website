/* =========================================================================
   Berlin Digital Systems — Build
   Quelle: site/   →   Auslieferung: dist/

   Was passiert:
     1. Schriften bekommen einen Inhalts-Hash im Dateinamen (Cache-Busting).
     2. fonts.css und bds.css werden zusammengelegt, minifiziert und als
        <style> in jede Seite eingebettet. Die url()-Pfade werden dabei von
        "../fonts/" auf "assets/fonts/" umgeschrieben — die eingebettete
        Fassung steht im Dokumentwurzel, nicht mehr in assets/css/.
     3. bds.js wird minifiziert und an derselben Stelle eingebettet, an der
        das <script defer> stand: als letztes Element vor </body>. Das Skript
        ist eine IIFE ohne readyState-Abfrage, damit ist das gleichwertig.
     4. Das HTML wird minifiziert — bewusst vorsichtig, siehe HTML_OPTIONEN.

   Ziel ist eine Auslieferung ohne einen einzigen vermeidbaren Roundtrip:
   HTML, CSS, JS und Symbole in einer Antwort, Schriften unveraenderlich
   danebengelegt.
   ========================================================================= */

import { readFile, writeFile, mkdir, rm, readdir, copyFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { brotliCompressSync, gzipSync, constants as zlibKonstanten } from 'node:zlib';
import { join, dirname, basename, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';
import { minify as minifyHtml } from 'html-minifier-terser';
import { uebersetze } from './i18n.mjs';
import { uebersetzeJs } from './i18n-js.mjs';
import { EINSPRACHIG, SPRACHPAARE, EIGENE_PAARE } from './seiten.mjs';

const WURZEL = fileURLToPath(new URL('..', import.meta.url));
const QUELLE = join(WURZEL, 'site');
const ZIEL   = join(WURZEL, 'dist');

/* html-minifier-terser: die beiden erstgenannten Schalter sind hier nicht
   optional. Ohne caseSensitive werden SVG-Attribute kleingeschrieben und
   viewBox, startOffset, clipPath, patternUnits verlieren ihre Wirkung — das
   Sprite und das Kurvenband im Hero waeren zerstoert. conservativeCollapse
   laesst zwischen Elementen immer ein Leerzeichen stehen; das kostet ein paar
   hundert Byte und bewahrt die Wortabstaende zwischen Inline-Elementen. */
const HTML_OPTIONEN = {
  caseSensitive: true,
  keepClosingSlash: true,
  collapseWhitespace: true,
  conservativeCollapse: true,
  removeComments: true,
  removeRedundantAttributes: false,
  removeAttributeQuotes: false,
  minifyCSS: false,            // bereits von esbuild erledigt
  minifyJS: false,             // bereits von esbuild erledigt
  processScripts: [],          // JSON-LD unangetastet lassen
  sortAttributes: false,
  sortClassName: false,
};

const kb = (n) => (n / 1024).toFixed(1).padStart(6) + ' KB';
const log = (...a) => console.log(...a);

const DOMAIN = 'https://pixelkiez.de';

/* -------------------------------------------------------------------------
   Vorlauf fuer das Einblenden beim Scrollen (PXK-23).

   Der Inhalt ist im CSS unbedingt sichtbar. Versteckt wird nur, solange das
   <html>-Element data-reveal-anim traegt, und dieses Merkmal bringt kein
   Markup mit — es entsteht ausschliesslich hier, im Browser, aus laufendem
   JavaScript. Laeuft keines, gibt es nichts zu verstecken: die Seite steht
   da, ohne Bewegung, aber vollstaendig.

   Warum im <head> und nicht in bds.js: bds.js steht als letztes vor
   </body>. Bis dorthin hat der Browser den sichtbaren Teil der Seite laengst
   gemalt. Wuerde erst dort versteckt, saehe man den fertigen Inhalt kurz und
   danach verschwaende er wieder, um eingeblendet zu werden — schlechter als
   gar keine Animation. Der Vorzustand muss vor dem ersten Bild stehen.

   Drei Wege fuehren hier zurueck zu sichtbar, und alle drei brauchen es:
   fehlender IntersectionObserver und reduzierte Bewegung heben das Merkmal
   gar nicht erst; und wer es setzt, muss es auch wieder abraeumen koennen,
   falls bds.js danach nicht ankommt (blockiert, Ausnahme, Syntaxfehler).
   Dafuer steht der Rueckfall auf DOMContentLoaded — kein willkuerlicher
   Zeitgeber, sondern der Punkt, an dem feststeht, dass jedes Skript des
   Dokuments seine Gelegenheit hatte. Bis dahin ist "bereit" gesetzt; wer
   den Zustand uebernimmt, schreibt "an" darueber (siehe bds.js, Abschnitt
   2) und schuetzt ihn damit vor dem Rueckfall.
   ------------------------------------------------------------------------- */
const REVEAL_VORLAUF = '<script>' + [
  '(function(){var d=document.documentElement;try{',
  'if(!("IntersectionObserver" in window))return;',
  'if(window.matchMedia&&window.matchMedia("(prefers-reduced-motion: reduce)").matches)return;',
  'd.setAttribute("data-reveal-anim","bereit");',
  'document.addEventListener("DOMContentLoaded",function(){',
  'if(d.getAttribute("data-reveal-anim")==="bereit")d.removeAttribute("data-reveal-anim");',
  '});}catch(e){d.removeAttribute("data-reveal-anim");}})();',
].join('') + '</script>';

/* Nur Seiten, die bds.js mitbringen, duerfen den Vorzustand ueberhaupt
   aufspannen. Auf Impressum und Datenschutz laeuft kein Skript; dort waere
   ein Merkmal, das niemand zuruecknimmt, genau der Fehler, den PXK-23
   behebt. */
const SKRIPT_TAG = '<script src="assets/js/bds.js" defer></script>';

/* -------------------------------------------------------------------------
   Bildverweise mit VOLLSTAENDIGER Adresse auf den gehashten Namen ziehen.

   Die Umschreibung weiter unten fasst nur href-, src- und content-Attribute
   mit relativem Pfad. Im JSON-LD stehen Bilder aber als absolute Adresse in
   einem JSON-Feld — "url" und "contentUrl" —, und die fiel durchs Raster.

   Folge war ein Verweis auf assets/img/og.png, eine Datei, die es unter
   diesem Namen nie gibt: ausgeliefert wird sie mit Inhalts-Hash. Google holte
   sich das Firmenlogo also von einer Adresse mit 404. Nichts daran sah man
   der Seite an, sie war fehlerfrei — es fehlte nur still das Logo in allem,
   was Suchmaschinen und KI-Systeme daraus bauen.

   Bereits umgeschriebene Namen bleiben unangetastet, sonst suchte der zweite
   Durchgang nach "og.4c5d9640.png" und fiele ueber seinen eigenen Vorgaenger.
   ------------------------------------------------------------------------- */
const HAT_HASH = /\.[0-9a-f]{8}\.[a-z0-9]+$/i;
const DOMAIN_RE = DOMAIN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function absoluteBilder(html, bildKarte, seite) {
  return html.replace(new RegExp(`${DOMAIN_RE}/assets/img/([A-Za-z0-9._-]+)`, 'g'),
    (treffer, datei) => {
      if (HAT_HASH.test(datei)) return treffer;
      const neu = bildKarte.get(datei);
      if (!neu) throw new Error(`${seite}: Verweis auf unbekanntes Bild assets/img/${datei}`);
      return `${DOMAIN}/assets/img/${neu}`;
    });
}

/* -------------------------------------------------------------------------
   Sprachverweise. Beide Fassungen nennen sich gegenseitig und sich selbst —
   ohne x-default weiss eine Suchmaschine nicht, welche sie Besuchern ohne
   passende Spracheinstellung zeigen soll.
   ------------------------------------------------------------------------- */
function setzeAlternates(html, sprache, paar) {
  const zeilen = [
    `<link rel="alternate" hreflang="de" href="${DOMAIN}${paar.pfadDe}">`,
    `<link rel="alternate" hreflang="en" href="${DOMAIN}${paar.pfadEn}">`,
    `<link rel="alternate" hreflang="x-default" href="${DOMAIN}${paar.pfadDe}">`,
  ].join('\n');
  const kanonisch = DOMAIN + (sprache === 'en' ? paar.pfadEn : paar.pfadDe);
  // Kanonische Adresse auf die eigene Fassung ziehen, danach die Verweise
  return html.replace(/<link rel="canonical" href="[^"]*">/, () =>
    `<link rel="canonical" href="${kanonisch}">\n${zeilen}`);
}

/* -------------------------------------------------------------------------
   Englische Fassung. Erzeugt aus derselben Quelle wie die deutsche — es gibt
   bewusst keine zweite HTML-Datei, die man vergessen koennte nachzupflegen.

   `mittel` traegt das einmal Vorbereitete: cssMin, jsEn (bereits uebersetzt
   und minifiziert), fontKarte, bildKarte, tabHtml. Zurueck kommt neben dem
   HTML die Menge der benutzten Tabelleneintraege — erst wer die Ergebnisse
   ALLER Sprachpaare kennt, kann sagen, welche Eintraege veraltet sind.
   ------------------------------------------------------------------------- */
async function baueEnglisch(paar, mittel) {
  const { cssMin, jsEn, fontKarte, bildKarte, tabHtml } = mittel;
  let html = await readFile(join(QUELLE, paar.quelle), 'utf8');

  /* Aenderungsdatum wie bei der deutschen Fassung — beide entstehen aus
     derselben Quelldatei und sind damit gleich alt. */
  const { mtime: geaendert } = await stat(join(QUELLE, paar.quelle));
  html = html.replace(/"dateModified": "[^"]*"/g,
    `"dateModified": "${geaendert.toISOString().slice(0, 10)}"`);

  /* --- Text --- */
  const t = uebersetze(html, tabHtml);
  if (t.fehlend.length) throw new Error(
    `${paar.quelle} enthaelt Text ohne Uebersetzung. Nach einer Aenderung am\n` +
    '    deutschen Text bitte "npm run i18n" ausfuehren und en.json ergaenzen:\n    · ' +
    t.fehlend.slice(0, 6).map((s) => s.slice(0, 90)).join('\n    · '));
  html = t.html;
  const benutzt = new Set(t.benutzt);   // wird unten um das JSON-LD ergaenzt

  /* --- Dokumentsprache --- */
  html = html.replace('<html lang="de">', '<html lang="en">');
  if (!html.includes('<html lang="en">')) throw new Error(`${paar.zielEn}: <html lang="de"> nicht gefunden`);

  /* --- Verweise auf deutsche Fassungen zeigen auf die englischen — fuer
         JEDES Sprachpaar, in href wie action, samt Ankern (/#leistungen →
         /en/#leistungen). Muss VOR dem Umschalter-Ersatz laufen: der wird
         danach als Ganzes neu gesetzt und zeigt bewusst auf die deutsche
         Fassung. Die Rechtsseiten stehen nicht im Register und bleiben
         damit deutsch verlinkt — das ist Absicht. --- */
  for (const p of SPRACHPAARE) {
    const von = p.pfadDe.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    html = html.replace(new RegExp(`(href|action)="${von}(#[^"]*)?"`, 'g'),
      (m, attribut, anker) => `${attribut}="${p.pfadEn}${anker || ''}"`);
  }

  /* --- Umschalter zeigt jetzt zurueck aufs Deutsche --- */
  const schalter = /<a class="lang"[^>]*data-lang-switch>[^<]*<\/a>/;
  if (!schalter.test(html)) throw new Error(`${paar.zielEn}: Sprachumschalter nicht gefunden`);
  html = html.replace(schalter, () =>
    `<a class="lang" href="${paar.pfadDe}" hreflang="de" lang="de" aria-label="Auf Deutsch wechseln" data-lang-switch>DE</a>`);

  /* --- Rechtsseiten haben seit der englischen Fassung eigene Quellen unter
         /en/. Verweise aus dem englischen Bestand zeigen dorthin, nicht auf
         den deutschen Text. Beide Schreibweisen werden getroffen: die
         Startseite verlinkt relativ, Unterseiten und Formulare absolut. --- */
  html = html.replace(/href="\/?(impressum|datenschutz)\.html"/g,
    (m, n) => `href="${n === 'impressum' ? '/en/imprint.html' : '/en/privacy.html'}"`);

  /* --- Sprachverweise und kanonische Adresse --- */
  html = setzeAlternates(html, 'en', paar);
  html = html.replace(/<meta property="og:locale" content="[^"]*">/, () =>
    '<meta property="og:locale" content="en_GB">');
  html = html.replace(/<meta property="og:url" content="[^"]*">/, () =>
    `<meta property="og:url" content="${DOMAIN}${paar.pfadEn}">`);

  /* --- JSON-LD: die Beschreibungen darin sind ebenfalls Inhalt --- */
  html = html.replace(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/, (treffer, roh) => {
    const daten = JSON.parse(roh);
    const offen = [];
    const geh = (o) => {
      if (Array.isArray(o)) return o.map(geh);
      if (o && typeof o === 'object') {
        for (const k of Object.keys(o)) o[k] = geh(o[k]);
        return o;
      }
      if (typeof o !== 'string') return o;
      if (tabHtml[o]) { benutzt.add(o); return tabHtml[o]; }
      // Deutsch gebliebene Saetze melden — Eigennamen und URLs nicht
      if (/\s/.test(o) && /[äöüßÄÖÜ]|\b(der|die|das|und|für|mit|Ihre|Sie)\b/.test(o)) offen.push(o);
      return o;
    };
    const uebersetzt = geh(daten);
    // Sprache im strukturierten Datensatz mitziehen
    let s = JSON.stringify(uebersetzt)
      .replace(/"inLanguage":"de(-DE)?"/g, '"inLanguage":"en"');

    /* Seitenbezogene Adressen und Kennungen muessen sich unterscheiden: die
       englische und die deutsche Fassung sind zwei Dokumente. Truegen beide
       dieselbe @id, waere fuer eine Suchmaschine unklar, welches gemeint ist.

       Entitaetsbezogene Kennungen bleiben dagegen bewusst gleich —
       Unternehmen, Gruender, Logo und die Leistungen sind auf beiden Seiten
       dieselbe Sache, und genau diese Gleichheit verknuepft die Fassungen.

       Welche Adressen wechseln, sagt das Seitenregister (ldTausch). Der
       Austausch laeuft ueber die exakte, in Anfuehrungszeichen stehende
       Zeichenkette und trifft damit Definition und jeden Verweis in einem
       Zug. */
    for (const [von, nach] of paar.ldTausch) {
      s = s.split(`"${DOMAIN}${von}"`).join(`"${DOMAIN}${nach}"`);
    }
    if (offen.length) throw new Error(
      `${paar.quelle}: JSON-LD enthaelt deutschen Text ohne Uebersetzung:\n    · ` +
      offen.slice(0, 5).map((x) => x.slice(0, 90)).join('\n    · '));
    return `<script type="application/ld+json">${s}</script>`;
  });

  /* --- Mittel einbetten, wie bei der deutschen Fassung --- */
  const hatSkript = html.includes(SKRIPT_TAG);
  const linkMuster = /[ \t]*<link rel="stylesheet" href="assets\/css\/fonts\.css">\s*\n[ \t]*<link rel="stylesheet" href="assets\/css\/bds\.css">/;
  html = html.replace(linkMuster, () => `<style>${cssMin}</style>` + (hatSkript ? REVEAL_VORLAUF : ''));
  html = html.replace(/href="assets\/fonts\/([^"]+\.woff2)"/g, (m, datei) => {
    const neu = fontKarte.get(datei);
    if (!neu) throw new Error(`${paar.zielEn}: Vorladehinweis auf unbekannte Schrift ${datei}`);
    return `href="/assets/fonts/${neu}"`;
  });
  html = html.replace(/(href|src|content)="assets\/img\/([^"]+)"/g, (treffer, attr, datei) => {
    const n = bildKarte.get(datei);
    if (!n) throw new Error(`${paar.zielEn}: Verweis auf unbekanntes Bild assets/img/${datei}`);
    const ziel = attr === 'content' ? `${DOMAIN}/assets/img/${n}` : `/assets/img/${n}`;
    return `${attr}="${ziel}"`;
  });
  html = absoluteBilder(html, bildKarte, paar.zielEn);
  html = html.replace(SKRIPT_TAG, () => `<script>${jsEn}</script>`);

  html = await minifyHtml(html, HTML_OPTIONEN);
  pruefe(paar.zielEn, html, jsEn);

  /* Letzte Gegenprobe: kein offensichtliches Deutsch im sichtbaren Text */
  const sichtbar = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<[^>]+>/g, ' ');
  const deutsch = sichtbar.match(/\b(werden|wurde|nicht|Ihre|Ihnen|wir|unsere|Betriebe|Anfragen|Website ist)\b/g);
  if (deutsch) throw new Error(`${paar.zielEn} enthaelt noch deutschen Text: ${[...new Set(deutsch)].join(', ')}`);

  return { html, benutzt };
}

/* -------------------------------------------------------------------------
   Selbstpruefung je Seite. Deckt genau die Fehler ab, die beim Einbetten
   auftreten koennen und die man dem Ergebnis nicht ansieht.
   ------------------------------------------------------------------------- */
function pruefe(seite, html, jsMin) {
  const fehler = [];

  if (/<link[^>]+rel="stylesheet"/.test(html))
    fehler.push('ein <link rel="stylesheet"> ist uebrig — CSS wurde nicht eingebettet');
  if (/<script[^>]+\bsrc=/.test(html))
    fehler.push('ein <script src=…> ist uebrig — JS wurde nicht eingebettet');
  if (/\.\.\/fonts\//.test(html))
    fehler.push('unaufgeloester Pfad ../fonts/ — die eingebettete Fassung wuerde die Schriften nicht finden');
  // Jeder echte Dateiverweis auf eine Schrift — in href= wie in url() — muss
  // den Inhalts-Hash tragen. type="font/woff2" ist kein Dateiverweis.
  for (const m of html.matchAll(/assets\/fonts\/([^"')\s]+\.woff2)/g)) {
    if (!/\.[0-9a-f]{8}\.woff2$/.test(m[1]))
      fehler.push(`Schriftverweis ohne Inhalts-Hash: ${m[1]}`);
  }

  // Das eingebettete Skript muss fuer sich genommen gueltig sein. Genau hier
  // waere die $&-Ersetzung aufgefallen.
  const skripte = [...html.matchAll(/<script(?![^>]*\bsrc=)(?![^>]*application\/ld\+json)[^>]*>([\s\S]*?)<\/script>/g)];
  for (const [, code] of skripte) {
    if (!code.trim()) continue;
    try { new Function(code); }
    catch (e) { fehler.push(`eingebettetes Skript ist syntaktisch ungueltig: ${e.message}`); }
    if (code.includes('<script') || code.includes('</script'))
      fehler.push('im eingebetteten Skript steht ein Skript-Tag — Ersetzung hat sich selbst zerlegt');
  }
  if (seite === 'index.html') {
    if (!skripte.length) fehler.push('kein eingebettetes Skript gefunden');
    else if (skripte.every(([, c]) => c.length < jsMin.length * 0.9))
      fehler.push('eingebettetes Skript ist deutlich kuerzer als erwartet');
  }

  // JSON-LD muss den Durchlauf unbeschadet ueberstehen
  for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    try { JSON.parse(m[1]); }
    catch (e) { fehler.push(`JSON-LD ungueltig: ${e.message}`); }
  }

  // SVG-Attribute in Grossschreibung muessen erhalten bleiben
  for (const attr of ['viewBox', 'startOffset', 'clipPath', 'patternUnits', 'gradientUnits']) {
    if (html.includes(attr.toLowerCase() + '=') && !html.includes(attr + '='))
      fehler.push(`SVG-Attribut ${attr} wurde kleingeschrieben — Darstellung waere zerstoert`);
  }

  if (fehler.length) throw new Error(`${seite}:\n    · ` + fehler.join('\n    · '));
}

async function build() {
  const t0 = Date.now();
  log('\n\x1b[1mBerlin Digital Systems — Build\x1b[0m');
  log('─'.repeat(66));

  await rm(ZIEL, { recursive: true, force: true });
  await mkdir(join(ZIEL, 'assets', 'fonts'), { recursive: true });

  /* ---- 1. Schriften mit Inhalts-Hash ------------------------------------ */
  const fontVerzeichnis = join(QUELLE, 'assets', 'fonts');
  const fontDateien = (await readdir(fontVerzeichnis)).filter((f) => f.endsWith('.woff2')).sort();
  const fontKarte = new Map();          // alter Name → neuer Name
  let fontBytes = 0;

  for (const datei of fontDateien) {
    const inhalt = await readFile(join(fontVerzeichnis, datei));
    const hash = createHash('sha256').update(inhalt).digest('hex').slice(0, 8);
    const neu = `${basename(datei, extname(datei))}.${hash}${extname(datei)}`;
    await copyFile(join(fontVerzeichnis, datei), join(ZIEL, 'assets', 'fonts', neu));
    fontKarte.set(datei, neu);
    fontBytes += inhalt.length;
  }
  log(`Schriften    ${fontDateien.length} Dateien mit Inhalts-Hash   ${kb(fontBytes)}`);

  /* ---- 1b. Bilder: Logo, Vorschaubild, Favicon ------------------------- */
  const bildVerzeichnis = join(QUELLE, 'assets', 'img');
  const bildKarte = new Map();
  let bildBytes = 0;
  try {
    const bilder = (await readdir(bildVerzeichnis))
      .filter((f) => /\.(svg|png|jpe?g|webp|ico)$/i.test(f)).sort();
    if (bilder.length) await mkdir(join(ZIEL, 'assets', 'img'), { recursive: true });
    for (const datei of bilder) {
      const inhalt = await readFile(join(bildVerzeichnis, datei));
      const hash = createHash('sha256').update(inhalt).digest('hex').slice(0, 8);
      const neu = `${basename(datei, extname(datei))}.${hash}${extname(datei)}`;
      await copyFile(join(bildVerzeichnis, datei), join(ZIEL, 'assets', 'img', neu));
      bildKarte.set(datei, neu);
      bildBytes += inhalt.length;
    }
    if (bilder.length) log(`Bilder       ${bilder.length} Dateien mit Inhalts-Hash   ${kb(bildBytes)}`);
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;   // Ordner darf fehlen, solange nichts darauf zeigt
  }

  /* ---- 1c. Wurzeldateien: robots.txt, llms.txt, sitemap.xml, Icons ------
     Diese fragt eine Suchmaschine oder ein Agent als Erstes ab, noch
     bevor er eine Seite laedt. Ohne Inhaltshash, denn ihre Namen sind
     festgelegt, und ohne Umschreibung, denn sie enthalten keine Verweise
     auf gehashte Mitteldateien.

     Die Icons gehoeren aus zwei Gruenden hierher und NICHT nach
     assets/img/:

     1. Google holt das Favicon fuer die Trefferliste selten neu und merkt
        sich dabei die Adresse. Unter assets/img/ bekaeme es einen
        Inhaltshash, und der aendert sich bei jeder Motivaenderung — die
        gemerkte Adresse liefe dann auf 404 und die Trefferliste bliebe
        ohne Icon zurueck. Ein fester Name haelt die Adresse stabil.
     2. /favicon.ico ist der Pfad, den Googlebot und jeder Browser von sich
        aus abfragen, auch ohne <link>-Angabe im Kopf. Fehlt die Datei
        dort, ist das ein 404 bei jedem Seitenaufruf.

     Groessen: die .ico traegt 48, 32 und 16 Pixel. 48 ist Vorgabe, weil
     Google ein Vielfaches von 48 verlangt — das frueher benutzte 32er
     Einzelbild erfuellte das nicht.

     Dasselbe gilt fuer logo.png, das Firmenlogo fuer das Wissensfeld. Es lag
     bis zum 18.08.2026 unter assets/img/logo-suche.png und trug damit einen
     Inhalts-Hash. Als das Motiv am 17.08. ueberarbeitet wurde, wechselte die
     Adresse von logo-suche.53244c14.png auf logo-suche.66301da4.png — die
     alte lieferte ab sofort 404. Google hatte die Seite in genau dem Zeitraum
     davor erstmals erfasst und hielt damit eine tote Adresse. Ein Logo, dessen
     Adresse sich beim Ueberarbeiten aendert, ist fuer die Suche wertlos. */
  const WURZELDATEIEN = [
    'robots.txt',
    'llms.txt',
    'favicon.ico',
    'icon-512.png',
    'apple-touch-icon.png',
    'logo.png',
  ];
  for (const datei of WURZELDATEIEN) {
    await copyFile(join(QUELLE, datei), join(ZIEL, datei));
  }

  /* Die Sitemap nennt jede ausgelieferte Seite genau einmal und verknuepft
     die beiden Sprachfassungen wechselseitig — einseitige Verweise wertet
     Google nicht. lastmod kommt aus der Aenderungszeit der Quelldatei.

     Die Reihenfolge innerhalb von <url> ist im Schema festgeschrieben:

         loc, lastmod, changefreq, priority, <xsd:any namespace="##other">

     Fremdelemente wie xhtml:link duerfen also erst GANZ ZULETZT stehen.
     Standen sie zwischen lastmod und priority, brach die Folge, und die
     Search Console wies die Sitemap als ungueltig zurueck.

     priority ist ersatzlos raus: Google wertet es nach eigener Angabe nicht
     aus, und je weniger Elemente, desto weniger kann in der falschen
     Reihenfolge stehen. */
  /* Beide Fassungen jedes Sprachpaars stehen mit demselben Alternates-Block
     drin; die einsprachigen Rechtsseiten ohne. Die Liste kommt aus dem
     Seitenregister — eine neue Seite traegt sich hier von selbst ein. */
  const sitemapEintraege = [];
  for (const paar of SPRACHPAARE) {
    if (paar.entwurf) continue;   // Entwuerfe (noindex) stehen nicht in der Sitemap
    const alternates = [
      `    <xhtml:link rel="alternate" hreflang="de" href="${DOMAIN}${paar.pfadDe}"/>`,
      `    <xhtml:link rel="alternate" hreflang="en" href="${DOMAIN}${paar.pfadEn}"/>`,
      `    <xhtml:link rel="alternate" hreflang="x-default" href="${DOMAIN}${paar.pfadDe}"/>`,
    ].join('\n');
    sitemapEintraege.push({ pfad: paar.pfadDe, quelle: paar.quelle, alternates });
    sitemapEintraege.push({ pfad: paar.pfadEn, quelle: paar.quelle, alternates });
  }
  /* Eigene Paare: zwei Adressen, beide mit Alternates — genau wie bei den
     erzeugten Paaren. Die englische Fassung hat eine eigene Quelle, deshalb
     bestimmt sie ihr eigenes lastmod. */
  for (const paar of EIGENE_PAARE) {
    const alternates = [
      `    <xhtml:link rel="alternate" hreflang="de" href="${DOMAIN}${paar.pfadDe}"/>`,
      `    <xhtml:link rel="alternate" hreflang="en" href="${DOMAIN}${paar.pfadEn}"/>`,
      `    <xhtml:link rel="alternate" hreflang="x-default" href="${DOMAIN}${paar.pfadDe}"/>`,
    ].join('\n');
    sitemapEintraege.push({ pfad: paar.pfadDe, quelle: paar.quelle,   alternates });
    sitemapEintraege.push({ pfad: paar.pfadEn, quelle: paar.quelleEn, alternates });
  }
  for (const seite of EINSPRACHIG) {
    sitemapEintraege.push({ pfad: `/${seite}`, quelle: seite });
  }

  const urls = [];
  for (const e of sitemapEintraege) {
    const { mtime } = await stat(join(QUELLE, e.quelle));
    urls.push(
      '  <url>\n' +
      `    <loc>${DOMAIN}${e.pfad}</loc>\n` +
      `    <lastmod>${mtime.toISOString().slice(0, 10)}</lastmod>\n` +
      (e.alternates ? e.alternates + '\n' : '') +
      '  </url>'
    );
  }
  await writeFile(join(ZIEL, 'sitemap.xml'),
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"\n' +
    '        xmlns:xhtml="http://www.w3.org/1999/xhtml">\n' +
    urls.join('\n') + '\n</urlset>\n', 'utf8');
  log(`Wurzel       robots.txt, llms.txt, sitemap.xml (${urls.length} Adressen)`);

  /* ---- 2. CSS: zusammenlegen, Pfade umschreiben, minifizieren ----------- */
  const fontsCss = await readFile(join(QUELLE, 'assets', 'css', 'fonts.css'), 'utf8');
  const bdsCss   = await readFile(join(QUELLE, 'assets', 'css', 'bds.css'), 'utf8');
  const cssRoh   = fontsCss + '\n' + bdsCss;

  // ../fonts/x.woff2  →  /assets/fonts/x.<hash>.woff2
  //
  // Wurzelabsolut, nicht relativ: das CSS wird in die Seite eingebettet und
  // gilt damit relativ zum Dokument. Die englische Fassung liegt unter /en/ —
  // ein relativer Pfad zeigte dort auf /en/assets/fonts/ und die Schriften
  // waeren nicht auffindbar.
  let ersetzungen = 0;
  const cssPfade = cssRoh.replace(/url\((['"]?)\.\.\/fonts\/([^'")]+)\1\)/g, (treffer, q, datei) => {
    const neu = fontKarte.get(datei);
    if (!neu) throw new Error(`Schrift referenziert, aber nicht vorhanden: ${datei}`);
    ersetzungen++;
    return `url(${q}/assets/fonts/${neu}${q})`;
  });
  if (ersetzungen === 0) throw new Error('Keine Schriftpfade umgeschrieben — Muster passt nicht mehr.');

  // target esnext: nur minifizieren, keine Syntax herunterstufen. Sonst
  // koennte esbuild color(srgb ...), :has() oder @media umschreiben.
  const cssMin = (await esbuild.transform(cssPfade, {
    loader: 'css', minify: true, target: 'esnext',
  })).code.trim();
  log(`CSS          ${kb(cssRoh.length)} → ${kb(cssMin.length)}   ${ersetzungen} Schriftpfade umgeschrieben`);

  /* ---- 3. JS minifizieren ---------------------------------------------- */
  const jsRoh = await readFile(join(QUELLE, 'assets', 'js', 'bds.js'), 'utf8');
  // es2015 statt esnext: der Quelltext ist durchgehend ES5. So kann der
  // Minifizierer keine Pfeilfunktionen einstreuen, die aeltere Browser
  // ausschliessen wuerden.
  const jsMin = (await esbuild.transform(jsRoh, {
    loader: 'js', minify: true, target: 'es2015',
  })).code.trim();
  log(`JS           ${kb(jsRoh.length)} → ${kb(jsMin.length)}`);

  /* ---- 4. Seiten zusammenbauen ----------------------------------------- */
  log('─'.repeat(66));
  let summeVorher = 0, summeNachher = 0;

  /* Deutsche Fassungen: die Sprachpaar-Quellen und die einsprachigen
     Rechtsseiten. `ziel` darf in einem Unterverzeichnis liegen — saubere
     Adressen wie /website-analyse/ entstehen als website-analyse/index.html. */
  const deutscheSeiten = [
    ...SPRACHPAARE.map((p) => ({ quelle: p.quelle, ziel: p.zielDe, paar: p, sprache: 'de' })),
    /* Beide Fassungen der eigenen Paare laufen hier durch: sie sind von Hand
       geschrieben und duerfen die Uebersetzungstabelle nicht sehen. Nur die
       Sprache unterscheidet, wohin Canonical und Umschalter zeigen. */
    ...EIGENE_PAARE.flatMap((p) => [
      { quelle: p.quelle,   ziel: p.zielDe, paar: p, sprache: 'de' },
      { quelle: p.quelleEn, ziel: p.zielEn, paar: p, sprache: 'en' },
    ]),
    ...EINSPRACHIG.map((s) => ({ quelle: s, ziel: s, sprache: 'de' })),
  ];

  for (const { quelle: seite, ziel, paar, sprache } of deutscheSeiten) {
    let html = await readFile(join(QUELLE, seite), 'utf8');
    const vorher = Buffer.byteLength(html);

    /* 4z. Aenderungsdatum aus der Quelldatei in die strukturierten Daten.
           Von Hand gepflegt waere es nach der zweiten Aenderung falsch, und
           ein falsches Datum ist schlechter als keines: Suchmaschinen wie
           KI-Systeme werten Frische, und eine Seite, die seit Monaten
           unveraendert behauptet, heute aktualisiert worden zu sein,
           verliert genau diesen Kredit. */
    const { mtime: geaendert } = await stat(join(QUELLE, seite));
    html = html.replace(/"dateModified": "[^"]*"/g,
      `"dateModified": "${geaendert.toISOString().slice(0, 10)}"`);

    /* 4a. Beide Stylesheet-Verweise durch einen <style>-Block ersetzen.
           fonts.css steht zuerst — die Reihenfolge bleibt erhalten, weil
           beim Zusammenlegen genauso vorgegangen wurde. Direkt dahinter,
           noch im <head>, der Reveal-Vorlauf — aber nur auf Seiten, die
           bds.js auch mitbringen (siehe REVEAL_VORLAUF). */
    const hatSkript = html.includes(SKRIPT_TAG);
    const linkMuster = /[ \t]*<link rel="stylesheet" href="assets\/css\/fonts\.css">\s*\n[ \t]*<link rel="stylesheet" href="assets\/css\/bds\.css">/;
    if (!linkMuster.test(html)) throw new Error(`${seite}: Stylesheet-Verweise nicht gefunden`);
    // Ersetzungs-FUNKTION, nicht -Zeichenkette: in einer Ersetzungszeichenkette
    // sind $&, $', $`, $1..$9 Sonderfolgen. Minifiziertes CSS/JS enthaelt sie
    // ohne weiteres — $&& entsteht schon aus einer Variablen namens $.
    html = html.replace(linkMuster, () => `<style>${cssMin}</style>` + (hatSkript ? REVEAL_VORLAUF : ''));

    /* 4b. Schrift-Vorladehinweise auf die gehashten Namen ziehen, ebenfalls
           wurzelabsolut — siehe Begruendung beim CSS. */
    html = html.replace(/href="assets\/fonts\/([^"]+\.woff2)"/g, (treffer, datei) => {
      const neu = fontKarte.get(datei);
      if (!neu) throw new Error(`${seite}: Vorladehinweis auf unbekannte Schrift ${datei}`);
      return `href="/assets/fonts/${neu}"`;
    });

    /* 4b-2. Bildverweise auf die gehashten Namen ziehen */
    // og:image braucht eine vollstaendige Adresse: viele Dienste, die eine
    // Vorschau erzeugen, lesen relative Pfade nicht auf.
    html = html.replace(/(href|src|content)="assets\/img\/([^"]+)"/g, (treffer, attr, datei) => {
      const n = bildKarte.get(datei);
      if (!n) throw new Error(`${seite}: Verweis auf unbekanntes Bild assets/img/${datei}`);
      const ziel = attr === 'content' ? `${DOMAIN}/assets/img/${n}` : `/assets/img/${n}`;
      return `${attr}="${ziel}"`;
    });
    // Danach die absoluten Adressen im JSON-LD, siehe absoluteBilder()
    html = absoluteBilder(html, bildKarte, seite);

    /* 4c. Skript einbetten, an genau derselben Stelle */
    if (hatSkript) {
      html = html.replace(SKRIPT_TAG, () => `<script>${jsMin}</script>`);
    } else if (seite === 'index.html') {
      throw new Error('index.html: Skriptverweis nicht gefunden');
    }

    /* 4d. Sprachverweise: jede Seite nennt ihre Gegenstuecke. Auf den
           Rechtsseiten gibt es keine englische Fassung, dort entfaellt es. */
    if (paar) html = setzeAlternates(html, sprache, paar);

    /* 4e. HTML minifizieren */
    html = await minifyHtml(html, HTML_OPTIONEN);
    pruefe(seite, html, jsMin);

    await mkdir(dirname(join(ZIEL, ziel)), { recursive: true });
    await writeFile(join(ZIEL, ziel), html, 'utf8');
    const nachher = Buffer.byteLength(html);
    summeVorher += vorher; summeNachher += nachher;
    log(`${ziel.padEnd(20)} ${kb(vorher)} → ${kb(nachher)}   (mit eingebettetem CSS/JS)`);
  }

  /* ---- 4f. Englische Fassungen ------------------------------------------
     Skript und Tabellen einmal vorbereiten, dann je Sprachpaar bauen. Ob
     Eintraege der Tabelle veraltet sind, laesst sich erst sagen, wenn alle
     Fassungen gebaut sind — jede meldet, was sie benutzt hat. */
  const tabHtml = JSON.parse(await readFile(join(QUELLE, 'i18n', 'en.json'), 'utf8'));
  const tabJs   = JSON.parse(await readFile(join(QUELLE, 'i18n', 'en.js.json'), 'utf8'));
  const j = uebersetzeJs(jsRoh, tabJs);
  if (j.fehlend.length) throw new Error(
    'bds.js enthaelt Zeichenketten ohne Uebersetzung (en.js.json ergaenzen):\n    · ' +
    j.fehlend.slice(0, 6).map((s) => s.slice(0, 90)).join('\n    · '));
  if (j.veraltet.length) throw new Error(
    'en.js.json enthaelt Zeichenketten, die es in bds.js nicht mehr gibt:\n    · ' +
    j.veraltet.slice(0, 6).map((s) => s.slice(0, 90)).join('\n    · '));
  const jsEn = (await esbuild.transform(j.js, { loader: 'js', minify: true, target: 'es2015' })).code.trim();

  const benutztGesamt = new Set();
  for (const paar of SPRACHPAARE) {
    const { html: enHtml, benutzt } = await baueEnglisch(paar,
      { cssMin, jsEn, fontKarte, bildKarte, tabHtml });
    for (const k of benutzt) benutztGesamt.add(k);
    await mkdir(dirname(join(ZIEL, paar.zielEn)), { recursive: true });
    await writeFile(join(ZIEL, paar.zielEn), enHtml, 'utf8');
    summeNachher += Buffer.byteLength(enHtml);
    log(`${paar.zielEn.padEnd(20)} ${'—'.padStart(9)} → ${kb(Buffer.byteLength(enHtml))}   (aus der deutschen Quelle erzeugt)`);
  }

  /* --- Erst jetzt, mit den Ergebnissen aller Fassungen, laesst sich sagen,
         welche Tabelleneintraege niemand mehr braucht. --- */
  const veraltet = Object.keys(tabHtml).filter((k) => !benutztGesamt.has(k));
  if (veraltet.length) throw new Error(
    'en.json enthaelt Saetze, die auf keiner Seite mehr vorkommen.\n' +
    '    Vermutlich wurde der deutsche Text geaendert — bitte "npm run i18n"\n' +
    '    ausfuehren und die Eintraege anpassen:\n    · ' +
    veraltet.slice(0, 6).map((x) => x.slice(0, 90)).join('\n    · '));

  /* ---- 4g. Vorkomprimierte Nachbarn ------------------------------------
     Caddy kann Brotli nicht selbst erzeugen — "encode" beherrscht nur gzip
     und zstd. zstd verstehen bisher nur neuere Chrome und Firefox; Safari
     nicht. Brotli dagegen versteht jeder Browser, den diese Seite je sieht.

     Deshalb wird hier zur Bauzeit einmal auf hoechster Stufe gepackt und
     daneben abgelegt. "file_server precompressed br gzip" reicht die fertige
     Datei durch, wenn der Browser sie annimmt. Das kostet in der Auslieferung
     keine Rechenzeit — im Gegenteil, es spart die, die Caddy sonst je Anfrage
     fuer gzip aufwendet — und ist gruendlicher, als es ein Server unter Zeit-
     druck je waere: Stufe 11 statt der ueblichen 4 bis 6.

     Die gzip-Fassung bleibt daneben liegen, fuer den Fall, dass ein Client
     kein Brotli anbietet. Schriften und PNG sind bereits komprimiert und
     werden ausgelassen — ein zweiter Durchgang macht sie nur groesser. */
  const PACKBAR = /\.(html|css|js|txt|xml|json|svg)$/;
  let vorherRoh = 0, nachherBr = 0, nachherGz = 0, gepackt = 0;

  const packeVerzeichnis = async (verzeichnis) => {
    for (const eintrag of await readdir(verzeichnis, { withFileTypes: true })) {
      const pfad = join(verzeichnis, eintrag.name);
      if (eintrag.isDirectory()) { await packeVerzeichnis(pfad); continue; }
      if (!PACKBAR.test(eintrag.name)) continue;

      const inhalt = await readFile(pfad);
      const br = brotliCompressSync(inhalt, {
        params: {
          [zlibKonstanten.BROTLI_PARAM_QUALITY]: 11,
          [zlibKonstanten.BROTLI_PARAM_SIZE_HINT]: inhalt.length,
        },
      });
      const gz = gzipSync(inhalt, { level: 9 });

      /* Nur ablegen, was sich lohnt. Bei sehr kleinen Dateien kann die
         gepackte Fassung groesser sein als das Original — dann bleibt es
         beim Original, und der Server liefert es unverpackt aus. */
      if (br.length < inhalt.length) await writeFile(pfad + '.br', br);
      if (gz.length < inhalt.length) await writeFile(pfad + '.gz', gz);
      vorherRoh += inhalt.length; nachherBr += br.length; nachherGz += gz.length;
      gepackt++;
    }
  };
  await packeVerzeichnis(ZIEL);
  log('─'.repeat(66));
  log(`Vorgepackt   ${gepackt} Dateien   roh ${kb(vorherRoh)} → gzip ${kb(nachherGz)} → brotli ${kb(nachherBr)}`);
  log(`             Brotli spart gegenueber gzip ${kb(nachherGz - nachherBr)} ` +
      `(${(100 - nachherBr / nachherGz * 100).toFixed(1)} %)`);

  /* ---- 5. Bilanz -------------------------------------------------------- */
  log('─'.repeat(66));
  const quelleGesamt = summeVorher + Buffer.byteLength(cssRoh) + Buffer.byteLength(jsRoh) + fontBytes;
  const zielGesamt   = summeNachher + fontBytes;
  log(`Quelle gesamt ${kb(quelleGesamt)}     Auslieferung ${kb(zielGesamt)}`);
  log(`Anfragen beim Erstaufruf: 1 HTML + ${fontDateien.length} Schriften (vorher 1 + 2 CSS + 1 JS + ${fontDateien.length})`);
  log(`\nFertig in ${Date.now() - t0} ms → dist/\n`);
}

build().catch((e) => { console.error('\n\x1b[31mBuild abgebrochen:\x1b[0m', e.message, '\n'); process.exit(1); });
