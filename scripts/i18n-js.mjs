/* Liest deutsche Zeichenketten-Literale aus bds.js und wendet Uebersetzungen
   darauf an. Ersetzt wird ausschliesslich der Inhalt einfacher Anfuehrungs-
   zeichen — Code, Kommentare und Bezeichner bleiben unberuehrt. */

/* Umgekehrte Logik: alles gilt als Inhalt, ausser es ist erkennbar Code.
   Eine vergessene Uebersetzung faellt dann als deutscher Satz auf der
   englischen Seite auf. Waere es andersherum, wuerde sie stillschweigend
   durchrutschen — und genau das ist bei Zeichenketten die Regel, nicht die
   Ausnahme. */
const CODE = [
  /^[.#\[]/,                       // Selektoren
  /^[a-z]+(-[a-z]+)*$/,            // Ereignisnamen, Attributnamen, Schluesselwoerter
  /^[a-z][a-z0-9]*__[a-z0-9-]+$/,  // Klassennamen nach BEM: pc__pick, tb__line
  /\[data-/,                       // Selektorbruchstuecke
  /^\/[\w/.-]*$/,                  // Pfade
  /^https?:|^mailto:|^\?|^&\w+=/,  // Adressen und Parameter
  /^\(?(min|max)-width|prefers-|^\(\w+:/,  // Media Queries
  /^[\d\s.,%px-]+$/,               // Masse
  /^<[^>]*>$/,                     // reine Tags ohne Text
  /^<\/[a-z]+>|^<\/[a-z]+><\/[a-z]+>/,     // schliessende Tags
  /^&[a-z]+;$/,                    // Entitaeten
  /^[A-Za-z-]+\/[A-Za-z+-]+$/,     // MIME-Typen
  /^(use strict|true|false|null)$/,
  /^HTTP $/,
  /@/,                             // E-Mail-Adressen
];

/* Bezeichner, die zufaellig wie Text aussehen. Bewusst als exakte Liste und
   nicht als Muster — bei einem Muster waere nie klar, was es sonst noch
   erwischt. */
const EXAKT_CODE = new Set([
  'Escape', 'Enter', 'IntersectionObserver', 'POST', 'Content-Type',
  'textPath', 'startOffset',
  '--d', '--i', '--n', '--fq-x', '<i class="',
]);

/* Bleibt nach dem Entfernen aller Tags und Entitaeten kein Buchstabe uebrig,
   ist es reines Markup — etwa ein SVG-Fragment oder ein oeffnendes Tag. */
const nurMarkup = (s) =>
  !/[A-Za-zÄÖÜäöüß]/.test(s.replace(/<[^>]*>/g, '').replace(/&[a-z]+;/g, ''));

const istCode = (s) => EXAKT_CODE.has(s) || nurMarkup(s) || CODE.some((r) => r.test(s));
const DEUTSCH = /[A-Za-zÄÖÜäöüß]/;

/* Zerlegt die Datei in Code und Zeichenketten. Kommentare werden als Code
   behandelt, damit ein Apostroph darin keine Zeichenkette eroeffnet. */
export function zerlegeJs(src) {
  const teile = [];
  let i = 0, start = 0;
  while (i < src.length) {
    const c = src[i];
    // Zeilenkommentar
    if (c === '/' && src[i + 1] === '/') {
      const e = src.indexOf('\n', i); i = e === -1 ? src.length : e; continue;
    }
    // Blockkommentar
    if (c === '/' && src[i + 1] === '*') {
      const e = src.indexOf('*/', i); i = e === -1 ? src.length : e + 2; continue;
    }
    if (c === "'") {
      teile.push({ art: 'code', wert: src.slice(start, i) });
      let j = i + 1;
      while (j < src.length) {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === "'") break;
        j++;
      }
      teile.push({ art: 'text', wert: src.slice(i + 1, j) });
      i = j + 1; start = i; continue;
    }
    i++;
  }
  teile.push({ art: 'code', wert: src.slice(start) });
  return teile;
}

export const istDeutsch = (s) => s.length >= 3 && DEUTSCH.test(s) && !istCode(s);

export function lieseJsStrings(src) {
  const raus = [], gesehen = new Set();
  for (const t of zerlegeJs(src)) {
    if (t.art !== 'text' || !istDeutsch(t.wert) || gesehen.has(t.wert)) continue;
    gesehen.add(t.wert); raus.push(t.wert);
  }
  return raus;
}

export function uebersetzeJs(src, tabelle) {
  const fehlend = [], benutzt = new Set();
  const out = zerlegeJs(src).map((t) => {
    if (t.art === 'code') return t.wert;
    if (!istDeutsch(t.wert)) return "'" + t.wert + "'";
    // Leerer Wert zaehlt als fehlend — sonst entsteht eine leere
    // Zeichenkette im ausgelieferten Skript.
    if (!Object.prototype.hasOwnProperty.call(tabelle, t.wert) || !tabelle[t.wert]) {
      if (!fehlend.includes(t.wert)) fehlend.push(t.wert);
      return "'" + t.wert + "'";
    }
    benutzt.add(t.wert);
    return "'" + tabelle[t.wert].replace(/'/g, "\\'") + "'";
  }).join('');
  const veraltet = Object.keys(tabelle).filter((k) => !benutzt.has(k));
  return { js: out, fehlend, veraltet };
}
