/* =========================================================================
   Seitenregister — die eine Stelle, die weiss, welche Seiten es gibt.

   EINSPRACHIG: Seiten, die nur deutsch ausgeliefert werden (Rechtsseiten).

   SPRACHPAARE: Seiten, deren englische Fassung der Build aus der deutschen
   Quelle erzeugt. Jeder Eintrag traegt alles, was Build und Werkzeuge dafuer
   brauchen:

     quelle   Quelldatei unter site/
     entwurf  optional: true fuer unveroeffentlichte Seiten — der Build
              erzeugt sie, laesst sie aber aus der Sitemap heraus
     zielDe   Zielpfad der deutschen Fassung unter dist/
     zielEn   Zielpfad der englischen Fassung unter dist/
     pfadDe   oeffentlicher Pfad der deutschen Fassung (canonical, hreflang)
     pfadEn   oeffentlicher Pfad der englischen Fassung
     ldTausch Adress-Austausche im JSON-LD der englischen Fassung, als Paare
              [deutscher Pfad, englischer Pfad]. Der Build ersetzt jeweils die
              exakte, in Anfuehrungszeichen stehende Adresse "DOMAIN + Pfad".
              Seitenbezogene Kennungen (#seite, #webpage, ...) muessen
              wechseln — die englische und die deutsche Fassung sind zwei
              Dokumente. Entitaetsbezogene Kennungen (#organisation, #logo,
              #gruender) bleiben absichtlich gleich: es ist dieselbe Sache,
              und genau diese Gleichheit verknuepft die Fassungen.

   scripts/build.mjs und scripts/i18n-extract.mjs lesen dieses Register;
   scripts/verify.mjs prueft das Ergebnis mit einer eigenen, bewusst
   unabhaengigen Tabelle — Abnahme und Erzeugung sollen sich nicht
   gegenseitig bestaetigen koennen.
   ========================================================================= */

export const EINSPRACHIG = ['impressum.html', 'datenschutz.html'];

export const SPRACHPAARE = [
  {
    quelle: 'index.html',
    zielDe: 'index.html',
    zielEn: 'en/index.html',
    pfadDe: '/',
    pfadEn: '/en/',
    ldTausch: [
      ['/', '/en/'],
      ['/#seite', '/en/#seite'],
      ['/#pfad', '/en/#pfad'],
      ['/#faq', '/en/#faq'],
      ['/#website', '/en/#website'],
    ],
  },
  {
    quelle: 'website-analyse.html',
    zielDe: 'website-analyse/index.html',
    zielEn: 'en/website-analyse/index.html',
    pfadDe: '/website-analyse/',
    pfadEn: '/en/website-analyse/',
    ldTausch: [
      ['/website-analyse/', '/en/website-analyse/'],
      ['/website-analyse/#webpage', '/en/website-analyse/#webpage'],
      // isPartOf zeigt auf den WebSite-Knoten der jeweiligen Sprachfassung
      ['/#website', '/en/#website'],
    ],
  },
  /* --- Wissensbereich (PXK-28/PXK-29): veroeffentlicht.
     Bis zu diesem Release trugen die Eintraege entwurf:true — kein
     Sitemap-Eintrag, noindex in der Quelle, kein llms.txt-Eintrag, keine
     Verlinkung von veroeffentlichten Seiten. Das Flag ist weg, weil der
     Inhalt fertig ist: die Seiten stehen jetzt in der Sitemap, tragen
     index,follow und sind von Startseite und Footer aus erreichbar.

     ldTausch ist damit nicht mehr leer. Jede Wissensseite traegt seit der
     Freigabe strukturierte Daten, und deren seitenbezogene Kennungen
     (#webpage, #artikel, #breadcrumb, #liste) muessen zwischen den beiden
     Sprachfassungen wechseln — sonst truegen die deutsche und die englische
     Fassung dieselbe @id. #organisation, #logo und #website bleiben gleich:
     dieselbe Sache, und genau diese Gleichheit verknuepft die Fassungen.

     Der Deep Dive zur Auslieferung steht hier als eigenes Sprachpaar, ist
     aber kein sechster gleichrangiger Pfeiler — die Hierarchie traegt der
     Hub, nicht die Routenliste. */
  {
    quelle: 'wissen/index.html',
    zielDe: 'wissen/index.html',
    zielEn: 'en/knowledge/index.html',
    pfadDe: '/wissen/',
    pfadEn: '/en/knowledge/',
    ldTausch: [
      ['/wissen/', '/en/knowledge/'],
      ['/wissen/#webpage', '/en/knowledge/#webpage'],
      ['/wissen/#breadcrumb', '/en/knowledge/#breadcrumb'],
      ['/wissen/#liste', '/en/knowledge/#liste'],
    ],
  },
  {
    quelle: 'wissen/seo-geo-ai-visibility.html',
    zielDe: 'wissen/seo-geo-ai-visibility/index.html',
    zielEn: 'en/knowledge/seo-geo-ai-visibility/index.html',
    pfadDe: '/wissen/seo-geo-ai-visibility/',
    pfadEn: '/en/knowledge/seo-geo-ai-visibility/',
    ldTausch: [
      ['/wissen/seo-geo-ai-visibility/', '/en/knowledge/seo-geo-ai-visibility/'],
      ['/wissen/seo-geo-ai-visibility/#webpage', '/en/knowledge/seo-geo-ai-visibility/#webpage'],
      ['/wissen/seo-geo-ai-visibility/#artikel', '/en/knowledge/seo-geo-ai-visibility/#artikel'],
      ['/wissen/seo-geo-ai-visibility/#breadcrumb', '/en/knowledge/seo-geo-ai-visibility/#breadcrumb'],
    ],
  },
  {
    quelle: 'wissen/wie-ki-websites-liest.html',
    zielDe: 'wissen/wie-ki-websites-liest/index.html',
    zielEn: 'en/knowledge/how-ai-reads-websites/index.html',
    pfadDe: '/wissen/wie-ki-websites-liest/',
    pfadEn: '/en/knowledge/how-ai-reads-websites/',
    ldTausch: [
      ['/wissen/wie-ki-websites-liest/', '/en/knowledge/how-ai-reads-websites/'],
      ['/wissen/wie-ki-websites-liest/#webpage', '/en/knowledge/how-ai-reads-websites/#webpage'],
      ['/wissen/wie-ki-websites-liest/#artikel', '/en/knowledge/how-ai-reads-websites/#artikel'],
      ['/wissen/wie-ki-websites-liest/#breadcrumb', '/en/knowledge/how-ai-reads-websites/#breadcrumb'],
    ],
  },
  {
    quelle: 'wissen/answerability.html',
    zielDe: 'wissen/answerability/index.html',
    zielEn: 'en/knowledge/answerability/index.html',
    pfadDe: '/wissen/answerability/',
    pfadEn: '/en/knowledge/answerability/',
    ldTausch: [
      ['/wissen/answerability/', '/en/knowledge/answerability/'],
      ['/wissen/answerability/#webpage', '/en/knowledge/answerability/#webpage'],
      ['/wissen/answerability/#artikel', '/en/knowledge/answerability/#artikel'],
      ['/wissen/answerability/#breadcrumb', '/en/knowledge/answerability/#breadcrumb'],
    ],
  },
  {
    quelle: 'wissen/entity-trust.html',
    zielDe: 'wissen/entity-trust/index.html',
    zielEn: 'en/knowledge/entity-trust/index.html',
    pfadDe: '/wissen/entity-trust/',
    pfadEn: '/en/knowledge/entity-trust/',
    ldTausch: [
      ['/wissen/entity-trust/', '/en/knowledge/entity-trust/'],
      ['/wissen/entity-trust/#webpage', '/en/knowledge/entity-trust/#webpage'],
      ['/wissen/entity-trust/#artikel', '/en/knowledge/entity-trust/#artikel'],
      ['/wissen/entity-trust/#breadcrumb', '/en/knowledge/entity-trust/#breadcrumb'],
    ],
  },
  {
    quelle: 'wissen/agent-readiness.html',
    zielDe: 'wissen/agent-readiness/index.html',
    zielEn: 'en/knowledge/agent-readiness/index.html',
    pfadDe: '/wissen/agent-readiness/',
    pfadEn: '/en/knowledge/agent-readiness/',
    ldTausch: [
      ['/wissen/agent-readiness/', '/en/knowledge/agent-readiness/'],
      ['/wissen/agent-readiness/#webpage', '/en/knowledge/agent-readiness/#webpage'],
      ['/wissen/agent-readiness/#artikel', '/en/knowledge/agent-readiness/#artikel'],
      ['/wissen/agent-readiness/#breadcrumb', '/en/knowledge/agent-readiness/#breadcrumb'],
    ],
  },
  {
    quelle: 'wissen/wie-websites-ausgeliefert-werden.html',
    zielDe: 'wissen/wie-websites-ausgeliefert-werden/index.html',
    zielEn: 'en/knowledge/how-websites-are-delivered/index.html',
    pfadDe: '/wissen/wie-websites-ausgeliefert-werden/',
    pfadEn: '/en/knowledge/how-websites-are-delivered/',
    ldTausch: [
      ['/wissen/wie-websites-ausgeliefert-werden/', '/en/knowledge/how-websites-are-delivered/'],
      ['/wissen/wie-websites-ausgeliefert-werden/#webpage', '/en/knowledge/how-websites-are-delivered/#webpage'],
      ['/wissen/wie-websites-ausgeliefert-werden/#artikel', '/en/knowledge/how-websites-are-delivered/#artikel'],
      ['/wissen/wie-websites-ausgeliefert-werden/#breadcrumb', '/en/knowledge/how-websites-are-delivered/#breadcrumb'],
    ],
  },
];
