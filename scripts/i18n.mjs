/* =========================================================================
   Sprachfassungen — gemeinsames Werkzeug fuer Auslesen und Anwenden.

   Die deutsche Seite ist die Quelle. Die englische entsteht beim Build durch
   Ersetzen; es gibt keine zweite HTML-Datei, die man vergessen koennte
   nachzupflegen.

   Damit das nicht still auseinanderlaeuft, arbeiten Auslesen und Anwenden
   ueber denselben Zerleger. Der Build bricht ab, wenn
     · ein deutscher Satz in der Seite steht, den die Tabelle nicht kennt,
     · oder die Tabelle einen Satz enthaelt, den es in der Seite nicht mehr gibt.
   Beides bedeutet: jemand hat den deutschen Text geaendert und die
   Uebersetzung nicht. Genau das soll auffallen.
   ========================================================================= */

/* Attribute, deren Inhalt sichtbar oder vorlesbar ist. */
export const ATTRIBUTE = ['alt', 'title', 'aria-label', 'placeholder', 'content',
  /* Vorbelegung des Anliegen-Feldes — landet sichtbar im Formular */
  'data-anliegen',
  /* Name des angefragten Pakets. Das Skript schreibt ihn in den Kopf des
     Kontaktfensters; ohne diesen Eintrag stuende dort "Individuell", waehrend
     die Karte daneben "Bespoke" heisst. */
  'data-paket',
  /* Beschriftung der Karussellpunkte. Das Skript setzt sie als aria-label
     auf die erzeugten Knoepfe; sie wird also vorgelesen und gehoert damit
     zur Sprachfassung, auch wenn sie im Markup als Datenattribut steht. */
  'data-beschriftung'];

/* Nicht uebersetzen: Eigennamen, Zahlen, technische Werte. Der Vergleich
   laeuft nach trim() und Kleinschreibung. */
const UNVERAENDERT = new Set([
  'berlin digital systems', 'bds', 'berlin', 'deutschland', 'seo', 'geo',
  'ab 995,–', 'doctolib', 'google', 'booking.com', 'zmvz', 'mfa', 'hwg',
  '01', '02', '03', '04', '05', '06', '07', '08', '09', '·', '—', '–',
  // Der Sprachumschalter ist schon englisch und wird beim Bauen der
  // englischen Fassung ohnehin als Ganzes ausgetauscht.
  'en', 'de', 'switch to english', 'auf deutsch wechseln',
]);

const istUebersetzbar = (s) => {
  const t = s.trim();
  if (!t) return false;
  if (UNVERAENDERT.has(t.toLowerCase())) return false;
  /* Geldbetraege sind uebersetzbar, obwohl kein Buchstabe darin steht.
     Ihre Schreibweise haengt an der Sprache: deutsch "1.290 €" mit Punkt als
     Tausendertrennung und dem Zeichen hinten, englisch "€1,290" mit Komma und
     dem Zeichen vorn. Ohne diese Zeile blieb "995 €" in der englischen
     Preisliste stehen, waehrend "ab 2.490 €" daneben zu "from €2,490" wurde —
     zwei Schreibweisen in einer Zeile, weil die eine Zahl ein Wort trug und
     die andere nicht. Steht vor der Buchstabenpruefung, sonst greift sie nie. */
  if (/[€$£]/.test(t) && /[0-9]/.test(t)) return true;
  // Reine Zahlen, Satzzeichen, Symbole
  if (!/[a-zA-ZäöüÄÖÜß]/.test(t)) return false;
  // Einzelne Buchstaben
  if (t.length < 2) return false;
  return true;
};

/* -------------------------------------------------------------------------
   Zerleger: teilt das Dokument in Stuecke. Nur Stuecke der Art "text" und
   "attr" sind uebersetzbar; Tags, Skripte und Stile bleiben unangetastet.
   Bewusst kein DOM: das Dokument soll Zeichen fuer Zeichen so wieder
   zusammengesetzt werden, wie es hereinkam.
   ------------------------------------------------------------------------- */
export function zerlege(html) {
  const stuecke = [];
  let i = 0;

  while (i < html.length) {
    const auf = html.indexOf('<', i);
    if (auf === -1) { stuecke.push({ art: 'text', wert: html.slice(i) }); break; }
    if (auf > i) stuecke.push({ art: 'text', wert: html.slice(i, auf) });

    // Bereiche, deren Inhalt kein Text ist
    const roh = /^<(script|style)\b/i.exec(html.slice(auf));
    if (roh) {
      const endeTag = `</${roh[1]}>`;
      const ende = html.toLowerCase().indexOf(endeTag, auf);
      const bis = ende === -1 ? html.length : ende + endeTag.length;
      stuecke.push({ art: 'roh', wert: html.slice(auf, bis) });
      i = bis; continue;
    }
    if (html.startsWith('<!--', auf)) {
      const ende = html.indexOf('-->', auf);
      const bis = ende === -1 ? html.length : ende + 3;
      stuecke.push({ art: 'roh', wert: html.slice(auf, bis) });
      i = bis; continue;
    }

    // Gewoehnliches Tag — Attribute einzeln herausloesen
    const zu = html.indexOf('>', auf);
    const bis = zu === -1 ? html.length : zu + 1;
    zerlegeTag(html.slice(auf, bis), stuecke);
    i = bis;
  }
  return stuecke;
}

function zerlegeTag(tag, stuecke) {
  const muster = new RegExp(`\\s(${ATTRIBUTE.join('|')})="([^"]*)"`, 'gi');
  let zuletzt = 0, m;
  while ((m = muster.exec(tag)) !== null) {
    const wertStart = m.index + m[0].indexOf('"') + 1;
    stuecke.push({ art: 'tag', wert: tag.slice(zuletzt, wertStart) });
    stuecke.push({ art: 'attr', wert: m[2], attribut: m[1].toLowerCase() });
    zuletzt = wertStart + m[2].length;
  }
  stuecke.push({ art: 'tag', wert: tag.slice(zuletzt) });
}

export const baueZusammen = (stuecke) => stuecke.map((s) => s.wert).join('');

/* -------------------------------------------------------------------------
   Auslesen: alle uebersetzbaren Zeichenketten in Dokumentreihenfolge,
   ohne Doppelungen.
   ------------------------------------------------------------------------- */
export function lieseStrings(html) {
  const raus = [];
  const gesehen = new Set();
  for (const s of zerlege(html)) {
    if (s.art !== 'text' && s.art !== 'attr') continue;
    // Fuehrende und folgende Leerzeichen gehoeren zum Layout, nicht zum Satz
    const kern = s.wert.trim();
    if (!istUebersetzbar(kern)) continue;
    // content="" nur bei den Metaangaben, nicht bei charset o. Ae.
    if (s.art === 'attr' && s.attribut === 'content' && !/[a-zäöüß]\s+[a-zäöüß]/i.test(kern)) continue;
    if (gesehen.has(kern)) continue;
    gesehen.add(kern);
    raus.push(kern);
  }
  return raus;
}

/* -------------------------------------------------------------------------
   Anwenden. Gibt das uebersetzte Dokument zurueck sowie zwei Listen fuer die
   Pruefung: was in der Seite steht, aber nicht in der Tabelle — und was in
   der Tabelle steht, aber nicht mehr in der Seite.
   ------------------------------------------------------------------------- */
export function uebersetze(html, tabelle) {
  const fehlend = [];
  const benutzt = new Set();

  const stuecke = zerlege(html).map((s) => {
    if (s.art !== 'text' && s.art !== 'attr') return s;
    const kern = s.wert.trim();
    if (!istUebersetzbar(kern)) return s;
    if (s.art === 'attr' && s.attribut === 'content' && !/[a-zäöüß]\s+[a-zäöüß]/i.test(kern)) return s;

    // Ein leerer Wert zaehlt als fehlend. Sonst rutscht ein frisch
    // ausgelesener, noch nicht uebersetzter Eintrag durch und die englische
    // Seite bekommt an dieser Stelle eine leere Zeichenkette — bei einem
    // og:title faellt das erst auf, wenn jemand den Link teilt.
    if (!Object.prototype.hasOwnProperty.call(tabelle, kern) || !tabelle[kern]) {
      if (!fehlend.includes(kern)) fehlend.push(kern);
      return s;
    }
    benutzt.add(kern);
    // Umgebende Leerzeichen erhalten — sie tragen im HTML Bedeutung
    const vorn = s.wert.match(/^\s*/)[0];
    const hinten = s.wert.match(/\s*$/)[0];
    return { ...s, wert: vorn + tabelle[kern] + hinten };
  });

  // benutzt statt veraltet zurueckgeben: die Tabelle bedient noch einen
  // zweiten Verbraucher (JSON-LD im <script>, das dieser Zerleger bewusst
  // nicht anfasst). Was veraltet ist, kann erst entscheiden, wer beide
  // Ergebnisse kennt.
  return { html: baueZusammen(stuecke), fehlend, benutzt };
}
