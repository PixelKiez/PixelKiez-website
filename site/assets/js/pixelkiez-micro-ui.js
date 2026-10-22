/* =========================================================================
   Pixelkiez Micro-UI — Abschnitts-Rail
   Uebertragen aus PixelkiezSectionRail (PixelkiezMicroUI.tsx in
   Pixelkiez_Button_ScrollRail.zip) — dieselbe Logik ohne React.

   Abweichung von der Vorlage: Sie liest Abschnitte mit [data-pxk-rail].
   Hier kommen Ziel und Name aus dem bestehenden Hauptmenue — jeder
   Menuepunkt mit Sprungmarke auf einen vorhandenen Abschnitt wird ein
   Eintrag, in derselben Reihenfolge und mit demselben Namen. So aendert
   sich am Markup nichts, und die englische Fassung bekommt die englischen
   Namen, die das Menue dort schon traegt.

   Doppelte Anfuehrungszeichen wie in sstr-motion.js: die
   Uebersetzungspruefung liest nur einfache, hier gibt es nichts zu
   uebersetzen.
   ========================================================================= */
(function () {
  "use strict";

  var links = Array.prototype.slice.call(document.querySelectorAll(".menu a[href^=\"#\"]"));
  var abschnitte = [];
  links.forEach(function (a) {
    var ziel = document.getElementById(a.getAttribute("href").slice(1));
    if (!ziel) return;
    var nummer = a.querySelector(".menu__n");
    var name = a.textContent.replace(nummer ? nummer.textContent : "", "").trim();
    abschnitte.push({ id: ziel.id, name: name, el: ziel });
  });
  if (!abschnitte.length) return;

  var englisch = (document.documentElement.lang || "").indexOf("en") === 0;
  var reduziert = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  var rail = document.createElement("nav");
  rail.className = "pxk-section-rail";
  rail.setAttribute("aria-label", englisch ? "Section navigation" : "Abschnittsnavigation");
  var liste = document.createElement("div");
  liste.className = "pxk-section-rail__items";
  rail.appendChild(liste);

  var eintraege = abschnitte.map(function (s, i) {
    var b = document.createElement("button");
    b.type = "button";
    b.className = "pxk-section-rail__item";
    b.innerHTML = "<span class=\"pxk-section-rail__number\"></span>" +
      "<span class=\"pxk-section-rail__track\" aria-hidden=\"true\"><span class=\"pxk-section-rail__fill\"></span></span>" +
      "<span class=\"pxk-section-rail__label\"></span>";
    b.querySelector(".pxk-section-rail__number").textContent = (i < 9 ? "0" : "") + (i + 1);
    b.querySelector(".pxk-section-rail__label").textContent = s.name;
    b.setAttribute("aria-label", s.name);
    b.addEventListener("click", function () {
      s.el.scrollIntoView({ behavior: reduziert ? "auto" : "smooth", block: "start" });
      // Die vorhandene Sprungmarke in die Adresszeile, ohne zweiten Sprung
      if (window.history && history.replaceState) history.replaceState(null, "", "#" + encodeURIComponent(s.id));
    });
    liste.appendChild(b);
    return { b: b, fill: b.querySelector(".pxk-section-rail__fill") };
  });
  document.body.appendChild(rail);

  // Ton der Flaeche hinter der Rail, aus der berechneten Hintergrundfarbe —
  // dieselbe Regel wie beim Kopfton in sstr-motion.js.
  var flaechen = Array.prototype.slice.call(document.querySelectorAll("main > section, main > aside, .footer"));
  var istDunkel = function (el) {
    var m = getComputedStyle(el).backgroundColor.match(/\d+(\.\d+)?/g);
    if (!m || (m.length > 3 && +m[3] === 0)) return false;
    return (0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]) < 110;
  };
  var dunkle = flaechen.filter(istDunkel);

  var aktiv = -1, ton = null, geplant = 0;
  var auffrischen = function () {
    geplant = 0;
    // Eine feste Linie bei 42 % der Fensterhoehe bestimmt den aktiven
    // Abschnitt, wie in der Vorlage.
    var marke = window.innerHeight * 0.42;
    var index = 0;
    abschnitte.forEach(function (s, i) { if (s.el.getBoundingClientRect().top <= marke) index = i; });
    var r = abschnitte[index].el.getBoundingClientRect();
    var stand = Math.max(0, Math.min(1, (marke - r.top) / Math.max(r.height, 1)));
    eintraege.forEach(function (e, i) {
      e.fill.style.transform = "scaleX(" + (i < index ? 1 : i === index ? stand : 0) + ")";
    });
    if (index !== aktiv) {
      if (aktiv > -1) { eintraege[aktiv].b.classList.remove("is-active"); eintraege[aktiv].b.removeAttribute("aria-current"); }
      eintraege[index].b.classList.add("is-active");
      eintraege[index].b.setAttribute("aria-current", "location");
      aktiv = index;
    }
    var mitte = window.innerHeight / 2, neu = "hell";
    for (var d = 0; d < dunkle.length; d++) {
      var q = dunkle[d].getBoundingClientRect();
      if (q.top <= mitte && q.bottom > mitte) { neu = "dunkel"; break; }
    }
    if (neu !== ton) { ton = neu; rail.setAttribute("data-ton", neu); }
  };
  var planen = function () { if (!geplant) geplant = window.requestAnimationFrame(auffrischen); };
  auffrischen();
  window.addEventListener("scroll", planen, { passive: true });
  window.addEventListener("resize", function () { dunkle = flaechen.filter(istDunkel); planen(); });
})();
