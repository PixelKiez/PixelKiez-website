/* =========================================================================
   Pixelkiez — Bewegungsschicht zur Designschicht (sstr.tech)
   Laeuft nach bds.js als eigene IIFE und fasst dessen Logik nicht an.
   Keine Bibliothek: Kopfton, Vorlauf, weiches Scrollen und Ziffernlauf
   sind auf das zurueckgebaut, was die Referenz zeigt (GSAP/Lenis dort);
   dazu die Flieder-Flaeche unter "Drei Aufgaben".

   Zeichenketten stehen hier bewusst in doppelten Anfuehrungszeichen: die
   Uebersetzungspruefung (scripts/i18n-js.mjs) liest nur einfache, und in
   dieser Datei gibt es nichts zu uebersetzen — nur Klassen und Schluessel.
   ========================================================================= */
(function () {
  "use strict";

  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var wurzel = document.documentElement;
  var reduziert = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* --- 1. Kopfton ---------------------------------------------------------
     Der Kopf nimmt den Ton der Flaeche an, die gerade unter ihm liegt — wie
     data-theme-nav der Referenz. Hell oder dunkel wird aus der berechneten
     Hintergrundfarbe gelesen, nicht aus Klassennamen: die Designschicht
     dreht einzelne Abschnitte um (Fusszeile hell, Ausgangslage hell), und
     die Klassen im Markup wissen davon nichts. */
  (function kopfton() {
    var kopf = document.querySelector(".header");
    var zeile = kopf && kopf.querySelector(".header__in");
    if (!kopf || !zeile) return;
    var flaechen = $$("main > section, main > aside, .footer");
    var dunkle = [];
    var istDunkel = function (el) {
      var m = getComputedStyle(el).backgroundColor.match(/\d+(\.\d+)?/g);
      if (!m || (m.length > 3 && +m[3] === 0)) return false;
      return (0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]) < 110;
    };
    var ton = null;
    var pruefen = function () {
      var y = zeile.getBoundingClientRect().bottom + 2;   // knapp unter die Kante des Kopfes
      var neu = "hell";
      for (var i = 0; i < dunkle.length; i++) {
        var r = dunkle[i].getBoundingClientRect();
        if (r.top <= y && r.bottom > y) { neu = "dunkel"; break; }
      }
      if (neu === ton) return;
      ton = neu;
      kopf.setAttribute("data-ton", neu);
    };
    var messen = function () { dunkle = flaechen.filter(istDunkel); pruefen(); };
    var geplant = false;
    var planen = function () {
      if (geplant) return;
      geplant = true;
      window.requestAnimationFrame(function () { geplant = false; pruefen(); });
    };
    messen();
    window.addEventListener("scroll", planen, { passive: true });
    window.addEventListener("resize", messen);
    window.addEventListener("load", messen);
  })();

  /* --- 2. Vorlauf ---------------------------------------------------------
     Nur auf der Startseite und nur beim ersten Aufruf je Sitzung, wie bei
     der Referenz. Rein optisch: kein Text, kein Bild, keine Klickfalle
     (pointer-events:none). Spaetestens nach 2,4 s ist er weg, auch wenn
     Schriften haengen. Ohne Speicherzugriff (privater Modus) entfaellt er
     ganz — ein Vorlauf bei jedem Aufruf waere schlimmer als keiner. */
  (function vorlauf() {
    if (reduziert || !document.querySelector(".hero")) return;
    var schon;
    try {
      schon = window.sessionStorage.getItem("pk-vorlauf");
      window.sessionStorage.setItem("pk-vorlauf", "1");
    } catch (e) { return; }
    if (schon) return;

    // Solange der Vorlauf die Seite deckt, warten die Ueberschriften mit
    // ihrem Block-Reveal (bds.js, Abschnitt 5) — sonst spielte die erste
    // ("Drei Aufgaben") ungesehen darunter ab, sobald man gleich scrollt.
    wurzel.setAttribute("data-vorlauf", "an");
    var freigeben = function () {
      if (!wurzel.hasAttribute("data-vorlauf")) return;
      wurzel.removeAttribute("data-vorlauf");
      try { window.dispatchEvent(new Event("pk-vorlauf-weg")); } catch (e) {}
    };

    var el = document.createElement("div");
    el.className = "s-vorlauf";
    el.setAttribute("aria-hidden", "true");
    el.innerHTML = "<div class=\"s-vorlauf__flaeche\"></div>" +
      "<div class=\"s-vorlauf__feld\"><div class=\"s-vorlauf__balken\"></div></div>";
    document.body.appendChild(el);

    var start = Date.now();
    var schriften = !(document.fonts && document.fonts.ready);
    if (!schriften) document.fonts.ready.then(function () { schriften = true; });
    var weg = false;
    var abbauen = function () {
      if (weg) return;
      weg = true;
      el.classList.add("ist-weg");
      // Der Vorhang faehrt mit cctpOut nach oben: nach 0,4 s ist die Seite
      // bis auf einen schmalen Streifen frei.
      window.setTimeout(freigeben, 400);
      window.setTimeout(function () { freigeben(); if (el.parentNode) el.parentNode.removeChild(el); }, 900);
    };
    window.requestAnimationFrame(function () {
      window.requestAnimationFrame(function () { el.classList.add("ist-geladen"); });
    });
    (function warten() {
      var lange = Date.now() - start;
      if ((schriften && lange >= 950) || lange >= 2400) { abbauen(); return; }
      window.setTimeout(warten, 60);
    })();
  })();

  /* --- 3. Weiches Scrollen ------------------------------------------------
     Lenis mit lerp 0.1 und smoothWheel, nachgebaut: das Mausrad setzt ein
     Ziel, jedes Bild rueckt die Lage um zehn Prozent des Rests nach. Nur mit
     feinem Zeiger und ohne reduzierte Bewegung — Touch und Tastatur scrollen
     nativ. Abgegeben wird an innere Rollbereiche (Menue, Fenster, Saeulen),
     an waagerechtes Wischen, an Zoom (Strg/Cmd) und an jedes andere
     Scrollen: wer waehrenddessen die Leiste zieht, gewinnt. */
  (function gleiten() {
    if (reduziert || !window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    var ziel = 0, lage = 0, gesetzt = 0, laeuft = false, zuletzt = 0;

    var rollbar = function (el, dy) {
      for (; el && el !== document.body && el !== wurzel; el = el.parentElement) {
        var oy = getComputedStyle(el).overflowY;
        if ((oy === "auto" || oy === "scroll") && el.scrollHeight > el.clientHeight + 1) {
          if (dy > 0 ? el.scrollTop + el.clientHeight < el.scrollHeight - 1 : el.scrollTop > 0) return true;
        }
      }
      return false;
    };
    var halt = function () { laeuft = false; wurzel.classList.remove("ist-gleitend"); };
    var bild = function (t) {
      if (!laeuft) return;
      // Jemand anderes hat gescrollt (Leiste, Taste, Sprungmarke): abgeben.
      if (Math.abs(window.scrollY - gesetzt) > 2) { halt(); return; }
      var dt = Math.min(64, t - (zuletzt || t)) || 16.7;
      zuletzt = t;
      lage += (ziel - lage) * (1 - Math.pow(0.9, dt / 16.7));
      if (Math.abs(ziel - lage) < 0.5) lage = ziel;
      window.scrollTo(0, lage);
      gesetzt = window.scrollY;
      if (lage === ziel) { halt(); return; }
      window.requestAnimationFrame(bild);
    };
    window.addEventListener("wheel", function (e) {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey) return;
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      if (document.querySelector("dialog[open]") || rollbar(e.target, e.deltaY)) return;
      var d = e.deltaY * (e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? window.innerHeight : 1);
      e.preventDefault();
      if (!laeuft) {
        lage = gesetzt = ziel = window.scrollY;
        zuletzt = 0;
        laeuft = true;
        wurzel.classList.add("ist-gleitend");
        window.requestAnimationFrame(bild);
      }
      var max = wurzel.scrollHeight - window.innerHeight;
      ziel = Math.max(0, Math.min(max, ziel + d));
    }, { passive: false });
  })();

  /* --- 4. Ziffernlauf der Preise ------------------------------------------
     Nur echte, vorhandene Zahlen: jede Ziffer laeuft aus einer Maske nach
     oben, versetzt. Der Text bleibt Zeichen fuer Zeichen derselbe — es
     kommen nur Huellen dazu, und das erst, wenn Bewegung erlaubt ist. */
  (function ziffern() {
    if (reduziert || !("IntersectionObserver" in window)) return;
    var werte = $$(".pack__wert");
    if (!werte.length) return;
    werte.forEach(function (w) {
      var text = w.textContent, n = 0;
      w.textContent = "";
      for (var i = 0; i < text.length; i++) {
        var c = text.charAt(i);
        if (!/\d/.test(c)) { w.appendChild(document.createTextNode(c)); continue; }
        var huelle = document.createElement("span");
        huelle.className = "ziffer";
        var innen = document.createElement("span");
        innen.textContent = c;
        innen.style.setProperty("--z", n++);
        huelle.appendChild(innen);
        w.appendChild(huelle);
      }
    });
    var io = new IntersectionObserver(function (eintraege) {
      eintraege.forEach(function (e) {
        if (!e.isIntersecting) return;
        e.target.classList.add("ziffern-an");
        io.unobserve(e.target);
      });
    }, { rootMargin: "0px 0px -10% 0px" });
    werte.forEach(function (w) { io.observe(w); });
  })();

  /* --- 5. Scroll-Fuellungen ----------------------------------------------
     Flieder unter "Drei Aufgaben" (von links) und Orange im Analyse-Band
     (von rechts, Richtung im CSS): die Flaeche fuellt sich mit dem Scrollen
     und leert sich beim Hochscrollen wieder. Kein Uebergang, keine
     Zeitleiste: der Stand folgt direkt der Scrollposition. 0, wenn die
     Oberkante unten ins Fenster tritt; 1, wenn sie 40 % unter dem oberen
     Rand steht. Bei reduzierter Bewegung bleiben sie ganz gefuellt (CSS). */
  (function fuellungen() {
    var flaechen = $$(".weg__schluss, .analyse-band");
    if (!flaechen.length || reduziert) return;
    var geplant = 0;
    var setzen = function () {
      geplant = 0;
      var h = window.innerHeight;
      flaechen.forEach(function (flaeche) {
        var oben = flaeche.getBoundingClientRect().top;
        var stand = Math.max(0, Math.min(1, (h - oben) / (h * 0.6)));
        flaeche.style.setProperty("--fuell", stand.toFixed(4));
      });
    };
    var planen = function () { if (!geplant) geplant = window.requestAnimationFrame(setzen); };
    setzen();
    window.addEventListener("scroll", planen, { passive: true });
    window.addEventListener("resize", planen);
  })();
})();
