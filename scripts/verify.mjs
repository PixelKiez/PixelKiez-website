/* =========================================================================
   Abnahme des fertigen dist/-Baums.

   build.mjs prueft jede Seite waehrend des Zusammenbaus. Hier wird geprueft,
   was sich erst am Gesamtergebnis zeigt: verwaiste Dateien, Verweise ins
   Leere, Reste der Quellstruktur.  Beendet sich mit Code 1, wenn etwas
   nicht stimmt — damit taugt es als Tor vor einem Deploy.
   ========================================================================= */

import { readFile, readdir, stat } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { createContext, runInContext } from 'node:vm';

const ZIEL = join(fileURLToPath(new URL('..', import.meta.url)), 'dist');

/* Jede ausgelieferte Seite mit ihren Erwartungen. `paar` verbindet die beiden
   Fassungen einer Quelle: der Umschalter der einen Seite muss exakt auf die
   andere zeigen. Seiten ohne `paar` sind einsprachig und tragen weder
   hreflang noch Umschalter. `kanonisch` ist der Pfad, den das canonical der
   fertigen Seite nennen muss. */
const DOMAIN = 'https://pixelkiez.de';
/* Dieselbe Adresse einmal zerlegt. Wer Herkunft prueft, vergleicht Protokoll
   und Wirt getrennt — ein Zeichenkettenvergleich auf den Anfang von DOMAIN
   wuerde fremde Wirte einschliessen (siehe W-7). */
const HERKUNFT = new URL(DOMAIN);
const SEITEN = [
  { pfad: 'index.html',                    lang: 'de', kanonisch: '/',                       paar: { partner: '/en/',                 schalter: 'EN' } },
  { pfad: 'en/index.html',                 lang: 'en', kanonisch: '/en/',                    paar: { partner: '/',                    schalter: 'DE' } },
  { pfad: 'website-analyse/index.html',    lang: 'de', kanonisch: '/website-analyse/',       paar: { partner: '/en/website-analyse/', schalter: 'EN' } },
  { pfad: 'en/website-analyse/index.html', lang: 'en', kanonisch: '/en/website-analyse/',    paar: { partner: '/website-analyse/',    schalter: 'DE' } },
  /* Rechtstexte: zweisprachig, aber mit je eigener Quelle (EIGENE_PAARE in
     seiten.mjs). Fuer die Abnahme sind es gewoehnliche Sprachpaare — sie
     muessen aufeinander zeigen wie alle anderen auch. */
  { pfad: 'impressum.html',                lang: 'de', kanonisch: '/impressum.html',   paar: { partner: '/en/imprint.html', schalter: 'EN' } },
  { pfad: 'en/imprint.html',               lang: 'en', kanonisch: '/en/imprint.html',  paar: { partner: '/impressum.html',  schalter: 'DE' } },
  { pfad: 'datenschutz.html',              lang: 'de', kanonisch: '/datenschutz.html', paar: { partner: '/en/privacy.html', schalter: 'EN' } },
  { pfad: 'en/privacy.html',               lang: 'en', kanonisch: '/en/privacy.html',  paar: { partner: '/datenschutz.html', schalter: 'DE' } },
  /* Leistungsseiten. Drei der vier Leistungsfelder der Startseite haben eine
     eigene Seite; das vierte (SEO, GEO und AI Visibility) verweist bewusst
     auf den vorhandenen Wissensbeitrag statt auf eine eigene Adresse. */
  { pfad: 'webdesign-redesign/index.html',    lang: 'de', kanonisch: '/webdesign-redesign/',    leistung: true, paar: { partner: '/en/web-design/',          schalter: 'EN' } },
  { pfad: 'en/web-design/index.html',         lang: 'en', kanonisch: '/en/web-design/',         leistung: true, paar: { partner: '/webdesign-redesign/',     schalter: 'DE' } },
  { pfad: 'digitale-funktionen/index.html',   lang: 'de', kanonisch: '/digitale-funktionen/',   leistung: true, paar: { partner: '/en/digital-features/',    schalter: 'EN' } },
  { pfad: 'en/digital-features/index.html',   lang: 'en', kanonisch: '/en/digital-features/',   leistung: true, paar: { partner: '/digitale-funktionen/',    schalter: 'DE' } },
  { pfad: 'care/index.html',                  lang: 'de', kanonisch: '/care/',                  leistung: true, paar: { partner: '/en/care/',               schalter: 'EN' } },
  { pfad: 'en/care/index.html',               lang: 'en', kanonisch: '/en/care/',               leistung: true, paar: { partner: '/care/',                  schalter: 'DE' } },
  /* Wissensbereich, seit PXK-28/PXK-29 veroeffentlicht. `wissen` markiert
     eine Seite des Bereichs; `hub` zusaetzlich die Uebersichtsseite, von
     der aus jeder Beitrag erreichbar sein muss. Wo frueher noindex Pflicht
     war, ist es jetzt verboten — dieselbe Tabelle, umgekehrtes Vorzeichen. */
  { pfad: 'wissen/index.html',                          lang: 'de', kanonisch: '/wissen/',                          wissen: true, hub: true, paar: { partner: '/en/knowledge/',                       schalter: 'EN' } },
  { pfad: 'en/knowledge/index.html',                    lang: 'en', kanonisch: '/en/knowledge/',                    wissen: true, hub: true, paar: { partner: '/wissen/',                            schalter: 'DE' } },
  { pfad: 'wissen/seo-geo-ai-visibility/index.html',    lang: 'de', kanonisch: '/wissen/seo-geo-ai-visibility/',    wissen: true, paar: { partner: '/en/knowledge/seo-geo-ai-visibility/', schalter: 'EN' } },
  { pfad: 'en/knowledge/seo-geo-ai-visibility/index.html', lang: 'en', kanonisch: '/en/knowledge/seo-geo-ai-visibility/', wissen: true, paar: { partner: '/wissen/seo-geo-ai-visibility/',   schalter: 'DE' } },
  { pfad: 'wissen/wie-ki-websites-liest/index.html',    lang: 'de', kanonisch: '/wissen/wie-ki-websites-liest/',    wissen: true, paar: { partner: '/en/knowledge/how-ai-reads-websites/', schalter: 'EN' } },
  { pfad: 'en/knowledge/how-ai-reads-websites/index.html', lang: 'en', kanonisch: '/en/knowledge/how-ai-reads-websites/', wissen: true, paar: { partner: '/wissen/wie-ki-websites-liest/',   schalter: 'DE' } },
  { pfad: 'wissen/wie-websites-ausgeliefert-werden/index.html', lang: 'de', kanonisch: '/wissen/wie-websites-ausgeliefert-werden/', wissen: true, k6: true, paar: { partner: '/en/knowledge/how-websites-are-delivered/', schalter: 'EN' } },
  { pfad: 'en/knowledge/how-websites-are-delivered/index.html', lang: 'en', kanonisch: '/en/knowledge/how-websites-are-delivered/', wissen: true, k6: true, paar: { partner: '/wissen/wie-websites-ausgeliefert-werden/', schalter: 'DE' } },
  { pfad: 'wissen/answerability/index.html',            lang: 'de', kanonisch: '/wissen/answerability/',            wissen: true, paar: { partner: '/en/knowledge/answerability/',        schalter: 'EN' } },
  { pfad: 'en/knowledge/answerability/index.html',      lang: 'en', kanonisch: '/en/knowledge/answerability/',      wissen: true, paar: { partner: '/wissen/answerability/',              schalter: 'DE' } },
  { pfad: 'wissen/entity-trust/index.html',             lang: 'de', kanonisch: '/wissen/entity-trust/',             wissen: true, paar: { partner: '/en/knowledge/entity-trust/',         schalter: 'EN' } },
  { pfad: 'en/knowledge/entity-trust/index.html',       lang: 'en', kanonisch: '/en/knowledge/entity-trust/',       wissen: true, paar: { partner: '/wissen/entity-trust/',               schalter: 'DE' } },
  { pfad: 'wissen/agent-readiness/index.html',          lang: 'de', kanonisch: '/wissen/agent-readiness/',          wissen: true, paar: { partner: '/en/knowledge/agent-readiness/',      schalter: 'EN' } },
  { pfad: 'en/knowledge/agent-readiness/index.html',    lang: 'en', kanonisch: '/en/knowledge/agent-readiness/',    wissen: true, paar: { partner: '/wissen/agent-readiness/',            schalter: 'DE' } },
];

const fehler = [];
const hinweise = [];
const F = (s) => fehler.push(s);
const kb = (n) => (n / 1024).toFixed(1) + ' KB';
// Sonderzeichen eines Pfads entschaerfen, damit er woertlich in einen RegExp passt
const regexEscape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

async function existiert(p) { try { await stat(p); return true; } catch { return false; } }

/* -------------------------------------------------------------------------
   Kleiner Regel-Leser fuer eingebettetes CSS. Liefert Selektor,
   Deklarationen und die umschliessenden At-Regeln jeder Stilregel.
   Zeichenketten werden uebersprungen, damit eine geschweifte Klammer darin
   die Zaehlung nicht verschiebt.

   Die Bedingungen mitzufuehren ist kein Beiwerk: eine Regel, die nur unter
   @media (prefers-reduced-motion) sichtbar macht, sieht sonst aus wie eine
   Grundregel — und waere doch keine.

   Kein Parser fuer alle Faelle — genug fuer die eine Frage unten, und ohne
   neue Abhaengigkeit.
   ------------------------------------------------------------------------- */
function stilRegeln(quelle) {
  // Kommentare zuerst weg: im ausgelieferten CSS gibt es keine, aber ein
  // Kommentar unmittelbar vor einer Regel wuerde sonst Teil des Selektors.
  const css = quelle.replace(/\/\*[\s\S]*?\*\//g, ' ');
  const raus = [];
  const stapel = [];                 // {at:true,kopf} fuer At-Regeln, {at:false} sonst
  let i = 0, kopf = 0;
  while (i < css.length) {
    const c = css[i];
    if (c === '"' || c === "'") {
      const q = c; i++;
      while (i < css.length && css[i] !== q) { i += css[i] === '\\' ? 2 : 1; }
      i++; continue;
    }
    if (c === '{') {
      const k = css.slice(kopf, i).trim();
      const istAt = k.startsWith('@');
      if (!istAt) {
        raus.push({
          selektor: k, start: i + 1, dekl: undefined,
          bedingungen: stapel.filter((s) => s.at).map((s) => s.kopf),
        });
      }
      stapel.push({ at: istAt, kopf: k });
      i++; kopf = i; continue;
    }
    if (c === '}') {
      const zu = stapel.pop();
      if (zu && zu.at === false) {
        for (let n = raus.length - 1; n >= 0; n--) {
          if (raus[n].dekl === undefined) { raus[n].dekl = css.slice(raus[n].start, i); break; }
        }
      }
      i++; kopf = i; continue;
    }
    i++;
  }
  return raus.filter((r) => r.dekl !== undefined);
}

/* -------------------------------------------------------------------------
   PXK-23: Das Einblenden beim Scrollen darf Inhalt nicht zur Geisel nehmen.

   Geprueft wird die Architektur, nicht die Optik — kein Suchen nach einer
   bestimmten Zeichenkette, sondern vier Aussagen ueber das ausgelieferte
   Dokument, die zusammen "ohne JavaScript sichtbar" ergeben:

     1. Keine Regel versteckt [data-reveal] — oder irgendetwas, dessen
        Sichtbarkeit an der Skript-Klasse .in haengt —, ohne unter dem
        Merkmal data-reveal-anim zu stehen.
     2. Es gibt eine Grundregel ohne dieses Merkmal, die sichtbar macht —
        und zwar bedingungslos, nicht erst unter einer Media Query. Nur
        unter prefers-reduced-motion sichtbar zu sein hilft dem Besucher
        ohne JavaScript nicht.
     3. Irgendein Skript der Seite setzt das Merkmal — und der Vorlauf im
        <head>, der es setzt, nimmt es zu DOMContentLoaded auch selbst
        wieder zurueck, wenn sich bis dahin niemand darum gekuemmert hat.
        Ohne dieses Zuruecknehmen bliebe ein Fehlschlag des Hauptskripts als
        leere Seite stehen. Geprueft wird das nicht am Quelltext, sondern am
        Verhalten (siehe vorlaufMaengel weiter unten).
     4. Gesetzt wird es im <head>. Weiter hinten waere die Seite bereits
        gemalt und der fertige Inhalt blitzte auf, bevor er sich versteckt.

   Faellt eine davon, kann eine Seite wieder leer ausgeliefert werden.
   ------------------------------------------------------------------------- */
const MERKMAL = 'data-reveal-anim';
const REVEAL_SEL = /\[data-reveal\](?![-\w])/;
const setzt = (c) => new RegExp(`setAttribute\\(\\s*["']${MERKMAL}["']`).test(c);

/* -------------------------------------------------------------------------
   Der ausgelieferte Vorlauf wird nicht gelesen, sondern ausgefuehrt.

   Punkt 3 stand frueher als Suche nach removeAttribute ueber alle Skripte
   der Seite. Das war zu grob und deckte genau den Fall nicht ab, um den es
   geht: bds.js enthaelt denselben Aufruf (in `aufgeben()`), und bds.js ist
   das Skript, dessen Ausbleiben der Rueckfall abfangen soll. Faellt der
   Rueckfall aus dem Vorlauf heraus, findet die Suche ihn weiterhin in
   bds.js und bleibt gruen — waehrend der Browser die Seite leer ausliefert,
   sobald bds.js blockiert wird oder beim Auswerten scheitert.

   Deshalb laeuft der Vorlauf hier wirklich: in einem eigenen vm-Kontext mit
   einem winzigen Ersatz-DOM, ohne Browser und ohne Zufall. Der Ersatz kennt
   nur, was der Vorlauf anfasst — documentElement mit den vier
   Merkmal-Methoden, addEventListener, matchMedia und IntersectionObserver.
   ------------------------------------------------------------------------- */
function laufVorlauf(code) {
  const merkmale = new Map();
  const lauscher = [];
  const wurzel = {
    setAttribute: (n, v) => { merkmale.set(n, String(v)); },
    getAttribute: (n) => (merkmale.has(n) ? merkmale.get(n) : null),
    removeAttribute: (n) => { merkmale.delete(n); },
    hasAttribute: (n) => merkmale.has(n),
  };
  /* Der Fall, um den es geht: Beobachter vorhanden, Bewegung nicht
     reduziert — nur dann spannt der Vorlauf den Vorzustand ueberhaupt auf,
     und nur dann braucht er den Rueckfall. */
  const kontext = createContext({
    window: { IntersectionObserver: function () {}, matchMedia: () => ({ matches: false }) },
    document: { documentElement: wurzel, addEventListener: (typ, fn) => { lauscher.push([typ, fn]); } },
  });
  runInContext(code, kontext, { timeout: 2000 });
  return {
    merkmal: () => (merkmale.has(MERKMAL) ? merkmale.get(MERKMAL) : null),
    uebernimm: (wert) => { merkmale.set(MERKMAL, wert); },   // das tut bds.js, wenn der Beobachter steht
    feuere: (typ) => {
      const treffer = lauscher.filter(([t]) => t === typ);
      for (const [, fn] of treffer) fn({ type: typ });
      return treffer.length;
    },
  };
}

/* Liefert die Liste dessen, was am Verhalten eines Vorlaufs fehlt — leer
   heisst: er deckt den Ausfall von bds.js ab. */
function vorlaufMaengel(code) {
  const maengel = [];
  let lauf;
  try { lauf = laufVorlauf(code); }
  catch (e) { return [`der Vorlauf wirft beim Ausfuehren (${e.message})`]; }

  if (lauf.merkmal() !== 'bereit')
    maengel.push(`er spannt den Vorzustand nicht auf (${MERKMAL} steht nach dem Lauf auf ${JSON.stringify(lauf.merkmal())} statt "bereit")`);

  /* Ab hier laeuft KEIN weiteres Skript — das ist der ganze Punkt: genau so
     sieht die Seite aus, wenn bds.js nicht ankommt. */
  if (!lauf.feuere('DOMContentLoaded'))
    maengel.push('er meldet sich nicht auf DOMContentLoaded an — bleibt bds.js aus, nimmt niemand den Vorzustand zurueck');
  else if (lauf.merkmal() !== null)
    maengel.push(`er nimmt ${MERKMAL} zu DOMContentLoaded nicht zurueck (steht danach auf ${JSON.stringify(lauf.merkmal())}) — bleibt bds.js aus, bliebe der Inhalt unsichtbar`);

  /* Die Gegenrichtung derselben Zeile: hat bds.js den Vorzustand
     uebernommen ("an"), darf der Rueckfall ihm nicht dazwischenfahren,
     sonst faellt das Einblenden bei jedem Aufruf aus. */
  try {
    const zweit = laufVorlauf(code);
    if (zweit.merkmal() === 'bereit') {
      zweit.uebernimm('an');
      zweit.feuere('DOMContentLoaded');
      if (zweit.merkmal() !== 'an')
        maengel.push(`er raeumt ${MERKMAL} auch dann ab, wenn bds.js es bereits auf "an" uebernommen hat — das Einblenden fiele bei jedem Aufruf aus`);
    }
  } catch (e) { maengel.push(`der zweite Lauf wirft (${e.message})`); }

  return maengel;
}

function pruefeReveal(seite, html, skripte) {
  const css = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n');
  const alle = stilRegeln(css);
  const regeln = alle.filter((r) => REVEAL_SEL.test(r.selektor));
  if (!regeln.length) return;                       // Seite kennt kein Reveal

  const verbirgt = (d) =>
    /(?:^|;)\s*opacity\s*:\s*(?:0|0?\.0+)\s*(?:!important)?\s*(?:;|$)/.test(d) ||
    /(?:^|;)\s*visibility\s*:\s*hidden/.test(d) ||
    /(?:^|;)\s*display\s*:\s*none/.test(d);
  const zeigt = (d) => /(?:^|;)\s*opacity\s*:\s*(?:1|100%)/.test(d);
  const gedeckt = (sel) => sel.includes(`[${MERKMAL}]`);

  /* Dieselbe Frage fuer den Rest der Reveal-Familie. Die Klasse .in vergibt
     ausschliesslich das Reveal-Skript; wer seine Sichtbarkeit daran haengt,
     ist ohne Skript unsichtbar, auch wenn er kein data-reveal traegt. Genau
     so verschwanden die Merkmale der Preiskarten.

     Verglichen wird von rechts, Kompaktselektor fuer Kompaktselektor: der
     versteckende Selektor muss im .in-Selektor (ohne .in gelesen) enthalten
     sein. `.pack ul li` steckt so in `.pack.in ul li`, `.pack__badge` in
     `.pack.in .pack__badge`. */
  const ohneIn = (s) => s.replace(/\.in(?![-\w])/g, '').replace(/\s+/g, ' ').trim();
  const teile = (s) => ohneIn(s).split(/\s+/).filter(Boolean);
  const stecktIn = (versteck, kandidat) => {
    const a = teile(versteck), b = teile(kandidat);
    if (!a.length || a.length > b.length) return false;
    for (let n = 1; n <= a.length; n++) {
      const av = a[a.length - n], bv = b[b.length - n];
      const stuecke = av.match(/[.#[][^.#[\s]*|^[a-z]+/g) || [av];
      if (!stuecke.every((t) => bv.includes(t))) return false;
    }
    return true;
  };
  const mitIn = alle.filter((r) => /\.in(?![-\w])/.test(r.selektor));
  const anIn = alle.filter((r) => !r.bedingungen.length && !gedeckt(r.selektor)
    && verbirgt(r.dekl) && mitIn.some((k) => stecktIn(r.selektor, k.selektor)));
  if (anIn.length)
    F(`${seite}: ${anIn.length} Regel(n) verstecken unbedingt, obwohl ihre Sichtbarkeit an der Skript-Klasse .in haengt — ohne JavaScript bliebe das unsichtbar: ${anIn.map((r) => r.selektor).slice(0, 4).join(' · ')}`);

  const offen = regeln.filter((r) => verbirgt(r.dekl) && !gedeckt(r.selektor));
  if (offen.length)
    F(`${seite}: [data-reveal] wird ohne ${MERKMAL} versteckt — ohne JavaScript bliebe der Inhalt unsichtbar (${offen[0].selektor})`);

  if (!regeln.some((r) => !gedeckt(r.selektor) && zeigt(r.dekl) && !r.bedingungen.length))
    F(`${seite}: keine bedingungslose Grundregel, die [data-reveal] ohne ${MERKMAL} sichtbar macht`);

  if (!regeln.some((r) => gedeckt(r.selektor))) return;   // kein Vorzustand, nichts weiter zu decken

  const code = skripte.join('\n');
  /* Setzt die Seite das Merkmal gar nicht, kann sie auch nichts verstecken —
     das ist der Zustand von Impressum und Datenschutz, die das gemeinsame
     CSS mitbekommen, aber kein Skript tragen. Fail-open ist dort ohne
     weiteres Zutun erfuellt. Ab hier geht es nur noch um Seiten, die den
     Vorzustand tatsaechlich aufspannen. */
  if (!setzt(code)) return;

  const kopfEnde = html.search(/<\/head>/i);
  const kopfSkripte = [...html.slice(0, kopfEnde === -1 ? 0 : kopfEnde)
    .matchAll(/<script(?![^>]*\bsrc=)(?![^>]*application\/ld\+json)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  const vorlaeufe = kopfSkripte.filter(setzt);
  if (!vorlaeufe.length) {
    F(`${seite}: ${MERKMAL} wird erst nach dem <head> gesetzt — der fertige Inhalt blitzte auf, bevor er sich versteckt`);
    return;
  }

  /* Wer den Vorzustand aufspannt, schuldet auch das Zuruecknehmen. Deshalb
     muss JEDER Vorlauf den Ausfall von bds.js allein abdecken — ein zweiter,
     der nur setzt, waere ein Loch, das kein anderer stopfen kann. */
  for (const vorlauf of vorlaeufe) {
    const maengel = vorlaufMaengel(vorlauf);
    if (maengel.length)
      F(`${seite}: der Vorlauf im <head> deckt den Ausfall von bds.js nicht ab — ${maengel.join('; ')}`);
  }
}

async function verify() {
  console.log('\n\x1b[1mAbnahme dist/\x1b[0m');
  console.log('─'.repeat(70));

  if (!(await existiert(ZIEL))) { F('dist/ fehlt — erst "npm run build" ausfuehren'); return ende(); }

  const fontVerzeichnis = join(ZIEL, 'assets', 'fonts');
  const fontsVorhanden = (await existiert(fontVerzeichnis))
    ? new Set(await readdir(fontVerzeichnis)) : new Set();
  const fontsBenutzt = new Set();

  for (const eintrag of SEITEN) {
    const seite = eintrag.pfad;
    const pfad = join(ZIEL, seite);
    if (!(await existiert(pfad))) { F(`${seite} fehlt in dist/`); continue; }
    const html = await readFile(pfad, 'utf8');

    /* --- nichts darf mehr extern nachgeladen werden --- */
    if (/<link[^>]+rel="stylesheet"/.test(html)) F(`${seite}: externes Stylesheet uebrig`);
    if (/<script[^>]+\bsrc=/.test(html))          F(`${seite}: externes Skript uebrig`);
    // Nur Attributpositionen pruefen. Die Datenschutzerklaerung nennt
    // assets/js/bds.js absichtlich im Fliesstext, wenn sie erklaert, wo der
    // ENDPOINT eingetragen wird — das ist Text, kein Ladeverweis.
    if (/(?:href|src|url\()\s*["']?[^"')]*assets\/css\//.test(html))
      F(`${seite}: Ladeverweis auf assets/css/ uebrig`);
    if (/(?:href|src|url\()\s*["']?[^"')]*assets\/js\//.test(html))
      F(`${seite}: Ladeverweis auf assets/js/ uebrig`);
    if (/\.\.\//.test(html.replace(/<script[\s\S]*?<\/script>/g, '')))
      F(`${seite}: relativer Pfad ../ ausserhalb des Skripts — zeigt ins Leere`);

    /* --- Schriftverweise muessen auf vorhandene Dateien zeigen --- */
    for (const m of html.matchAll(/assets\/fonts\/([^"')\s]+\.woff2)/g)) {
      const datei = basename(m[1]);
      fontsBenutzt.add(datei);
      if (!fontsVorhanden.has(datei)) F(`${seite}: Schrift referenziert, fehlt in dist/: ${datei}`);
      if (!/\.[0-9a-f]{8}\.woff2$/.test(datei)) F(`${seite}: Schrift ohne Inhalts-Hash: ${datei}`);
    }

    /* --- eingebettetes Skript muss gueltig sein --- */
    const skripte = [...html.matchAll(/<script(?![^>]*\bsrc=)(?![^>]*application\/ld\+json)[^>]*>([\s\S]*?)<\/script>/g)];
    for (const [, code] of skripte) {
      if (!code.trim()) continue;
      try { new Function(code); } catch (e) { F(`${seite}: eingebettetes Skript ungueltig — ${e.message}`); }
      if (/<\/?script/i.test(code)) F(`${seite}: Skript-Tag im Skriptinhalt`);
    }
    if (seite === 'index.html' && !skripte.length) F('index.html: kein eingebettetes Skript');

    /* --- Reveal bleibt fail-open (PXK-23) --- */
    pruefeReveal(seite, html, skripte.map(([, c]) => c));

    /* --- JSON-LD --- */
    for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
      try { JSON.parse(m[1]); } catch (e) { F(`${seite}: JSON-LD ungueltig — ${e.message}`); }
    }

    /* --- interne Verweise --- */
    for (const m of html.matchAll(/href="((?!https?:|mailto:|data:|#|\/\/)[^"]+)"/g)) {
      const ziel = m[1].split('#')[0];
      if (!ziel) continue;
      if (!(await existiert(join(ZIEL, ziel)))) F(`${seite}: Verweis ins Leere — ${ziel}`);
    }

    /* --- Sprachfassung: Auszeichnung, Canonical, Umschalter, Verweise --- */
    const en = eintrag.lang === 'en';
    if (!html.includes(`<html lang="${eintrag.lang}">`))
      F(`${seite}: <html lang="${eintrag.lang}"> fehlt`);
    if (!html.includes(`<link rel="canonical" href="${DOMAIN}${eintrag.kanonisch}">`))
      F(`${seite}: canonical zeigt nicht auf ${DOMAIN}${eintrag.kanonisch}`);
    /* --- W-1 Indexierbarkeit: die Wissensseiten sind freigegeben. Ein
       zurueckgekehrtes noindex nimmt sie still wieder aus dem Index, ohne
       dass der Seite etwas anzusehen waere — genau dafuer ist dieses Tor
       da. Geprueft wird jede robots-Angabe der Seite, nicht nur die erste:
       zwei widerspruechliche Angaben sind ebenfalls ein Fehler. --- */
    if (eintrag.wissen) {
      const robots = [...html.matchAll(/<meta name="robots" content="([^"]*)">/g)].map((m) => m[1]);
      if (!robots.length) F(`${seite}: keine robots-Angabe — Freigabe waere nicht ausgesprochen`);
      if (robots.length > 1) F(`${seite}: ${robots.length} robots-Angaben — widerspruechliche Signale`);
      for (const r of robots) {
        if (/noindex/i.test(r)) F(`${seite}: robots="${r}" enthaelt noindex — freigegebene Wissensseite waere unsichtbar`);
        if (!/\bindex\b/.test(r) || !/\bfollow\b/.test(r))
          F(`${seite}: robots="${r}" nennt nicht index und follow`);
      }
    }
    /* --- Wissensbereich: Themennetz, kein Kurs (Slice 2.1) ---
       Der Bereich ist als zusammenhaengendes Themensystem beschlossen, nicht
       als sequenzieller Lernpfad. Kurs-Wortlaut kaeme bei einer Ueberarbeitung
       leicht zurueck — deshalb hier gegen dist/ verankert. */
    if (eintrag.wissen) {
      const kursMuster = eintrag.lang === 'en'
        ? [/learning path/i, /five steps/i, /step \d of 5/i]
        : [/Lernpfad/, /fünf Schritte/, /Schritt \d von 5/,
           /01 · Finden/, /02 · Lesen/, /03 · Antworten/, /04 · Erkennen/, /05 · Handeln/];
      for (const m of kursMuster) {
        if (m.test(html))
          F(`${seite}: Kurs-Framing /${m.source}/ — Wissensbereich ist ein Themennetz, kein Lernpfad`);
      }
    }
    /* Analyse-Seite: eine Uebersicht beraet niemanden — die Floskel ist
       durch den freigegebenen Wortlaut ersetzt und darf nicht zurueckkehren. */
    if (seite === 'website-analyse/index.html' && html.includes('von einer KI-Übersicht beraten'))
      F(`${seite}: Floskel "von einer KI-Übersicht beraten" — ersetzt durch den freigegebenen Wortlaut (Slice 2.1)`);
    if (eintrag.paar) {
      const pfadDe = eintrag.lang === 'de' ? eintrag.kanonisch : eintrag.paar.partner;
      const pfadEn = eintrag.lang === 'en' ? eintrag.kanonisch : eintrag.paar.partner;
      for (const [hl, zielPfad] of [['de', pfadDe], ['en', pfadEn], ['x-default', pfadDe]]) {
        if (!html.includes(`<link rel="alternate" hreflang="${hl}" href="${DOMAIN}${zielPfad}">`))
          F(`${seite}: hreflang="${hl}" zeigt nicht auf ${DOMAIN}${zielPfad}`);
      }
      const s2 = html.match(/<a class="lang"[^>]*href="([^"]*)"[^>]*>([^<]*)</);
      if (!s2) F(`${seite}: Sprachumschalter fehlt`);
      else if (s2[1] !== eintrag.paar.partner || s2[2] !== eintrag.paar.schalter)
        F(`${seite}: Umschalter zeigt auf ${s2[1]} mit "${s2[2]}" statt ${eintrag.paar.partner} und ${eintrag.paar.schalter}`);
    }
    // Seiten unterhalb der Wurzel duerfen keine relativen Verweise tragen:
    // sie liegen eine Ebene tiefer, relative Pfade zeigten dort ins Leere.
    if (seite.includes('/')) {
      for (const m of html.matchAll(/(?:href|src)="(?!https?:|mailto:|data:|#|\/)([^"]+)"/g)) {
        F(`${seite}: relativer Verweis "${m[1]}" — von /${seite.slice(0, seite.lastIndexOf('/'))}/ aus falsch`);
      }
    }
    if (en) {
      /* Eigennamen, die auch auf einer englischen Seite deutsch bleiben
         muessen: die Aufsichtsbehoerde heisst so, wie sie heisst — uebersetzt
         findet sie niemand wieder. Die Liste steht namentlich da und ist
         bewusst kurz. Eine weiche Regel ("Umlaute in Absaetzen erlauben")
         haette den Test entwertet, der genau dafuer da ist, vergessene
         deutsche Reste zu finden. */
      const DEUTSCHE_EIGENNAMEN = [
        'Berliner Beauftragte für Datenschutz und Informationsfreiheit',
      ];
      let sichtbar = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<[^>]+>/g, ' ');
      for (const name of DEUTSCHE_EIGENNAMEN) sichtbar = sichtbar.split(name).join(' ');
      if (/[äöüÄÖÜß]/.test(sichtbar))
        F(`${seite}: Umlaute im sichtbaren Text — vermutlich deutscher Rest`);

      /* Englische Seiten verweisen auf englische Fassungen. Ein href oder
         action auf einen deutschen Paar-Pfad schickt den Besucher mitten im
         englischen Auftritt auf die deutsche Seite — erlaubt ist das nur dem
         Sprachumschalter (der genau dafuer da ist) und den bewusst deutsch
         gehaltenen Rechtsseiten. Gefunden am 30.08.2026: das Analyse-Band
         und der Footer-Link der englischen Startseite zeigten auf
         /website-analyse/ statt /en/website-analyse/. */
      /* Zwei Stellen duerfen bewusst auf die deutsche Fassung zeigen: der
         Sprachumschalter und, auf den englischen Rechtstexten, der Hinweis
         darauf, welche Fassung die massgebliche ist. Eine Uebersetzung ist
         eine Lesehilfe; der Verweis auf das Original gehoert dazu und ist
         kein vergessener Link. */
      const ohneSchalter = html
        .replace(/<a class="lang"[^>]*data-lang-switch>[^<]*<\/a>/, '')
        .replace(/<p class="hinweis-fassung">[\s\S]*?<\/p>/, '');
      const dePfade = SEITEN.filter((s) => s.lang === 'de' && s.paar).map((s) => s.kanonisch);
      for (const dePfad of dePfade) {
        const muster = new RegExp(
          `(?:href|action)="${regexEscape(dePfad)}(?:#[^"]*)?"`, 'g');
        for (const m of ohneSchalter.matchAll(muster)) {
          F(`${seite}: Verweis ${m[0]} auf die deutsche Fassung — muss auf /en/… zeigen`);
        }
      }
    }

    /* --- Bildverweise muessen auf eine vorhandene Datei zeigen ---
       Bisher wurden nur Schriften geprueft. Dadurch blieb monatelang
       unbemerkt, dass das Firmenlogo im JSON-LD auf assets/img/og.png zeigte
       — eine Adresse, die es nie gab, weil ausgeliefert wird mit Inhalts-Hash.
       Der Seite sah man nichts an; es fehlte nur das Logo in allem, was
       Suchmaschinen daraus bauen. Genau diese Sorte Fehler gehoert in eine
       Abnahme, weil sie sich sonst niemandem zeigt. */
    for (const m of html.matchAll(/(?:https:\/\/[a-z0-9.-]+)?\/assets\/img\/([A-Za-z0-9._-]+)/g)) {
      if (!(await existiert(join(ZIEL, 'assets', 'img', m[1]))))
        F(`${seite}: Bildverweis zeigt ins Leere: assets/img/${m[1]}`);
    }

    /* --- SVG-Attribute in Grossschreibung --- */
    for (const attr of ['viewBox', 'startOffset', 'preserveAspectRatio']) {
      if (html.includes(attr.toLowerCase() + '=') && !html.includes(attr + '='))
        F(`${seite}: SVG-Attribut ${attr} kleingeschrieben`);
    }

    /* --- vorgepackte Nachbarn ---
       Fehlt die .br-Datei, liefert Caddy die Seite klaglos unverpackt aus.
       Das faellt niemandem auf — die Seite ist ja da —, kostet aber bei
       dieser Startseite rund 117 KB je Aufruf. Deshalb ein Fehler, kein
       Hinweis. */
    const roh = Buffer.byteLength(html);
    let brGroesse = 0;
    for (const [endung, name] of [['.br', 'Brotli'], ['.gz', 'gzip']]) {
      if (!(await existiert(pfad + endung))) {
        F(`${seite}: ${name}-Fassung ${basename(seite) + endung} fehlt — ` +
          'Caddy liefert die Seite dann unkomprimiert aus');
        continue;
      }
      const { size } = await stat(pfad + endung);
      if (size >= roh) F(`${seite}: ${name}-Fassung ist nicht kleiner als das Original`);
      if (endung === '.br') brGroesse = size;
    }

    const gz = gzipSync(Buffer.from(html), { level: 9 }).length;
    console.log(`  ${seite.padEnd(20)} ${kb(roh).padStart(9)}  gzip ${kb(gz).padStart(9)}  ` +
                `brotli ${kb(brGroesse).padStart(9)}  ` +
                `${skripte.length} Skript, ${(html.match(/<style>/g) || []).length} Stilblock`);
  }

  /* --- Funnel-Einstieg: die Startseite muss zur Analyse-Seite fuehren ---
     Der Einstieg ist ein GET-Formular (action) oder ein Link (href). Faellt
     er beim Ueberarbeiten der Startseite heraus, ist die Analyse-Seite von
     der Startseite aus unerreichbar — genau das soll hier auffallen. */
  if (await existiert(join(ZIEL, 'index.html'))) {
    const start = await readFile(join(ZIEL, 'index.html'), 'utf8');
    if (!/(?:href|action)="\/website-analyse\/"/.test(start))
      F('index.html: kein Einstieg zur Website-Analyse (/website-analyse/) gefunden');
  }

  /* =====================================================================
     Freigabe-Tore des Wissensbereichs (PXK-28/PXK-29).

     Bis zu diesem Release stand hier das Gegenteil: die Wissensseiten
     durften weder in der Sitemap noch in llms.txt stehen und von keiner
     veroeffentlichten Seite verlinkt sein. Mit der Freigabe kehren sich
     alle diese Tore um. Sie sind bewusst nicht geloescht worden — ein
     Bereich, der oeffentlich ist, braucht mindestens so viel Abnahme wie
     einer, der es nicht sein durfte.

     Geprueft wird gegen dist/, also gegen das, was ausgeliefert wuerde.
     ===================================================================== */
  const wissensSeiten = SEITEN.filter((s) => s.wissen);
  const wissensPfade = wissensSeiten.map((s) => s.kanonisch);
  const hubs = wissensSeiten.filter((s) => s.hub);

  /* --- W-2 Kein Entwurfsrest.

     Zwei Klassen und ihre sichtbaren Etiketten markierten frueher, dass
     ein Abschnitt noch nicht geschrieben war. Sie sind aus CSS und Markup
     entfernt. Kaeme eine davon zurueck, saehe der Bereich auf einer
     einzigen Seite wieder wie eine Baustelle aus — und niemandem faellt
     das beim Bauen einer anderen Seite auf. --- */
  for (const eintrag of wissensSeiten) {
    const pfad = join(ZIEL, eintrag.pfad);
    if (!(await existiert(pfad))) continue;
    const html = await readFile(pfad, 'utf8');
    for (const marke of ['wissen-status', 'wissen-platzhalter']) {
      if (html.includes(marke)) F(`${eintrag.pfad}: Entwurfsmarkierung ${marke} — der Bereich ist freigegeben`);
    }
  }

  /* --- W-3 Jede freigegebene Wissensseite steht in der Sitemap.

     Der Build nimmt nur Seiten mit entwurf:true heraus. Kaeme das Flag
     zurueck oder fiele ein Eintrag aus dem Seitenregister, waere die Seite
     weiterhin erreichbar, aber fuer eine Suchmaschine unangemeldet. --- */
  if (!(await existiert(join(ZIEL, 'sitemap.xml')))) {
    F('sitemap.xml fehlt in dist/');
  } else {
    const sitemap = await readFile(join(ZIEL, 'sitemap.xml'), 'utf8');
    for (const pf of wissensPfade) {
      if (!sitemap.includes(`<loc>${DOMAIN}${pf}</loc>`))
        F(`sitemap.xml nennt die freigegebene Wissensseite ${pf} nicht`);
    }
  }

  /* --- W-4 robots.txt sperrt den Bereich nicht.

     Die Datei laesst heute alles zu. Eine spaetere Disallow-Zeile auf
     /wissen/ waere ein stiller Rueckzug der Freigabe. --- */
  if (!(await existiert(join(ZIEL, 'robots.txt')))) {
    F('robots.txt fehlt in dist/');
  } else {
    const robots = await readFile(join(ZIEL, 'robots.txt'), 'utf8');
    for (const zeile of robots.split(/\r?\n/)) {
      const m = zeile.match(/^\s*Disallow:\s*(\S+)/i);
      if (!m) continue;
      for (const pf of wissensPfade) {
        if (pf.startsWith(m[1])) F(`robots.txt sperrt ${pf} ueber "${zeile.trim()}"`);
      }
    }
  }

  /* --- W-5 Jeder Beitrag ist ueber seinen Hub erreichbar.

     Eine Seite, die in der Sitemap steht, aber von nirgends verlinkt ist,
     ist eine Waise. Geprueft wird sprachrein: der deutsche Hub muss die
     deutschen Beitraege nennen, der englische die englischen. --- */
  for (const hub of hubs) {
    const pfad = join(ZIEL, hub.pfad);
    if (!(await existiert(pfad))) { F(`${hub.pfad} fehlt — Wissens-Hub nicht gebaut`); continue; }
    const html = await readFile(pfad, 'utf8');
    for (const eintrag of wissensSeiten) {
      if (eintrag.hub || eintrag.lang !== hub.lang) continue;
      if (!html.includes(`href="${eintrag.kanonisch}"`))
        F(`${hub.pfad}: verlinkt ${eintrag.kanonisch} nicht — der Beitrag waere nur ueber die Sitemap zu finden`);
    }
  }

  /* --- W-6 Kein interner Wissensverweis zeigt ins Leere.

     Die Verweispruefung weiter oben faellt bei wurzelabsoluten Adressen
     auf das Verzeichnis herein: dist/wissen/answerability/ existiert auch
     dann, wenn darin keine index.html liegt. Hier wird die Datei selbst
     verlangt. --- */
  for (const eintrag of SEITEN) {
    const pfad = join(ZIEL, eintrag.pfad);
    if (!(await existiert(pfad))) continue;
    const html = await readFile(pfad, 'utf8');
    for (const m of html.matchAll(/href="(\/(?:wissen|en\/knowledge)\/[^"#]*)"/g)) {
      const ziel = m[1].endsWith('/') ? m[1] + 'index.html' : m[1];
      if (!(await existiert(join(ZIEL, ziel))))
        F(`${eintrag.pfad}: Wissensverweis ${m[1]} fuehrt ins Leere`);
    }
  }

  /* --- W-7 Strukturierte Daten sind vorhanden und vollstaendig.

     Dass das JSON-LD gueltig ist, prueft die Schleife oben. Hier geht es
     um das, was ein fehlender Block nicht meldet: dass er fehlt. Jede
     Wissensseite braucht ihre Brotkrumen, jeder Beitrag zusaetzlich den
     Artikelknoten, jeder Hub die Liste. --- */
  for (const eintrag of wissensSeiten) {
    const pfad = join(ZIEL, eintrag.pfad);
    if (!(await existiert(pfad))) continue;
    const html = await readFile(pfad, 'utf8');
    const bloecke = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
    if (!bloecke.length) { F(`${eintrag.pfad}: kein JSON-LD — freigegebene Seite ohne strukturierte Daten`); continue; }
    const typen = new Set();
    const kennungen = new Set();
    const sammle = (o) => {
      if (Array.isArray(o)) return o.forEach(sammle);
      if (!o || typeof o !== 'object') return;
      if (typeof o['@type'] === 'string') typen.add(o['@type']);
      if (typeof o['@id'] === 'string') kennungen.add(o['@id']);
      Object.values(o).forEach(sammle);
    };
    for (const [, roh] of bloecke) { try { sammle(JSON.parse(roh)); } catch { /* die Schleife oben meldet es */ } }
    const erwartet = eintrag.hub
      ? ['CollectionPage', 'BreadcrumbList', 'ItemList']
      : ['Article', 'WebPage', 'BreadcrumbList'];
    for (const t of erwartet) {
      if (!typen.has(t)) F(`${eintrag.pfad}: JSON-LD ohne ${t}`);
    }
    /* Die seitenbezogenen Kennungen muessen die eigene Adresse tragen —
       sonst truegen die deutsche und die englische Fassung dieselbe @id
       und eine Suchmaschine wuesste nicht, welches Dokument gemeint ist.

       Geprueft wird die zerlegte Adresse, nicht ihr Anfang. Ein Praefixtest
       (`k.startsWith(DOMAIN)`) haelt fremde Wirte fuer die eigene Domain,
       weil hinter `https://pixelkiez.de` beliebiger Text folgen darf:
       `https://pixelkiez.de.evil.example/…` haengt einen Punkt an,
       `https://pixelkiez.de@evil.example/…` schiebt alles davor in den
       Benutzernamen. Umgekehrt rutscht `https://evil.example/wissen/…`
       durch den Filter und wird gar nicht erst geprueft — die gefaehrlichste
       der drei Luecken. Der WHATWG-Parser trennt Protokoll, Anmeldedaten,
       Wirt und Pfad; verglichen wird jedes Stueck fuer sich. */
    for (const k of kennungen) {
      let u;
      try { u = new URL(k); } catch {
        F(`${eintrag.pfad}: JSON-LD-Kennung ${k} ist keine gueltige Adresse`);
        continue;
      }
      if (u.protocol !== HERKUNFT.protocol || u.host !== HERKUNFT.host
          || u.username !== '' || u.password !== '') {
        F(`${eintrag.pfad}: JSON-LD-Kennung ${k} gehoert zur fremden Herkunft `
          + `${u.protocol}//${u.host} statt zu ${DOMAIN}`);
        continue;
      }
      if (!k.includes('#')) continue;                // nur Marken benennen ein Dokument
      if (u.pathname === '/') continue;              // #organisation, #website: bewusst geteilt
      if (u.pathname !== eintrag.kanonisch)
        F(`${eintrag.pfad}: JSON-LD-Kennung ${k} gehoert zu ${u.pathname}, nicht zu ${eintrag.kanonisch}`);
    }
  }

  /* --- W-8 Der Deep Dive faellt nicht auf pauschale Behauptungen zurueck.

     Der Beitrag zur Auslieferung nennt genau die Saetze, die er nicht
     behauptet — in Anfuehrungszeichen, als Zitat einer verbreiteten
     Fehlannahme. Genau deshalb genuegt eine Textsuche hier nicht: sie
     wuerde von der Stelle erfuellt, gegen die sie schuetzt. Geprueft wird
     deshalb die Verwendung, nicht das Vorkommen — jede Fundstelle muss in
     Anfuehrungszeichen stehen. Steht der Satz als eigene Aussage da,
     schlaegt das Tor an.

     Zusaetzlich gibt es Formulierungen, die auch als Zitat nichts auf
     diesen Seiten zu suchen haben: eine zugesagte Wirkung. --- */
  const AUF = '[\u201e\u201c\u00ab\u2018]';
  const ZU  = '[\u201c\u201d\u00bb\u2019]';
  const NUR_ZITAT = [
    'Astro rankt besser', 'React ist schlecht f\u00fcr KI', 'Next\\.js ist besser als WordPress',
    'KI-Crawler f\u00fchren kein JavaScript aus', 'Google kann kein JavaScript',
    'serverseitig gerenderte Seiten ranken besser',
    'Astro ranks better', 'React is bad for AI', 'Next\\.js beats WordPress',
    'AI crawlers skip JavaScript', 'Google fails at JavaScript',
    'server-rendered pages rank better',
  ];
  /* Eine zugesagte Wirkung ist verboten — ihre Verneinung ist dagegen
     genau der Ton, den diese Seiten treffen sollen ("garantiert keine
     Nennungen", "does not guarantee visibility"). Ein blosses Muster
     traefe beide gleich. Deshalb wird bei jeder Fundstelle das Umfeld
     davor gelesen: steht dort eine Verneinung oder eine Warnung, ist es
     eine Abgrenzung und kein Versprechen. */
  const NIE = [
    /\bSSR garantiert\b/i,
    /\bgarantiert\s+(?:Ihnen\s+)?(?:bessere\s+)?(?:Rankings?|Sichtbarkeit|Nennungen|AI Visibility)/i,
    /\bguarantees?\s+(?:better\s+)?(?:rankings?|visibility|citations|AI visibility)/i,
    /\b(?:sorgt|sorgen)\s+f\u00fcr\s+(?:bessere\s+)?Rankings?/i,
  ];
  /* Verneinungen und Warnungen im Vorfeld einer Fundstelle. Das Fenster ist
     bewusst kurz: es soll den Satzteil davor fassen, nicht den Absatz. */
  const ABGRENZUNG = /\b(?:nicht|kein|keine|keinen|keiner|keinerlei|ohne|niemand|nie|warnt|warnung|not|no|never|without|fails|fail|cannot|avoid|warns|warn|rather than)\b/i;
  for (const eintrag of wissensSeiten) {
    const pfad = join(ZIEL, eintrag.pfad);
    if (!(await existiert(pfad))) continue;
    const html = await readFile(pfad, 'utf8');
    const text = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<[^>]+>/g, ' ');
    for (const satz of NUR_ZITAT) {
      const alle = new RegExp(satz, 'g');
      const zitiert = new RegExp(AUF + '\\s*' + satz + '\\s*' + ZU, 'g');
      const n = (text.match(alle) || []).length;
      const z = (text.match(zitiert) || []).length;
      if (n > z)
        F(`${eintrag.pfad}: "${satz.replace(/\\\\/g, '')}" steht ${n - z}x als eigene Aussage statt als Zitat — verbotene Pauschalbehauptung`);
    }
    for (const muster of NIE) {
      for (const t of text.matchAll(new RegExp(muster.source, muster.flags.includes('g') ? muster.flags : muster.flags + 'g'))) {
        const vorfeld = text.slice(Math.max(0, t.index - 60), t.index);
        if (ABGRENZUNG.test(vorfeld)) continue;
        F(`${eintrag.pfad}: zugesagte Wirkung "${t[0]}" — auf einer Wissensseite unzulaessig`);
      }
    }
  }

  /* --- W-9 Die Startseite fuehrt in den Wissensbereich.

     Ohne diesen Einstieg ist der Bereich fuer Besucher unsichtbar und fuer
     einen Crawler nur ueber die Sitemap erreichbar. Geprueft wird je
     Sprachfassung gegen den eigenen Hub. --- */
  for (const [start, hubPfad] of [['index.html', '/wissen/'], ['en/index.html', '/en/knowledge/']]) {
    if (!(await existiert(join(ZIEL, start)))) continue;
    const html = await readFile(join(ZIEL, start), 'utf8');
    if (!html.includes(`href="${hubPfad}"`))
      F(`${start}: kein Einstieg in den Wissensbereich (${hubPfad}) gefunden`);
  }

  /* --- H-1 bis H-4 Startseite: ein Inhalt, ein Knoten ---------------------

     Die Fragen liefen frueher als drei Endlosbaender; jedes Band trug seinen
     Satz doppelt, und die drei Baender wiederholten dieselben sechs Fragen —
     sechsunddreissig <article> fuer sechs Inhalte. Die Leistungskarten
     trugen Titel und Anreisser zweimal, einmal je Vorhang-Ebene.

     Beides ist strukturell aufgeloest. Diese Tore halten den Zustand:
     Vervielfachung faellt wieder auf, und das FAQ-Schema kann nicht mehr
     unbemerkt neben dem sichtbaren Text herlaufen.

     Geprueft werden beide Sprachfassungen der Startseite. Die englische
     entsteht beim Build aus der deutschen — ein Fehler nur dort waere einer
     der Uebersetzungsstufe, nicht der Quelle, und faellt hier getrennt auf.
     --------------------------------------------------------------------- */

  /* Die erwartete Zahl steht als Konstante, nicht als "was gerade da ist".
     Wer eine siebte Frage aufnimmt, aendert sie hier bewusst mit — und
     bemerkt dabei, dass sichtbarer Text und Schema zusammen wachsen. */
  const FAQ_ANZAHL = 6;
  const LEISTUNGEN_ANZAHL = 4;
  /* Die vier Leistungsfelder in der Reihenfolge des Abschnitts. Nur fuer die
     deutsche Fassung — die englische traegt uebersetzte Titel und wird auf
     Struktur geprueft, nicht auf Wortlaut. */
  const LEISTUNGEN_DE = [
    'Webdesign & Redesign',
    'SEO, GEO & AI Visibility',
    'Conversion & digitale Funktionen',
    'Care & Weiterentwicklung',
  ];
  /* Wohin jede Karte fuehrt, in derselben Reihenfolge. Feld 02 hat bewusst
     keine eigene Seite: seine Vertiefung steht im Wissensbereich, und eine
     zweite Seite daneben waere dieselbe Erklaerung unter einer zweiten
     Adresse. Das Ziel steht hier mit, damit ein spaeterer Griff nach einer
     eigenen SEO-Seite an dieser Tabelle auffaellt statt still zu passieren. */
  const LEISTUNGEN_ZIEL_DE = [
    '/webdesign-redesign/',
    '/wissen/seo-geo-ai-visibility/',
    '/digitale-funktionen/',
    '/care/',
  ];

  /* Sichtbaren Text vergleichbar machen: Auszeichnung raus, Entitaeten
     aufloesen, Leerraum auf ein Leerzeichen. Sonst scheitert der Vergleich
     mit dem JSON-LD schon an einem Zeilenumbruch im Markup. */
  const ENTITAETEN = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', shy: '' };
  const klartext = (s) => s
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (t, n) => (n.toLowerCase() in ENTITAETEN ? ENTITAETEN[n.toLowerCase()] : t))
    .replace(/\s+/g, ' ')
    .trim();

  /* Doppelte Eintraege benennen, statt nur zu zaehlen — die Meldung soll
     sagen, welcher Satz zweimal dasteht. */
  const doppelte = (liste) => {
    const zaehler = new Map();
    for (const x of liste) zaehler.set(x, (zaehler.get(x) || 0) + 1);
    return [...zaehler].filter(([, n]) => n > 1).map(([x]) => x);
  };
  const kurz = (s, n = 70) => (s.length > n ? s.slice(0, n) + '…' : s);

  for (const start of ['index.html', 'en/index.html']) {
    const startPfad = join(ZIEL, start);
    if (!(await existiert(startPfad))) continue;   // fehlende Seite meldet die Schleife oben
    const startHtml = await readFile(startPfad, 'utf8');

    /* ----- H-1 Jede Frage steht genau einmal im Dokument ----- */
    const fqRoh = [...startHtml.matchAll(/<article[^>]*\bclass="[^"]*\bfq__b\b[^"]*"[^>]*>([\s\S]*?)<\/article>/g)]
      .map((m) => m[1]);
    const sichtbar = fqRoh.map((rumpf) => {
      const frage = /<h3[^>]*\bclass="[^"]*\bfq__q\b[^"]*"[^>]*>([\s\S]*?)<\/h3>/.exec(rumpf);
      const antwort = /<p[^>]*\bclass="[^"]*\bfq__a\b[^"]*"[^>]*>([\s\S]*?)<\/p>/.exec(rumpf);
      return { frage: frage ? klartext(frage[1]) : null, antwort: antwort ? klartext(antwort[1]) : null };
    });

    if (fqRoh.length !== FAQ_ANZAHL)
      F(start + ': ' + fqRoh.length + ' sichtbare Fragen statt ' + FAQ_ANZAHL
        + ' — jede Frage gehoert genau einmal ins Dokument, auch fuer Animation oder Layout');
    for (const [n, f] of sichtbar.entries()) {
      if (!f.frage) F(start + ': sichtbare Frage ' + (n + 1) + ' ohne .fq__q');
      if (!f.antwort) F(start + ': sichtbare Frage ' + (n + 1) + ' ohne .fq__a');
    }
    for (const d of doppelte(sichtbar.map((f) => f.frage).filter(Boolean)))
      F(start + ': sichtbare Frage steht mehrfach im Dokument — "' + kurz(d) + '"');
    for (const d of doppelte(sichtbar.map((f) => f.antwort).filter(Boolean)))
      F(start + ': sichtbare Antwort steht mehrfach im Dokument — "' + kurz(d) + '"');

    /* ----- H-2 Das Schema nennt genauso viele Fragen ----- */
    let schema = null;
    for (const m of startHtml.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
      let daten;
      try { daten = JSON.parse(m[1]); } catch { continue; }  // ungueltiges JSON-LD meldet die Schleife oben
      const suche = (o) => {
        if (Array.isArray(o)) return o.forEach(suche);
        if (!o || typeof o !== 'object') return;
        if (o['@type'] === 'FAQPage' && Array.isArray(o.mainEntity)) schema = o.mainEntity;
        Object.values(o).forEach(suche);
      };
      suche(daten);
    }

    if (!schema) {
      F(start + ': kein FAQPage-Block mit mainEntity im JSON-LD');
      continue;                                    // ohne Schema ist H-3 nicht pruefbar
    }
    if (schema.length !== FAQ_ANZAHL)
      F(start + ': FAQPage nennt ' + schema.length + ' Fragen statt ' + FAQ_ANZAHL);

    /* ----- H-3 Schema und sichtbarer Text sind dasselbe, in derselben
       Reihenfolge. Eine Frage im Schema, die auf der Seite nicht steht, ist
       gegenueber einer Suchmaschine eine Aussage ueber Inhalt, den es nicht
       gibt — deshalb ist schon eine Abweichung ein Fehler. ----- */
    const anzahl = Math.max(sichtbar.length, schema.length);
    for (let n = 0; n < anzahl; n++) {
      const dom = sichtbar[n];
      const eintrag = schema[n];
      if (!dom) {
        F(start + ': FAQPage-Frage ' + (n + 1) + ' ohne sichtbare Entsprechung — "'
          + kurz(String(eintrag && eintrag.name)) + '"');
        continue;
      }
      if (!eintrag) {
        F(start + ': sichtbare Frage ' + (n + 1) + ' fehlt im FAQPage-Schema — "'
          + kurz(String(dom.frage)) + '"');
        continue;
      }
      const sFrage = typeof eintrag.name === 'string' ? klartext(eintrag.name) : null;
      const sAntwort = eintrag.acceptedAnswer && typeof eintrag.acceptedAnswer.text === 'string'
        ? klartext(eintrag.acceptedAnswer.text) : null;
      if (sFrage === null) F(start + ': FAQPage-Frage ' + (n + 1) + ' ohne name');
      else if (sFrage !== dom.frage)
        F(start + ': FAQ ' + (n + 1) + ' — Frage weicht ab.\n      sichtbar: "'
          + kurz(String(dom.frage)) + '"\n      Schema:   "' + kurz(sFrage) + '"');
      if (sAntwort === null) F(start + ': FAQPage-Frage ' + (n + 1) + ' ohne acceptedAnswer.text');
      else if (sAntwort !== dom.antwort)
        F(start + ': FAQ ' + (n + 1) + ' — Antwort weicht ab.\n      sichtbar: "'
          + kurz(String(dom.antwort)) + '"\n      Schema:   "' + kurz(sAntwort) + '"');
    }

    /* ----- H-4 Die Leistungskarten tragen ihren Text einmal ----- */
    /* Die Karte ist ein <a> und kein <article> mehr: sie fuehrt seit den
       Leistungsseiten auf ihr Ziel, und der Pfeil oben rechts sagt damit die
       Wahrheit. Das oeffnende Tag wird mitgefangen, weil H-4 jetzt auch das
       Ziel prueft — eine Karte ohne href waere eine Sackgasse mit Pfeil. */
    const kartenTreffer = [...startHtml.matchAll(/<a\b([^>]*\bclass="[^"]*\bcrc\b[^"]*"[^>]*)>([\s\S]*?)<\/a>/g)];
    const karten = kartenTreffer.map((m) => m[2]);
    if (karten.length !== LEISTUNGEN_ANZAHL)
      F(start + ': ' + karten.length + ' Leistungskarten statt ' + LEISTUNGEN_ANZAHL);

    const titel = [];
    for (const [n, karte] of karten.entries()) {
      const h3 = [...karte.matchAll(/<h3[^>]*>([\s\S]*?)<\/h3>/g)].map((m) => klartext(m[1]));
      if (h3.length !== 1)
        F(start + ': Leistungskarte ' + (n + 1) + ' hat ' + h3.length
          + ' Ueberschriften statt einer — Ruhe- und Offenzustand teilen sich eine');
      titel.push(...h3);
      /* Anreisser und Zusammenfassung je genau einmal. Eine zweite Kopie
         waere wieder ein Zustand, der sich seinen Text nachbaut. */
      for (const [klasse, name] of [['crc__kick', 'Anreisser'], ['crc__sum', 'Zusammenfassung']]) {
        const treffer = [...karte.matchAll(new RegExp('<p[^>]*\\bclass="[^"]*\\b' + klasse + '\\b[^"]*"[^>]*>([\\s\\S]*?)</p>', 'g'))];
        if (treffer.length > 1)
          F(start + ': Leistungskarte ' + (n + 1) + ' traegt ' + treffer.length + ' mal den ' + name);
      }
      const punkte = [...karte.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)].map((m) => klartext(m[1]));
      for (const d of doppelte(punkte))
        F(start + ': Leistungskarte ' + (n + 1) + ' nennt "' + kurz(d) + '" mehrfach');
    }
    for (const d of doppelte(titel))
      F(start + ': Leistungstitel steht mehrfach — "' + kurz(d) + '"');
    if (start === 'index.html' && titel.length === LEISTUNGEN_DE.length) {
      for (const [n, erwartet] of LEISTUNGEN_DE.entries()) {
        if (titel[n] !== erwartet)
          F(start + ': Leistungskarte ' + (n + 1) + ' heisst "' + kurz(titel[n]) + '" statt "' + erwartet + '"');
      }
    }

    /* Jede Karte muss irgendwohin fuehren — in beiden Fassungen. Der Pfeil
       oben rechts verspricht einen Weg; eine Karte ohne Ziel bricht dieses
       Versprechen, und zwar lautlos. In der deutschen Fassung steht ausserdem
       fest, wohin: Feld 02 auf den vorhandenen Wissensbeitrag, die drei
       anderen auf ihre Leistungsseite. Die englische Fassung traegt an diesen
       Stellen die uebersetzten Adressen und wird nur auf Vorhandensein
       geprueft — den Pfadtausch selbst nimmt W-3 auseinander. */
    for (const [n, m] of kartenTreffer.entries()) {
      const ziel = /\bhref="([^"]*)"/.exec(m[1]);
      if (!ziel || !ziel[1]) {
        F(start + ': Leistungskarte ' + (n + 1) + ' hat kein Ziel');
        continue;
      }
      /* Der sichtbare Weiterverweis. Der Pfeil oben rechts allein war zu
         leise — man sah der Karte nicht an, dass sie irgendwohin fuehrt.
         Er muss ausserhalb von .crc__mehr stehen: was darin liegt, ist auf
         dem Desktop zugeklappt und im Ruhezustand unsichtbar. */
      const ohneMehr = m[2].replace(/<div[^>]*\bclass="[^"]*\bcrc__mehr\b[^"]*"[\s\S]*?<\/div><\/div>/, '');
      if (!/\bclass="[^"]*\bcrc__cta\b/.test(ohneMehr))
        F(start + ': Leistungskarte ' + (n + 1) + ' zeigt im Ruhezustand keinen Weiterverweis (.crc__cta)');
      if (start === 'index.html' && n < LEISTUNGEN_ZIEL_DE.length && ziel[1] !== LEISTUNGEN_ZIEL_DE[n])
        F(start + ': Leistungskarte ' + (n + 1) + ' fuehrt auf "' + kurz(ziel[1])
          + '" statt "' + LEISTUNGEN_ZIEL_DE[n] + '"');
    }
  }

  /* --- verwaiste Schriften --- */
  for (const f of fontsVorhanden) {
    if (!fontsBenutzt.has(f)) hinweise.push(`Schrift liegt in dist/, wird aber nie referenziert: ${f}`);
  }

  console.log('─'.repeat(70));
  console.log(`  Schriften: ${fontsVorhanden.size} vorhanden, ${fontsBenutzt.size} referenziert`);
  ende();
}

function ende() {
  console.log('─'.repeat(70));
  for (const h of hinweise) console.log(`  \x1b[33m·\x1b[0m ${h}`);
  if (fehler.length) {
    for (const f of fehler) console.log(`  \x1b[31m✘\x1b[0m ${f}`);
    console.log(`\n\x1b[31mAbnahme fehlgeschlagen: ${fehler.length} Fehler\x1b[0m\n`);
    process.exit(1);
  }
  console.log('\n\x1b[32mAbnahme bestanden — keine Fehler\x1b[0m\n');
}

verify();
