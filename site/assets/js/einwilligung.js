/* =========================================================================
   Pixelkiez — Einwilligung (Cookie-Hinweis) fuer die ganze Website
   Beim ersten Aufruf jeder Seite erscheint der Hinweis. Zwei Dienste
   brauchen eine Einwilligung und laden erst danach — vorher geht keine
   Anfrage an Google:
     · Google Analytics 4 (Statistik), auf allen Seiten mit Skript
     · Googles Button "bevorzugte Quelle" (externe Medien), im Wissensbereich
   Bis zur Zustimmung bleibt der Platz des Buttons leer, nach einer Ablehnung
   verschwindet er (Vorab-Skript EINWILLIGUNG_VORLAUF in build.mjs).
   Zwei Ansichten im selben Dialog: der Hinweis mit drei Knoepfen und die
   Einstellungen mit einzelnen Kategorien. "Cookie-Einstellungen" in der
   Fussleiste oeffnet direkt die Einstellungen.
   Die Entscheidung liegt im localStorage — technisch notwendig nach
   § 25 Abs. 2 Nr. 2 TDDDG. Alle Knoepfe gleich gross und gleich gestaltet
   (OLG Koeln, 6 U 80/23), keine vorausgewaehlten Haken (BGH, I ZR 7/16).
   Sichtbarer Text in einfachen Anfuehrungszeichen, damit
   scripts/i18n-js.mjs ihn uebersetzt; alles andere in doppelten (siehe
   sstr-motion.js). Gestaltet in bds.css.
   ========================================================================= */
(function () {
  "use strict";
  var SCHLUESSEL = "pxk-einwilligung";
  // Hochzaehlen, sobald ein Dienst dazukommt: dann wird jeder neu gefragt.
  // 2 = Google Analytics kam zum Google-Button dazu.
  var VERSION = 2;
  var BUTTON_QUELLE = "https://news.google.com/swg/js/v1/publisher.js";
  var ANALYTICS_ID = "G-5HL70NM7MM";
  var wurzel = document.documentElement;
  var datenschutz = wurzel.lang === "en" ? "/en/privacy.html" : "/datenschutz.html";
  var platz = document.querySelector("[google-add-preferred-source-btn]");
  var ALLE = { google: true, analyse: true };
  var KEINE = { google: false, analyse: false };

  var lesen = function () {
    try {
      var w = JSON.parse(window.localStorage.getItem(SCHLUESSEL));
      if (w && w.v === VERSION && typeof w.google === "boolean" && typeof w.analyse === "boolean")
        return { google: w.google, analyse: w.analyse };
    } catch (e) { /* ein kaputter Eintrag gilt als keine Entscheidung */ }
    return null;
  };
  var speichern = function (wahl) {
    try {
      window.localStorage.setItem(SCHLUESSEL, JSON.stringify({
        v: VERSION, google: wahl.google, analyse: wahl.analyse, zeit: new Date().toISOString(),
      }));
    } catch (e) { /* ohne Speicher gilt die Wahl nur fuer diesen Aufruf */ }
  };

  var skript = function (quelle) {
    var s = document.createElement("script");
    s.async = true;
    s.src = quelle;
    document.head.appendChild(s);
  };
  var buttonGeladen = false, analyseGeladen = false;
  var ladeButton = function () {
    if (buttonGeladen || !platz) return;
    buttonGeladen = true;
    skript(BUTTON_QUELLE);
  };
  var ladeAnalyse = function () {
    if (analyseGeladen) return;
    analyseGeladen = true;
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { window.dataLayer.push(arguments); };
    // Eingewilligt ist nur in die Reichweitenmessung: Werbe-Speicher und
    // Google-Signale bleiben ausgeschaltet.
    window.gtag("consent", "default", {
      ad_storage: "denied", ad_user_data: "denied", ad_personalization: "denied", analytics_storage: "granted",
    });
    window.gtag("js", new Date());
    window.gtag("config", ANALYTICS_ID, { allow_google_signals: false, allow_ad_personalization_signals: false });
    skript("https://www.googletagmanager.com/gtag/js?id=" + ANALYTICS_ID);
  };
  // Beim Widerruf die Analytics-Cookies (_ga, _ga_<ID>) entfernen. Google
  // setzt sie auf die oberste Domain, deshalb jede Stufe des Hostnamens.
  var analyseCookiesLoeschen = function () {
    var teile = window.location.hostname.split(".");
    document.cookie.split(";").forEach(function (c) {
      var name = c.split("=")[0].trim();
      if (name.indexOf("_ga") !== 0) return;
      document.cookie = name + "=; Max-Age=0; path=/";
      for (var i = 0; i < teile.length; i++) {
        document.cookie = name + "=; Max-Age=0; path=/; domain=." + teile.slice(i).join(".");
      }
    });
  };
  var anwenden = function (wahl) {
    wurzel.setAttribute("data-einwilligung", wahl.google ? "ja" : "nein");
    if (wahl.google) ladeButton();
    if (wahl.analyse) ladeAnalyse();
  };

  var element = function (tag, klasse, inhalt) {
    var e = document.createElement(tag);
    if (klasse) e.className = klasse;
    if (inhalt) e.textContent = inhalt;
    return e;
  };

  var hinweis = null, zurueck = null, titel = null, start = null, auswahl = null;
  var analyseHaken = null, googleHaken = null;
  var aufraeumen = function () {
    if (!hinweis) return;
    hinweis.parentNode.removeChild(hinweis);
    hinweis = null;
    if (zurueck && document.contains(zurueck)) zurueck.focus();
    zurueck = null;
  };
  var schliessen = function () {
    if (!hinweis) return;
    if (hinweis.open && typeof hinweis.close === "function") hinweis.close();
    aufraeumen();
  };
  var entscheiden = function (wahl) {
    speichern(wahl);
    schliessen();
    if (!wahl.analyse) {
      // Googles offizieller Abschalter: ab sofort sendet gtag nichts mehr und
      // schreibt beim Verlassen der Seite auch kein Cookie neu.
      window["ga-disable-" + ANALYTICS_ID] = true;
      analyseCookiesLoeschen();
    }
    // Geladener Code laesst sich nicht entladen; ein Widerruf greift erst
    // vollstaendig nach dem Neuladen.
    if ((!wahl.google && buttonGeladen) || (!wahl.analyse && analyseGeladen)) {
      window.location.reload();
      return;
    }
    anwenden(wahl);
  };
  // `wahl` ist ALLE/KEINE oder eine Funktion, die die Haken erst beim Klick liest.
  var knopf = function (beschriftung, wahl) {
    var b = element("button", "einwilligung__knopf", beschriftung);
    b.type = "button";
    b.addEventListener("click", function () { entscheiden(typeof wahl === "function" ? wahl() : wahl); });
    return b;
  };
  // Datenschutz und Impressum bleiben erreichbar, auch solange der Dialog
  // die Seite dahinter sperrt.
  var rechtliches = function () {
    var p = element("p", "einwilligung__links");
    var d = element("a", "", 'Details in der Datenschutzerklärung');
    d.href = datenschutz + "#cookies";
    var i = element("a", "", 'Impressum');
    i.href = wurzel.lang === "en" ? "/en/imprint.html" : "/impressum.html";
    p.appendChild(d);
    p.appendChild(i);
    return p;
  };
  var kategorie = function (name, beschreibung, gesperrt) {
    var feld = element("label", "einwilligung__kategorie");
    var haken = document.createElement("input");
    haken.type = "checkbox";
    haken.checked = gesperrt;
    haken.disabled = gesperrt;
    var text = element("span", "einwilligung__kategorie-text");
    text.appendChild(element("strong", "", name));
    text.appendChild(element("span", "", beschreibung));
    feld.appendChild(haken);
    feld.appendChild(text);
    return { feld: feld, haken: haken };
  };

  var ansicht = function (einstellungen) {
    start.hidden = einstellungen;
    auswahl.hidden = !einstellungen;
    titel.textContent = einstellungen ? 'Cookie-Einstellungen' : 'Cookies und externe Dienste';
    if (einstellungen) {
      // Zeigt immer die gespeicherte Wahl; ohne Entscheidung bleiben sie leer.
      var wahl = lesen() || KEINE;
      analyseHaken.checked = wahl.analyse;
      googleHaken.checked = wahl.google;
      analyseHaken.focus();
    } else {
      hinweis.focus();
    }
  };

  /* Ein modaler <dialog> mitten auf der Seite: er liegt ueber allem, sperrt
     die Seite dahinter und haelt den Tastaturfokus bei sich. Escape schliesst
     ihn ohne Entscheidung — dann wird nichts von Google geladen, und beim
     naechsten Aufruf fragt er erneut. */
  var zeigen = function (einstellungen) {
    if (!hinweis) {
      zurueck = document.activeElement;
      hinweis = element("dialog", "einwilligung");
      hinweis.tabIndex = -1;
      hinweis.setAttribute("aria-labelledby", "einwilligung-titel");
      hinweis.addEventListener("close", aufraeumen);
      titel = element("p", "einwilligung__titel");
      titel.id = "einwilligung-titel";

      start = element("div", "einwilligung__ansicht");
      start.appendChild(element("p", "einwilligung__text", 'Wir speichern nur, was technisch nötig ist, etwa Ihre Auswahl in diesem Fenster. Mit „Alle akzeptieren“ erlauben Sie zusätzlich zwei Dienste von Google: Google Analytics, mit dem wir auswerten, wie unsere Website genutzt wird, und im Wissensbereich einen Button, mit dem Sie Pixelkiez als bevorzugte Quelle speichern können. Dabei erhält Google Ihre IP-Adresse und Nutzungsdaten, auch in den USA; Google Analytics setzt dafür Cookies. Ihre Entscheidung können Sie jederzeit über „Cookie-Einstellungen“ unten auf der Seite ändern.'));
      start.appendChild(rechtliches());
      var knoepfeStart = element("div", "einwilligung__knoepfe");
      knoepfeStart.appendChild(knopf('Alle akzeptieren', ALLE));
      knoepfeStart.appendChild(knopf('Nur essenzielle', KEINE));
      knoepfeStart.appendChild(knopf('Ablehnen', KEINE));
      start.appendChild(knoepfeStart);
      var mehr = element("button", "einwilligung__mehr", 'Einstellungen anpassen');
      mehr.type = "button";
      mehr.addEventListener("click", function () { ansicht(true); });
      start.appendChild(mehr);

      auswahl = element("div", "einwilligung__ansicht");
      auswahl.appendChild(kategorie('Essenziell', 'Immer aktiv. Speichert nur Ihre Auswahl in diesem Fenster, im lokalen Speicher Ihres Browsers.', true).feld);
      var analyse = kategorie('Statistik: Google Analytics', 'Zeigt uns, welche Seiten wie genutzt werden. Google Analytics setzt dafür Cookies (_ga, bis zu 2 Jahre) und überträgt Ihre IP-Adresse und Nutzungsdaten an Google, auch in die USA.', false);
      analyseHaken = analyse.haken;
      auswahl.appendChild(analyse.feld);
      var google = kategorie('Externe Medien: Google-Button', 'Zeigt im Wissensbereich den Button „Bevorzugte Quelle“ von Google. Dabei erhält Google Ihre IP-Adresse und technische Browserdaten, auch in den USA; sind Sie bei Google angemeldet, kann Google den Aufruf Ihrem Konto zuordnen.', false);
      googleHaken = google.haken;
      auswahl.appendChild(google.feld);
      auswahl.appendChild(rechtliches());
      var knoepfeAuswahl = element("div", "einwilligung__knoepfe");
      knoepfeAuswahl.appendChild(knopf('Auswahl speichern', function () {
        return { google: googleHaken.checked, analyse: analyseHaken.checked };
      }));
      knoepfeAuswahl.appendChild(knopf('Alle akzeptieren', ALLE));
      knoepfeAuswahl.appendChild(knopf('Nur essenzielle', KEINE));
      auswahl.appendChild(knoepfeAuswahl);

      hinweis.appendChild(titel);
      hinweis.appendChild(start);
      hinweis.appendChild(auswahl);
      document.body.appendChild(hinweis);
      if (typeof hinweis.showModal === "function") hinweis.showModal();
      else hinweis.setAttribute("open", "");
    }
    ansicht(einstellungen === true);
  };

  /* Widerruf so leicht wie die Zustimmung (Art. 7 Abs. 3 DSGVO): ein
     dauerhafter Eintrag in der Fussleiste jeder Seite. */
  var fussleiste = document.querySelector(".footer__bar nav");
  if (fussleiste) {
    var fussLink = element("button", "footer__einwilligung", 'Cookie-Einstellungen');
    fussLink.type = "button";
    fussLink.addEventListener("click", function () { zeigen(true); });
    fussleiste.appendChild(fussLink);
  }

  var gespeichert = lesen();
  if (gespeichert) {
    // Reste einer frueheren Zustimmung entfernen, falls doch noch eins steht.
    if (!gespeichert.analyse) analyseCookiesLoeschen();
    anwenden(gespeichert);
  } else {
    zeigen(false);
  }
})();
