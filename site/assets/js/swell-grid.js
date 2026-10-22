/* =========================================================================
   Swell Grid — Wellenraster im Rechteck der Buehne
   Uebertragen aus der Originkit-Komponente SwellGrid (React) — dieselben
   Konstanten, Wellenterme, Zellmasse und Voreinstellungen, dieselbe
   Zeichenschleife ohne React.

   Abweichungen von der Vorlage:
   · Kein minWidth 1200 / minHeight 800 am Traeger: das Raster fuellt genau
     das Rechteck der Buehne, auf jeder Breite.
   · Den Zeiger hoert die Buehne ab, nicht der Traeger — der liegt unter
     dem Text und wuerde ueber Ueberschrift und Knopf keine Bewegung sehen.
   · Ausserhalb des Bildes ruht die Schleife (IntersectionObserver),
     zusaetzlich zur Pause bei verdecktem Tab wie in der Vorlage.
   · Unter der schwarzen Textflaeche (.hero__block) werden keine Zellen
     gezeichnet, auch keine angeschnittenen: so endet das Raster an einer
     sauberen Zellkante statt mit halben Zellen an der Flaeche.

   Doppelte Anfuehrungszeichen wie in sstr-motion.js: die
   Uebersetzungspruefung liest nur einfache, hier gibt es nichts zu
   uebersetzen.
   ========================================================================= */
(function () {
  "use strict";

  var buehne = document.querySelector(".hero__buehne");
  if (!buehne || !window.requestAnimationFrame) return;

  var MAX_DPR = 2;

  var G = 9.81;
  var BASE_OMEGA = (2 * Math.PI) / 24;
  var A_MIN = 0.095;
  var A_MAX = 0.52;
  var COL_SCALE = 0.055;
  var MIN_ALPHA = 0.06;

  var WAVES = [
    { amplitude: 1, wavelength: 7.5, heading: 1.18, phase: 0 },
    { amplitude: 0.66, wavelength: 4.6, heading: 0.88, phase: 1.7 },
    { amplitude: 0.42, wavelength: 2.7, heading: 1.95, phase: 3.9 },
    { amplitude: 0.26, wavelength: 1.8, heading: 2.32, phase: 5.2 }
  ];

  var BASE_HEADING = WAVES[0].heading;
  var AMPLITUDE_SUM = WAVES.reduce(function (a, w) { return a + w.amplitude; }, 0);

  var SPEED_REF = 50;

  var DAMPING_REF = 3.2;

  function prepare(lengthPct, directionDeg) {
    var scale = Math.max(0.01, lengthPct / 100);
    var heading0 = (directionDeg * Math.PI) / 180;
    return WAVES.map(function (w) {
      var k = (2 * Math.PI) / (w.wavelength * scale);

      var n = Math.max(1, Math.round(Math.sqrt(G * k) / BASE_OMEGA));
      var heading = heading0 + (w.heading - BASE_HEADING);
      return {
        amplitude: w.amplitude,
        phase: w.phase,
        k: k,
        omega: n * BASE_OMEGA,
        cos: Math.cos(heading),
        sin: Math.sin(heading)
      };
    });
  }

  function buildRows(rows, terms, fogZ) {
    var out = [];
    for (var r = 0; r < rows; r += 1) {
      var n = (r + 0.5) / rows;
      var angle = A_MIN + (A_MAX - A_MIN) * n;
      var depth = 1 / Math.tan(angle);
      out.push({
        fog: fogZ + (1 - fogZ) * (1 - n),
        along: terms.map(function (w) { return w.k * depth * w.sin; }),
        per: terms.map(function (w) { return w.k * depth * COL_SCALE * w.cos; })
      });
    }
    return out;
  }

  function resolveColor(host, value, fallback) {
    try {
      var probe = document.createElement("span");
      probe.style.color = value;
      probe.style.display = "none";
      host.appendChild(probe);
      var computed = getComputedStyle(probe).color;
      host.removeChild(probe);
      var m = computed.match(/-?[\d.]+/g);
      if (!m || m.length < 3) return fallback;
      return [
        Math.round(+m[0]),
        Math.round(+m[1]),
        Math.round(+m[2]),
        m.length > 3 ? +m[3] : 1
      ];
    } catch (e) {
      return fallback;
    }
  }

  // Werte der Komponente: Vorgaben, darueber die Originkit-Voreinstellung
  // (speed 36, wave, cursor).
  var background = "#000000";
  var baseColor = "rgba(230, 230, 230, 0.86)";
  var L = {
    size: 9,
    aspect: 438,
    gap: 3,
    rounded: 45,
    speed: 36,
    length: 100,
    direction: 68,
    contrast: 145,
    fog: 16,
    hover: 100,
    reach: 38,
    damping: 10,
    rgba: [230, 230, 230, 0.86]
  };

  var host = document.createElement("div");
  host.className = "hero__swell";
  host.setAttribute("aria-hidden", "true");
  host.style.background = background;
  var canvas = document.createElement("canvas");
  host.appendChild(canvas);
  buehne.insertBefore(host, buehne.firstChild);

  var ctx = canvas.getContext("2d");
  if (!ctx || typeof Path2D !== "function") { buehne.removeChild(host); return; }

  L.rgba = resolveColor(host, baseColor, [230, 230, 230, 0.86]);

  var reduced =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  var cols = 0;
  var rows = 0;
  var cellW = 0;
  var cellH = 0;
  var radius = 0;
  var pitchX = 0;
  var pitchY = 0;
  var trail = new Float32Array(0);
  var rowTerms = [];
  var terms = [];
  var layoutKey = "";
  var fieldKey = "";
  var viewW = 0;
  var viewH = 0;

  var roundRectSupported = typeof Path2D.prototype.roundRect === "function";

  var boxW = Math.max(1, host.offsetWidth);
  var boxH = Math.max(1, host.offsetHeight);
  var boxDirty = true;

  // Aussparung fuer die Textflaeche, in Koordinaten des Traegers
  var block = buehne.querySelector(".hero__block");
  var ausX1 = 0, ausY1 = 0, ausX2 = -1, ausY2 = -1;
  function aussparung() {
    ausX2 = ausY2 = -1;
    if (!block) return;
    var h = host.getBoundingClientRect(), r = block.getBoundingClientRect();
    var zoom = h.width / Math.max(1, host.offsetWidth);
    ausX1 = (r.left - h.left) / zoom;
    ausY1 = (r.top - h.top) / zoom;
    ausX2 = (r.right - h.left) / zoom;
    ausY2 = (r.bottom - h.top) / zoom;
  }

  function layout() {
    var W = boxW;
    var H = boxH;
    var g = Math.max(0, L.gap);
    cellW = Math.max(1, L.size);
    cellH = Math.max(1, (L.size * L.aspect) / 100);
    radius = (Math.min(cellW, cellH) / 2) * (L.rounded / 100);

    cols = Math.max(1, Math.floor((W + g) / (cellW + g)));
    rows = Math.max(1, Math.ceil((H + g) / (cellH + g)));

    pitchX = cols > 1 ? (W - cellW) / (cols - 1) : 0;
    pitchY = cellH + g;

    var n = cols * rows;
    if (trail.length !== n) trail = new Float32Array(n);
    viewW = W;
    viewH = H;

    var dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1);
    canvas.width = Math.max(1, Math.round(W * dpr));
    canvas.height = Math.max(1, Math.round(H * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function rebuildField() {
    terms = prepare(L.length, L.direction);
    rowTerms = buildRows(rows, terms, 1 - L.fog / 100);
  }

  function syncKeys() {
    if (boxDirty) {
      boxDirty = false;
      boxW = Math.max(1, host.offsetWidth);
      boxH = Math.max(1, host.offsetHeight);
      layoutKey = "";
      aussparung();
    }
    var lk = boxW + "x" + boxH + "|" + L.size + "|" + L.aspect + "|" + L.gap + "|" + L.rounded;
    if (lk !== layoutKey) {
      layoutKey = lk;
      layout();
      fieldKey = "";
    }
    var fk = rows + "|" + L.length + "|" + L.direction + "|" + L.fog;
    if (fk !== fieldKey) {
      fieldKey = fk;
      rebuildField();
    }
  }

  var pointerX = 0;
  var pointerY = 0;
  var pointerOn = false;

  var onMove = function (e) {
    var rect = host.getBoundingClientRect();

    var zoom = rect.width / Math.max(1, host.offsetWidth);
    pointerX = (e.clientX - rect.left) / zoom;
    pointerY = (e.clientY - rect.top) / zoom;
    pointerOn = true;
  };
  var onLeave = function () {
    pointerOn = false;
  };

  var paths = [];
  for (var i0 = 0; i0 < 256; i0 += 1) paths.push(null);

  function addCell(p, x, y) {
    if (radius > 0.5 && roundRectSupported) {
      p.roundRect(x, y, cellW, cellH, radius);
    } else {
      p.rect(x, y, cellW, cellH);
    }
  }

  function draw(t, dt) {
    var r = L.rgba[0], g = L.rgba[1], b = L.rgba[2], alphaMax = L.rgba[3];
    var gamma = Math.max(0.01, L.contrast / 100);
    var gain = L.hover / 100;
    var sigma = Math.max(1, L.reach);
    var window3 = sigma * 3;
    var twoSigmaSq = 2 * sigma * sigma;
    var tau = DAMPING_REF / Math.max(1, L.damping);
    var decay = dt > 0 ? Math.exp(-dt / tau) : 1;
    var usePointer = pointerOn && gain > 0;

    for (var i = 0; i < 256; i += 1) paths[i] = null;

    for (var row = 0; row < rows; row += 1) {
      var rt = rowTerms[row];
      if (!rt) continue;
      var y = row * pitchY;
      var halfCol = (cols - 1) / 2;
      for (var col = 0; col < cols; col += 1) {
        var idx = row * cols + col;
        var pulse = trail[idx] * decay;
        if (usePointer) {
          var dx = col * pitchX - pointerX;
          var dy = y - pointerY;
          if (dx > -window3 && dx < window3 && dy > -window3 && dy < window3) {
            var pp = gain * Math.exp(-(dx * dx + dy * dy) / twoSigmaSq);
            if (pp > pulse) pulse = pp;
          }
        }
        trail[idx] = pulse;
        var cx = col * pitchX;
        if (cx < ausX2 && cx + cellW > ausX1 && y < ausY2 && y + cellH > ausY1) continue;

        var o = col - halfCol;
        var s = 0;
        for (var k = 0; k < terms.length; k += 1) {
          var term = terms[k];
          s += term.amplitude * Math.sin(rt.along[k] + rt.per[k] * o - term.omega * t + term.phase);
        }
        var base = Math.pow(0.5 + (0.5 * s) / AMPLITUDE_SUM, gamma) * rt.fog;
        var v = base + (1 - base) * pulse;
        var a = MIN_ALPHA + alphaMax * v;
        var byte = a <= 0 ? 0 : a >= 1 ? 255 : Math.round(a * 255);
        if (byte === 0) continue;
        var p = paths[byte];
        if (!p) {
          p = new Path2D();
          paths[byte] = p;
        }
        addCell(p, col * pitchX, y);
      }
    }

    ctx.clearRect(0, 0, viewW, viewH);
    for (var bt = 1; bt < 256; bt += 1) {
      var path = paths[bt];
      if (!path) continue;
      ctx.fillStyle = "rgba(" + r + ", " + g + ", " + b + ", " + (bt / 255).toFixed(4) + ")";
      ctx.fill(path);
    }
  }

  var raf = 0;
  var last = 0;
  var clock = 0;
  var running = true;

  var frame = function (now) {
    raf = requestAnimationFrame(frame);
    var dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
    last = now;
    syncKeys();
    clock = (clock + dt * (L.speed / SPEED_REF)) % 24;
    draw(clock, dt);
  };

  var gate = function () {
    if (running && !document.hidden) {
      if (!raf) {
        last = 0;
        raf = requestAnimationFrame(frame);
      }
    } else if (raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
  };

  var still = function () { syncKeys(); draw(0, 0); };

  if (typeof ResizeObserver === "function") {
    var ro = new ResizeObserver(function () {
      boxDirty = true;
      if (reduced) still();
    });
    ro.observe(host);
    if (block) ro.observe(block);
  } else {
    window.addEventListener("resize", function () {
      boxDirty = true;
      if (reduced) still();
    });
  }

  buehne.addEventListener("pointermove", onMove, { passive: true });
  buehne.addEventListener("pointerleave", onLeave, { passive: true });

  window.addEventListener("pointercancel", onLeave, { passive: true });
  window.addEventListener("blur", onLeave);
  document.addEventListener("visibilitychange", gate);

  if (reduced) {
    still();
  } else {
    if ("IntersectionObserver" in window) {
      new IntersectionObserver(function (eintraege) {
        running = eintraege[0].isIntersecting;
        gate();
      }).observe(host);
    }
    gate();
  }
})();
