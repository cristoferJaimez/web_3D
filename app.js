/* HHH3D — lógica del sitio: hero 3D, visor STL, cotizador, catálogo y precios. */
(() => {
  const C = window.CONFIG;
  const $ = (s) => document.querySelector(s);
  const ACCENT = 0xc6ff3d;
  const FIL_AREA = Math.PI * 0.875 * 0.875; // sección de filamento de 1.75 mm

  const cop = (n) => "$ " + Math.round(n).toLocaleString("es-CO");
  // Modo taller (?taller en la dirección): costos internos, margen, TRM y tarifas.
  // El cliente solo ve precios, pesos, tiempos y medidas.
  const TALLER = new URLSearchParams(location.search).has("taller") || location.hash === "#taller";
  document.documentElement.classList.toggle("taller", TALLER);
  // Precio para mostrar: siempre se calcula en pesos; en USD se convierte con la TRM del día
  const money = (n) => state.currency === "USD"
    ? "US$ " + (n / state.trm).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : cop(n);
  const roundTo = (n, step) => Math.ceil(n / step) * step;

  const state = {
    trm: C.trm.respaldo,
    trmFecha: null,
    trmFuente: "valor de respaldo",
    mat: Object.keys(C.materiales)[0],
    color: 0,
    nozzle: (C.boquillas.find((b) => b.defecto) || C.boquillas[0]).d,
    calidad: 1, // índice en C.calidades
    acabado: "uno", // uno | placas | pintado
    pintura: "basica",
    pieceColors: {}, // "placa:pieza" → color
    baseColor: 0, // color de las piezas sin pintar en multicolor
    led: { on: false, tipo: "blanco", metros: null }, // metros null = sugerido por la pieza
    fit: "ajustar", // ajustar a la impresora | dividir en placas
    currency: "COP",
    infill: 20,
    scale: 100,
    supports: false,
    qty: 1,
    model: null, // { name, volume, area, size: Vector3 }
  };

  /* ---------------- precios ---------------- */
  // Precio actual del kg: la parte importada sigue a la TRM del día.
  function priceKg(key) {
    const m = C.materiales[key];
    if (!m.importado) return m.precio_kg;
    const ratio = state.trm / C.trm.referencia;
    return m.precio_kg * (1 + C.trm.peso_importado * (ratio - 1));
  }

  async function fetchJSON(url, ms = 6000) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), ms);
    try {
      const r = await fetch(url, { signal: ctl.signal });
      if (!r.ok) throw new Error(r.status);
      return await r.json();
    } finally {
      clearTimeout(t);
    }
  }

  // precios.json lo genera la tarea automática diaria (scripts/actualizar-precios.mjs).
  // Sus precios ya están en pesos de ese día, así que su TRM pasa a ser la referencia.
  async function loadDailyPrices() {
    try {
      const d = await fetchJSON("precios.json?v=" + new Date().toISOString().slice(0, 10), 4000);
      for (const [k, v] of Object.entries(d.materiales || {})) {
        if (C.materiales[k] && v.precio_kg) {
          C.materiales[k].precio_kg = v.precio_kg;
          C.materiales[k].fuente = v.fuente;
        }
      }
      if (d.trm && d.trm.valor) {
        C.trm.referencia = d.trm.valor;
        Object.assign(state, { trm: d.trm.valor, trmFecha: d.trm.fecha, trmFuente: d.trm.fuente });
      }
      if (d.actualizado) C.precios_revisados = d.actualizado;
    } catch (e) { /* sin precios.json (p. ej. abierto como archivo local): usar config.js */ }
  }

  async function loadTRM() {
    if (!C.trm.auto) return;
    try {
      const cached = JSON.parse(localStorage.getItem("trm") || "null");
      if (cached && Date.now() - cached.t < 6 * 3600e3) {
        Object.assign(state, { trm: cached.v, trmFecha: cached.f, trmFuente: cached.s });
        return;
      }
    } catch (e) { /* almacenamiento no disponible */ }

    const sources = [
      async () => {
        const d = await fetchJSON("https://www.datos.gov.co/resource/32sa-8pi3.json?$order=vigenciadesde%20DESC&$limit=1");
        return { v: parseFloat(d[0].valor), f: d[0].vigenciadesde.slice(0, 10), s: "TRM oficial · datos.gov.co" };
      },
      async () => {
        const d = await fetchJSON("https://open.er-api.com/v6/latest/USD");
        return { v: d.rates.COP, f: new Date(d.time_last_update_unix * 1000).toISOString().slice(0, 10), s: "open.er-api.com" };
      },
    ];
    for (const src of sources) {
      try {
        const r = await src();
        if (!r.v || !isFinite(r.v)) continue;
        Object.assign(state, { trm: r.v, trmFecha: r.f, trmFuente: r.s });
        try { localStorage.setItem("trm", JSON.stringify({ ...r, t: Date.now() })); } catch (e) {}
        return;
      } catch (e) { /* probar siguiente fuente */ }
    }
  }

  // Tarifa de luz: la de tu factura, ajustada por el tiempo que pasó desde que la anotaste
  // (no depende de precios.json)
  function energyPrice() {
    const e = C.energia;
    const years = Math.max(0, (Date.now() - new Date(e.revisada)) / (365.25 * 864e5));
    return Math.round(e.precio_kwh * (1 + (e.alza_anual || 0)) ** years);
  }
  C.energia.base_kwh = C.energia.precio_kwh;
  C.energia.precio_kwh = energyPrice();

  /* ---------------- textos del negocio ---------------- */
  function bindTexts() {
    document.querySelectorAll("[data-bind]").forEach((el) => {
      el.textContent = C.negocio[el.dataset.bind] || "";
    });
    document.title = `${C.negocio.nombre} — ${C.negocio.eslogan}`;
    $("#year").textContent = new Date().getFullYear();
    $("#c-wa").href = `https://wa.me/${C.negocio.whatsapp}`;
    $("#c-ig").href = `https://instagram.com/${C.negocio.instagram}`;
    $("#c-mail").href = `mailto:${C.negocio.email}`;
    $("#c-mail").textContent = C.negocio.email;
  }

  /* ---------------- hero: el logo HHH3D "imprimiéndose" ---------------- */
  // Mismas medidas que logo.svg (lienzo de 64, y hacia abajo)
  const LOGO = {
    letras: [
      [9, 9, 3.6, 20], [17.4, 9, 3.6, 20], [9, 17.2, 12, 3.6],
      [25.8, 9, 3.6, 20], [34.6, 9, 3.6, 20], [25.8, 17.2, 12.4, 3.6],
      [43, 9, 3.6, 20], [51.4, 9, 3.6, 20], [43, 17.2, 12, 3.6],
    ],
    boquilla: [[[20, 31.5], [44, 31.5], [37, 42], [27, 42]], [[28.6, 42], [35.4, 42], [33.2, 47.2], [30.8, 47.2]]],
    filamento: [9, 51, 23.5, 3.6],
  };

  function logoGeometry() {
    const rect = ([x, y, w, h]) => {
      const s = new THREE.Shape();
      s.moveTo(x, -y);
      s.lineTo(x + w, -y);
      s.lineTo(x + w, -y - h);
      s.lineTo(x, -y - h);
      return s;
    };
    const poly = (pts) => new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, -y)));
    const opts = { depth: 6, bevelEnabled: true, bevelThickness: 0.5, bevelSize: 0.35, bevelSegments: 2 };
    const dot = new THREE.Shape();
    dot.absarc(32, -49.6, 1.6, 0, Math.PI * 2);
    const parts = {
      letras: new THREE.ExtrudeGeometry(LOGO.letras.map(rect), opts),
      boquilla: new THREE.ExtrudeGeometry(LOGO.boquilla.map(poly), opts),
      filamento: new THREE.ExtrudeGeometry([rect(LOGO.filamento), dot], { ...opts, depth: 3 }),
    };
    // centrar en el origen y llevar a ~6 unidades de alto
    for (const g of Object.values(parts)) {
      g.translate(-32, 31, -3);
      g.scale(0.11, 0.11, 0.11);
    }
    parts.filamento.translate(0, 0, 0.17);

    // "3D" grande detrás del HHH, apoyado en la misma cama
    const lb = new THREE.Box3();
    Object.values(parts).forEach((g) => { g.computeBoundingBox(); lb.union(g.boundingBox); });
    parts.tresd = threeDGeometry();
    parts.tresd.computeBoundingBox();
    TRESD.dy = lb.min.y - parts.tresd.boundingBox.min.y;
    parts.tresd.translate(0, TRESD.dy, 0);
    // centrar el conjunto HHH + 3D
    const all = new THREE.Box3();
    Object.values(parts).forEach((g) => { g.computeBoundingBox(); all.union(g.boundingBox); });
    TRESD.dx = -(all.min.x + all.max.x) / 2;
    Object.values(parts).forEach((g) => g.translate(TRESD.dx, 0, 0));
    return parts;
  }

  // "3D" en bloques, mismo grosor de trazo que las H (lienzo propio de 32 × 20, y hacia arriba)
  const TRESD = { escala: 0.2, x: 4.7, z: -1.2, dy: 0, dx: 0 };
  const box2 = (x, y, w, h) => {
    const s = new THREE.Shape();
    s.moveTo(x, y);
    s.lineTo(x + w, y);
    s.lineTo(x + w, y + h);
    s.lineTo(x, y + h);
    return s;
  };
  const placeTresD = (g) => {
    g.scale(TRESD.escala, TRESD.escala, TRESD.escala);
    g.translate(TRESD.x + TRESD.dx, TRESD.dy, TRESD.z);
    return g;
  };

  function threeDGeometry() {
    const tres = [box2(0, 16.4, 12, 3.6), box2(3, 8.2, 9, 3.6), box2(0, 0, 12, 3.6), box2(8.4, 0, 3.6, 20)];
    const d = new THREE.Shape();
    d.moveTo(16, 0);
    d.lineTo(22, 0);
    d.absarc(22, 10, 10, -Math.PI / 2, Math.PI / 2, false);
    d.lineTo(16, 20);
    d.lineTo(16, 0);
    const hole = new THREE.Path();
    hole.moveTo(19.6, 3.6);
    hole.lineTo(22, 3.6);
    hole.absarc(22, 10, 6.4, -Math.PI / 2, Math.PI / 2, false);
    hole.lineTo(19.6, 16.4);
    hole.lineTo(19.6, 3.6);
    d.holes.push(hole);
    const g = new THREE.ExtrudeGeometry([...tres, d], {
      depth: 4, bevelEnabled: true, bevelThickness: 0.3, bevelSize: 0.2, bevelSegments: 1, curveSegments: 24,
    });
    g.translate(-16, 0, -2);
    g.scale(TRESD.escala, TRESD.escala, TRESD.escala);
    g.translate(TRESD.x, 0, TRESD.z);
    return g;
  }

  // Soportes bajo los brazos del "3" (los travesaños quedan en el aire)
  function threeDSupportGeometry() {
    const gap = 0.3;
    const cols = [
      [3.4, 3.6, 1, 8.2 - gap - 3.6], [5.6, 3.6, 1, 8.2 - gap - 3.6],
      [0.4, 3.6, 1, 16.4 - gap - 3.6], [1.8, 3.6, 0.9, 16.4 - gap - 3.6],
      [3.4, 11.8, 1, 16.4 - gap - 11.8], [5.6, 11.8, 1, 16.4 - gap - 11.8],
    ];
    const g = new THREE.ExtrudeGeometry(cols.map(([x, y, w, h]) => box2(x, y, w, h)), { depth: 3.4, bevelEnabled: false });
    g.translate(-16, 0, -1.7);
    return placeTresD(g);
  }

  // Soportes en columnas bajo los voladizos: patas de las H y cara inclinada de la boquilla
  function supportGeometry() {
    const ground = 54.6, lineTop = 51, nozzleTop = 31.5, gap = 0.4;
    const base = (x) => (x >= 9 && x <= 32.5 ? lineTop : ground); // sobre la línea de filamento o la cama
    const cols = [];
    for (const [x, y, , h] of LOGO.letras) {
      if (h < 10) continue; // los travesaños son puentes entre patas: no llevan soporte
      for (const cx of [x + 0.3, x + 2.1]) {
        const onNozzle = cx >= 20 && cx + 1.2 <= 44;
        const top = y + h + gap;
        cols.push([cx, top, 1.2, (onNozzle ? nozzleTop : base(cx)) - top]);
      }
    }
    for (const cx of [20.4, 22.6, 24.8, 37.6, 39.8, 42]) {
      const mid = cx + 0.6;
      const under = 31.5 + (mid < 32 ? mid - 20 : 44 - mid) * (10.5 / 7) + gap;
      cols.push([cx, under, 1.2, base(cx) - under]);
    }
    const shapes = cols.filter((c) => c[3] > 0.3).map(([x, y, w, h]) => {
      const s = new THREE.Shape();
      s.moveTo(x, -y);
      s.lineTo(x + w, -y);
      s.lineTo(x + w, -y - h);
      s.lineTo(x, -y - h);
      return s;
    });
    const g = new THREE.ExtrudeGeometry(shapes, { depth: 4.6, bevelEnabled: false });
    g.translate(-32, 31, -2.3);
    g.scale(0.11, 0.11, 0.11);
    g.translate(TRESD.dx, 0, 0);
    return g;
  }

  // Tapa de la capa actual: dibuja el relleno giroide dentro de la sección cortada
  function gyroidCap(color) {
    return new THREE.ShaderMaterial({
      uniforms: { uY: { value: 0 }, uColor: { value: new THREE.Color(color) } },
      vertexShader: `
        varying vec2 vP;
        void main() {
          vP = position.xy;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        uniform float uY;
        uniform vec3 uColor;
        varying vec2 vP;
        void main() {
          vec3 p = vec3(vP.x, uY, vP.y) * 34.0;
          float g = sin(p.x) * cos(p.y) + sin(p.y) * cos(p.z) + sin(p.z) * cos(p.x);
          float wall = 1.0 - smoothstep(0.10, 0.32, abs(g));
          gl_FragColor = vec4(mix(uColor * 0.16, uColor * 1.15, wall), 1.0);
        }`,
      stencilWrite: true,
      stencilRef: 0,
      stencilFunc: THREE.NotEqualStencilFunc,
      stencilFail: THREE.ReplaceStencilOp,
      stencilZFail: THREE.ReplaceStencilOp,
      stencilZPass: THREE.ReplaceStencilOp,
    });
  }

  function initHero() {
    const canvas = $("#hero-canvas");
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, stencil: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.localClippingEnabled = true;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 200);
    camera.position.set(0, 1.2, 14);

    scene.add(new THREE.HemisphereLight(0xffffff, 0x222233, 0.8));
    const key = new THREE.DirectionalLight(0xffffff, 1.1);
    key.position.set(5, 8, 6);
    scene.add(key);
    const rim = new THREE.PointLight(0x7c5cff, 2.5, 30);
    rim.position.set(-6, 2, -4);
    scene.add(rim);

    const group = new THREE.Group();
    scene.add(group);
    const geos = logoGeometry();
    const box = new THREE.Box3();
    Object.values(geos).forEach((g) => { g.computeBoundingBox(); box.union(g.boundingBox); });
    const { min, max } = box;
    const w = max.x - min.x, d = max.z - min.z;
    // el corte se define en coordenadas del logo y se pasa al mundo en cada cuadro
    const localPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), min.y);
    const plane = new THREE.Plane();

    const VIOLET = 0x7c5cff;
    const colors = { letras: ACCENT, boquilla: 0xeceef2, filamento: ACCENT, tresd: VIOLET };
    const mats = {
      letras: new THREE.MeshStandardMaterial({ color: ACCENT, roughness: 0.4, metalness: 0.1 }),
      boquilla: new THREE.MeshStandardMaterial({ color: 0xeceef2, roughness: 0.35, metalness: 0.15 }),
      filamento: new THREE.MeshStandardMaterial({ color: ACCENT, roughness: 0.4, metalness: 0.1, emissive: ACCENT, emissiveIntensity: 0.25 }),
      tresd: new THREE.MeshStandardMaterial({ color: VIOLET, roughness: 0.45, metalness: 0.1, emissive: VIOLET, emissiveIntensity: 0.12 }),
    };
    const ghostMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.08 });
    const caps = [];
    Object.keys(geos).forEach((k, i) => {
      const geo = geos[k];
      // técnica de stencil: caras traseras suman, delanteras restan; donde queda ≠ 0 está el interior
      for (const [side, op] of [[THREE.BackSide, THREE.IncrementWrapStencilOp], [THREE.FrontSide, THREE.DecrementWrapStencilOp]]) {
        const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
          depthWrite: false, depthTest: false, colorWrite: false, side, clippingPlanes: [plane],
          stencilWrite: true, stencilFunc: THREE.AlwaysStencilFunc,
          stencilFail: op, stencilZFail: op, stencilZPass: op,
        }));
        m.renderOrder = i * 2 + 1;
        group.add(m);
      }
      const cap = new THREE.Mesh(new THREE.PlaneGeometry(w + 2, d + 2), gyroidCap(colors[k]));
      cap.rotation.x = -Math.PI / 2;
      cap.position.set((min.x + max.x) / 2, 0, (min.z + max.z) / 2);
      cap.renderOrder = i * 2 + 1.5;
      cap.onAfterRender = (r) => r.clearStencil();
      caps.push(cap);
      group.add(cap);

      Object.assign(mats[k], { clippingPlanes: [plane] });
      const solid = new THREE.Mesh(geo, mats[k]);
      solid.renderOrder = 10;
      group.add(solid);
      group.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo, 20), ghostMat));
    });

    const supportMat = new THREE.MeshStandardMaterial({
      color: 0x7d828c, roughness: 0.9, transparent: true, clippingPlanes: [plane],
    });
    const supports = new THREE.Mesh(supportGeometry(), supportMat);
    supports.renderOrder = 10;
    const supports3D = new THREE.Mesh(threeDSupportGeometry(), supportMat);
    supports3D.renderOrder = 10;
    group.add(supports, supports3D);
    let withSupports = true;
    const overhangY = (31 - 42) * 0.11; // primera capa con voladizo (base de la boquilla del logo)

    // capa que se está imprimiendo: una franja de luz del ancho del logo
    const glow = new THREE.Mesh(
      new THREE.PlaneGeometry(w + 1.2, d + 1.2),
      new THREE.MeshBasicMaterial({ color: ACCENT, transparent: true, opacity: 0.1, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    glow.rotation.x = -Math.PI / 2;
    glow.position.set((min.x + max.x) / 2, 0, (min.z + max.z) / 2);
    glow.renderOrder = 20;
    const nozzle = new THREE.Group();
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.55, 24), new THREE.MeshStandardMaterial({ color: 0xd8dbe0, roughness: 0.3, metalness: 0.5 }));
    cone.rotation.x = Math.PI;
    const block = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.45, 0.7), new THREE.MeshStandardMaterial({ color: 0x2a2d35, roughness: 0.6 }));
    block.position.y = 0.48;
    nozzle.add(cone, block);
    nozzle.renderOrder = 20;
    group.add(glow, nozzle);

    const grid = new THREE.GridHelper(14, 28, 0x2a2e38, 0x161920);
    grid.position.y = min.y - 0.05;
    group.add(grid);

    function resize() {
      const cw = canvas.clientWidth, ch = canvas.clientHeight;
      renderer.setSize(cw, ch, false);
      camera.aspect = cw / ch;
      camera.updateProjectionMatrix();
      // escritorio: logo en el espacio libre a la derecha del texto, por encima de la barra de estado
      // móvil: arriba y centrado
      const unitsPerPx = (2 * camera.position.z * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) / ch;
      const wide = camera.aspect > 1.1;
      if (wide) {
        group.scale.setScalar(0.66);
        group.position.set(Math.min(380, cw * 0.3) * unitsPerPx, 0.8, 0);
      } else {
        // móvil: el lienzo puede ser más alto que la pantalla; ubicar el logo a ~210 px del borde superior
        group.scale.setScalar((Math.min(cw * 0.86, 460) * unitsPerPx) / w); // en tablet no crece de más
        group.position.set(0, (ch / 2 - 210) * unitsPerPx + camera.position.y, 0);
      }
    }
    addEventListener("resize", resize);
    resize();

    let mx = 0, my = 0;
    addEventListener("pointermove", (e) => {
      mx = e.clientX / innerWidth - 0.5;
      my = e.clientY / innerHeight - 0.5;
    });

    /* ---- simulación de la impresión (panel tipo pantalla de la impresora) ---- */
    const mat = C.materiales.PLA || Object.values(C.materiales)[0];
    const sim = {
      noz: mat.temp_boquilla || 220, bed: mat.temp_cama || 65,
      grams: 96.4, minutes: 214, capa: 0.2, infill: 15,
    };
    sim.layers = Math.round(((max.y - min.y) / 0.11) / sim.capa);
    const supGrams = 8.6, supMinutes = 22;
    const totals = () => {
      const g = sim.grams + (withSupports ? supGrams : 0);
      return { g, m: g / mat.densidad / FIL_AREA, min: sim.minutes + (withSupports ? supMinutes : 0) };
    };
    const hud = {};
    ["dot", "state", "machine", "noz", "noz-t", "bed", "bed-t", "mat", "g", "m", "layer", "layers", "speed", "fan", "eta", "bar", "progress"]
      .forEach((id) => { hud[id] = $("#hud-" + id); });
    hud.machine.textContent = C.maquina.nombre.toUpperCase();
    hud["noz-t"].textContent = `/ ${sim.noz} °C`;
    hud["bed-t"].textContent = `/ ${sim.bed} °C`;
    hud.mat.textContent = mat.nombre;
    hud.layers.textContent = `/ ${sim.layers}`;
    const foot = document.querySelector(".hud-foot span:last-child");
    const supBtn = $("#hud-sup");
    const renderSupBtn = () => {
      supBtn.textContent = withSupports ? "Soportes: activados" : "Soportes: desactivados";
      supBtn.classList.toggle("on", withSupports);
      supBtn.setAttribute("aria-pressed", withSupports);
      foot.textContent = `Ø0.4 mm · capa ${sim.capa} mm · giroide ${sim.infill}% · ${withSupports ? "con" : "sin"} soportes`;
      supports.visible = withSupports;
      supports3D.visible = withSupports;
      lastPhase = ""; // refrescar el estado
    };
    supBtn.onclick = () => { withSupports = !withSupports; renderSupBtn(); };

    const HEAT = 2.5, PRINT = 12, DONE = 2.5, CYCLE = HEAT + PRINT + DONE;
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let lastHud = 0, lastPhase = "";
    renderSupBtn();

    function updateHud(t, phase, p, heat) {
      const jitter = Math.sin(t * 3.7) * 0.4 + Math.sin(t * 9.1) * 0.3;
      let noz, bed, speed = 0, fan = 0;
      if (phase === "heat") {
        noz = 25 + (sim.noz - 25) * heat;
        bed = 25 + (sim.bed - 25) * Math.min(1, heat * 1.15);
      } else if (phase === "print") {
        noz = sim.noz + jitter;
        bed = sim.bed + jitter * 0.3;
        speed = Math.round(200 + Math.sin(t * 2.3) * 60 + Math.sin(t * 7) * 25);
        fan = p * sim.layers < 3 ? 0 : 100;
      } else {
        const c = Math.min(1, (t - HEAT - PRINT) / DONE);
        noz = sim.noz - (sim.noz - 160) * c;
        bed = sim.bed - 8 * c;
      }
      hud.noz.textContent = Math.round(noz) + "°";
      hud.bed.textContent = Math.round(bed) + "°";
      hud.speed.textContent = speed;
      hud.fan.textContent = fan + "%";
      const tot = totals();
      hud.g.textContent = (tot.g * p).toFixed(1) + " g";
      hud.m.textContent = (tot.m * p).toFixed(2) + " m";
      hud.layer.textContent = String(Math.round(p * sim.layers)).padStart(3, "0");
      const left = Math.round(tot.min * (1 - p));
      let eta = `${left} min`;
      if (left >= 60) eta = `${Math.floor(left / 60)}h ${String(left % 60).padStart(2, "0")}m`;
      if (phase === "done") eta = "listo";
      hud.eta.textContent = eta;
      // sin soportes, al llegar a los voladizos la impresión falla (como en la vida real)
      if (phase === "print" && !withSupports && localPlane.constant > overhangY) phase = "warn";
      hud.bar.style.width = (p * 100).toFixed(1) + "%";
      hud.progress.textContent = Math.round(p * 100) + "%";
      if (phase !== lastPhase) {
        lastPhase = phase;
        const label = { heat: "CALENTANDO", print: "IMPRIMIENDO", done: "TERMINADO", warn: "⚠ VOLADIZO SIN SOPORTE" }[phase];
        const cls = { heat: "", print: "printing", done: "done", warn: "warn" }[phase];
        hud.state.textContent = label;
        hud.state.className = "hud-state " + cls;
        hud.dot.className = "hud-dot " + cls;
      }
    }

    function tick(ms) {
      const t = reduce ? HEAT + PRINT + 0.1 : (ms / 1000) % CYCLE;
      const phase = t < HEAT ? "heat" : t < HEAT + PRINT ? "print" : "done";
      const p = phase === "heat" ? 0 : Math.min(1, (t - HEAT) / PRINT);
      const y = min.y + (max.y - min.y) * p;

      group.rotation.y = Math.sin(ms / 1000 * 0.45) * 0.55 - 0.25 + mx * 0.5;
      group.rotation.x = 0.12 + my * 0.15;
      group.updateMatrixWorld();
      localPlane.constant = y + 0.001;
      plane.copy(localPlane).applyMatrix4(group.matrixWorld);

      for (const cap of caps) {
        cap.position.y = y;
        cap.material.uniforms.uY.value = y;
        cap.visible = phase === "print";
      }
      glow.position.y = y + 0.01;
      glow.visible = phase === "print";
      nozzle.position.set((min.x + max.x) / 2 + Math.sin(ms / 1000 * 7) * (w / 2), y + 0.3, (min.z + max.z) / 2 + Math.cos(ms / 1000 * 3.1) * (d / 2));
      if (phase === "heat") nozzle.position.set(max.x + 0.6, min.y + 1.2, 0);
      nozzle.visible = phase !== "done";
      // al terminar se retiran los soportes
      supportMat.opacity = phase === "done" ? Math.max(0, 1 - (t - HEAT - PRINT) / 1.2) : 1;

      if (ms - lastHud > 90) {
        lastHud = ms;
        updateHud(t, phase, p, Math.min(1, t / HEAT));
      }
      renderer.render(scene, camera);
      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  /* ---------------- visor STL ---------------- */
  const viewer = {};
  function initViewer() {
    const el = $("#viewer");
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.localClippingEnabled = true;
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, 1, 1, 20000);
    camera.position.set(200, 160, 200);
    const controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    // quieto por defecto (girar marea); el visitante lo activa con el botón "Girar"
    let spin = false;
    try { spin = localStorage.getItem("girar") === "1"; } catch (e) { /* sin almacenamiento: quieto */ }
    controls.autoRotate = spin;
    controls.autoRotateSpeed = 0.8;
    const spinBtn = $("#spin-btn");
    const paintSpin = () => {
      spinBtn.classList.toggle("on", controls.autoRotate);
      spinBtn.setAttribute("aria-pressed", controls.autoRotate);
      spinBtn.textContent = controls.autoRotate ? "⏸ Detener giro" : "⟳ Girar";
    };
    spinBtn.onclick = () => {
      controls.autoRotate = !controls.autoRotate;
      try { localStorage.setItem("girar", controls.autoRotate ? "1" : "0"); } catch (e) { /* sin almacenamiento */ }
      paintSpin();
    };
    paintSpin();

    scene.add(new THREE.HemisphereLight(0xffffff, 0x404050, 1.1));
    scene.add(new THREE.AmbientLight(0xffffff, 0.25));
    const d1 = new THREE.DirectionalLight(0xffffff, 1.1);
    d1.position.set(1, 2, 1.5);
    scene.add(d1);
    const d2 = new THREE.DirectionalLight(0x7c5cff, 0.5);
    d2.position.set(-2, 1, -1);
    scene.add(d2);

    const printer = buildPrinter();
    scene.add(printer.group);

    const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5, metalness: 0.05 });
    Object.assign(viewer, { el, renderer, scene, camera, controls, material, printer, mesh: null });
    fitCamera();

    function resize() {
      const w = el.clientWidth;
      renderer.setSize(w, w, false);
      camera.aspect = 1;
      camera.updateProjectionMatrix();
    }
    new ResizeObserver(resize).observe(el);
    resize();

    (function loop() {
      controls.update();
      renderer.render(scene, camera);
      requestAnimationFrame(loop);
    })();
  }

  // Impresora simplificada (bed slinger tipo A1): base, cama, torre Z, pórtico X,
  // cabezal y el volumen de impresión marcado.
  function buildPrinter() {
    const [bx, by, bz] = C.maquina.volumen_mm;
    const group = new THREE.Group();
    const body = new THREE.MeshStandardMaterial({ color: 0x8f949c, roughness: 0.75, metalness: 0.1 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x24272e, roughness: 0.7, metalness: 0.3 });
    const box = (w, h, d, mat, x, y, z) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.position.set(x, y, z);
      group.add(m);
      return m;
    };

    const towerX = -(bx / 2 + 40);
    box(bx + 110, 36, 140, body, -25, -40, 0);           // base
    box(30, by + 120, 16, dark, 0, -26, 0).rotation.x = Math.PI / 2; // riel Y
    box(bx + 8, 5, by + 8, dark, 0, -2.5, 0);             // cama PEI
    box(34, bz + 90, 44, body, towerX, (bz + 90) / 2 - 58, 0); // torre Z
    const gantry = new THREE.Group();
    const beam = new THREE.Mesh(new THREE.BoxGeometry(bx + 60, 16, 20), body);
    beam.position.x = -25;
    const head = new THREE.Mesh(new THREE.BoxGeometry(42, 58, 48), body);
    head.position.set(0, 4, 26);
    const nozzle = new THREE.Mesh(new THREE.ConeGeometry(4, 10, 16), dark);
    nozzle.rotation.x = Math.PI;
    nozzle.position.set(0, -30, 26);
    gantry.add(beam, head, nozzle);
    group.add(gantry);

    const grid = new THREE.GridHelper(bx, bx / 16, 0x4a505e, 0x2d313b);
    grid.position.y = 0.2;
    group.add(grid);

    const volume = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(bx, bz, by)),
      new THREE.LineBasicMaterial({ color: ACCENT, transparent: true, opacity: 0.35 })
    );
    volume.position.y = bz / 2;
    group.add(volume);

    return {
      group,
      setHeight: (h) => { gantry.position.y = Math.min(h, bz) + 36; },
    };
  }

  // Escala máxima (%) para que la pieza quepa entera en el volumen de impresión
  function maxScale() {
    const [bx, by, bz] = C.maquina.volumen_mm;
    const sz = state.model.size;
    const fit = Math.min(bx / sz.x, by / sz.z, bz / sz.y) * 100;
    return Math.max(1, Math.min(300, Math.floor(fit)));
  }

  const nozzle = () => C.boquillas.find((b) => b.d === state.nozzle);
  const layerHeight = () => nozzle().capas[state.calidad];

  // Volumen y área a partir de los triángulos (mm³ y mm²)
  function analyze(geo, start = 0, count = geo.attributes.position.count / 3) {
    const p = geo.attributes.position.array;
    let vol = 0, area = 0, minY = Infinity, maxY = -Infinity;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = start * 9, end = (start + count) * 9; i < end; i += 9) {
      minY = Math.min(minY, p[i + 1], p[i + 4], p[i + 7]);
      maxY = Math.max(maxY, p[i + 1], p[i + 4], p[i + 7]);
      minX = Math.min(minX, p[i], p[i + 3], p[i + 6]);
      maxX = Math.max(maxX, p[i], p[i + 3], p[i + 6]);
      minZ = Math.min(minZ, p[i + 2], p[i + 5], p[i + 8]);
      maxZ = Math.max(maxZ, p[i + 2], p[i + 5], p[i + 8]);
      const ax = p[i], ay = p[i + 1], az = p[i + 2];
      const bx = p[i + 3], by = p[i + 4], bz = p[i + 5];
      const cx = p[i + 6], cy = p[i + 7], cz = p[i + 8];
      vol += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
      const ux = bx - ax, uy = by - ay, uz = bz - az, vx = cx - ax, vy = cy - ay, vz = cz - az;
      area += Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
    }
    // medidas en mm: ancho (X), fondo (Z) y alto (Y)
    return { volume: Math.abs(vol), area, minY, maxY, minX, minZ, dims: [maxX - minX, maxZ - minZ, maxY - minY] };
  }

  // "8,9 × 5,2 × 12 cm" a partir de [ancho, fondo, alto] en mm
  const cm = (v) => (v / 10).toLocaleString("es-CO", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const fmtDims = (d) => `${d.map(cm).join(" × ")} cm`;

  /* ---------------- división en placas ---------------- */
  // Columnas verticales sobre el modelo: en cada una se guardan los tramos [y0, y1]
  // con material. Así se mide el volumen de cualquier placa sin cortar la malla.
  const GRID = 100;
  function buildColumns(geo, size) {
    const p = geo.attributes.position.array;
    const x0 = -size.x / 2, z0 = -size.z / 2;
    const cw = size.x / GRID || 1, cd = size.z / GRID || 1;
    const jx = 0.0137 * cw, jz = 0.0291 * cd; // evita centros justo sobre aristas
    const hits = Array.from({ length: GRID * GRID }, () => []);
    const n = p.length / 9, cen = new Float32Array(n * 3), ar = new Float32Array(n);

    for (let t = 0, i = 0; t < n; t++, i += 9) {
      const ax = p[i], ay = p[i + 1], az = p[i + 2];
      const bx = p[i + 3], by = p[i + 4], bz = p[i + 5];
      const qx = p[i + 6], qy = p[i + 7], qz = p[i + 8];
      cen[t * 3] = (ax + bx + qx) / 3;
      cen[t * 3 + 1] = (ay + by + qy) / 3;
      cen[t * 3 + 2] = (az + bz + qz) / 3;
      const ux = bx - ax, uy = by - ay, uz = bz - az, vx = qx - ax, vy = qy - ay, vz = qz - az;
      ar[t] = Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;

      const d = ux * vz - vx * uz;
      if (Math.abs(d) < 1e-12) continue;
      const i0 = Math.max(0, Math.ceil((Math.min(ax, bx, qx) - x0 - jx) / cw - 0.5));
      const i1 = Math.min(GRID - 1, Math.floor((Math.max(ax, bx, qx) - x0 - jx) / cw - 0.5));
      const k0 = Math.max(0, Math.ceil((Math.min(az, bz, qz) - z0 - jz) / cd - 0.5));
      const k1 = Math.min(GRID - 1, Math.floor((Math.max(az, bz, qz) - z0 - jz) / cd - 0.5));
      for (let ii = i0; ii <= i1; ii++) {
        const px = x0 + (ii + 0.5) * cw + jx - ax;
        for (let kk = k0; kk <= k1; kk++) {
          const pz = z0 + (kk + 0.5) * cd + jz - az;
          const u = (px * vz - vx * pz) / d;
          const v = (ux * pz - px * uz) / d;
          if (u < 0 || v < 0 || u + v > 1) continue;
          hits[ii * GRID + kk].push(ay + u * uy + v * vy);
        }
      }
    }
    for (const h of hits) {
      h.sort((a, b) => a - b);
      if (h.length % 2) h.pop();
    }
    return { cols: hits, x0, z0, cw, cd, cen, ar };
  }

  // "Dividir en placas" con un archivo de varias piezas: si cada pieza cabe sola,
  // se reparten ENTERAS en las placas necesarias (sin cortes ni ensamble).
  function packedParts(s) {
    const m = state.model;
    if (m.multi || state.fit !== "dividir" || !m.pieces || m.pieces.length < 2) return null;
    const [bx, by, bz] = C.maquina.volumen_mm;
    const sz = m.size;
    if (sz.x * s <= bx && sz.z * s <= by && sz.y * s <= bz) return null; // cabe todo junto
    if (m.pieces.some((pc) => pc.dims[0] * s > bx || pc.dims[1] * s > by || pc.dims[2] * s > bz)) return null; // alguna hay que cortarla
    m.packCache = m.packCache || {};
    if (m.packCache[s]) return m.packCache[s];

    // acomodar en filas por cama (medidas ya escaladas), con 6 mm entre piezas
    const gap = 6;
    const order = m.pieces.map((pc, j) => j).sort((a, c) => m.pieces[c].dims[1] - m.pieces[a].dims[1]);
    const plates = [];
    const place = (pl, j) => {
      const w = m.pieces[j].dims[0] * s, d = m.pieces[j].dims[1] * s;
      for (const row of pl.rows) {
        if (row.x + w <= bx && d <= row.h) { pl.items.push({ j, x: row.x, z: row.z }); row.x += w + gap; return true; }
      }
      const last = pl.rows[pl.rows.length - 1];
      const z = last ? last.z + last.h + gap : 0;
      if (z + d > by) return false;
      pl.rows.push({ z, h: d, x: w + gap });
      pl.items.push({ j, x: 0, z });
      return true;
    };
    for (const j of order) {
      if (!plates.some((pl) => place(pl, j))) {
        const pl = { rows: [], items: [] };
        plates.push(pl);
        place(pl, j);
      }
    }
    if (plates.length < 2) return null;

    // una malla por placa (en unidades del modelo) con sus piezas
    const src = m.geo.attributes.position.array;
    const parts = plates.map((pl, i) => {
      const total = pl.items.reduce((n, it) => n + m.pieces[it.j].count * 9, 0);
      const out = new Float32Array(total);
      const pieces = [];
      let o = 0;
      for (const { j, x, z } of pl.items) {
        const pc = m.pieces[j];
        const dx = x / s - pc.minX, dz = z / s - pc.minZ, dy = -pc.minY;
        pieces.push({ name: pc.name, start: o / 9, count: pc.count });
        for (let k = pc.start * 9, end = (pc.start + pc.count) * 9; k < end; k += 3) {
          out[o++] = src[k] + dx;
          out[o++] = src[k + 1] + dy;
          out[o++] = src[k + 2] + dz;
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(out, 3));
      const pg = prepareGeometry(geo, false, pieces);
      return {
        vol: pg.volume, area: pg.area, minY: 0, h: pg.size.y, geo: pg.geo, label: i + 1, pieces: pg.pieces,
        b: { x0: -pg.size.x / 2, x1: pg.size.x / 2, y0: 0, y1: pg.size.y, z0: -pg.size.z / 2, z1: pg.size.z / 2 },
      };
    });
    parts.packed = true;
    return (m.packCache[s] = parts);
  }

  // Cuántas placas hacen falta en cada eje [x, alto, fondo]
  function splitCounts(s) {
    if (state.fit === "ajustar") return [1, 1, 1];
    const [bx, by, bz] = C.maquina.volumen_mm;
    const sz = state.model.size;
    const n = (len, max) => Math.max(1, Math.ceil(len / max - 1e-6));
    return [n(sz.x * s, bx), n(sz.y * s, bz), n(sz.z * s, by)];
  }

  // Volumen, superficie y altura de cada placa (en unidades del modelo, sin escalar)
  function computeParts(nx, ny, nz) {
    const m = state.model, sz = m.size;
    if (m.multi) {
      return m.plates.map((pl) => ({
        vol: pl.volume, area: pl.area, minY: 0, h: pl.size.y, geo: pl.geo, label: pl.id, pieces: pl.pieces,
        b: { x0: -pl.size.x / 2, x1: pl.size.x / 2, y0: 0, y1: pl.size.y, z0: -pl.size.z / 2, z1: pl.size.z / 2 },
      }));
    }
    const key = `${nx},${ny},${nz}`;
    if (m.partsCache[key]) return m.partsCache[key];
    if (nx * ny * nz === 1) {
      return (m.partsCache[key] = [{ vol: m.volume, area: m.area, minY: 0, h: sz.y, pieces: m.pieces,
        b: { x0: -sz.x / 2, x1: sz.x / 2, y0: 0, y1: sz.y, z0: -sz.z / 2, z1: sz.z / 2 } }]);
    }

    const A = m.columns;
    const px = sz.x / nx, py = sz.y / ny, pz = sz.z / nz;
    const clamp = (v, n) => Math.max(0, Math.min(n - 1, Math.floor(v)));
    const idx = (ix, iy, iz) => (iy * nx + ix) * nz + iz;
    const parts = [];
    for (let iy = 0; iy < ny; iy++)
      for (let ix = 0; ix < nx; ix++)
        for (let iz = 0; iz < nz; iz++)
          parts.push({ vol: 0, area: 0, minY: Infinity, maxY: -Infinity, b: {
            x0: A.x0 + ix * px, x1: A.x0 + (ix + 1) * px, y0: iy * py, y1: (iy + 1) * py,
            z0: A.z0 + iz * pz, z1: A.z0 + (iz + 1) * pz } });

    const cell = A.cw * A.cd;
    let colTotal = 0;
    // tramos de una columna repartidos entre las placas en altura
    const spread = (col, fn) => {
      for (let j = 0; j < col.length; j += 2) {
        const y0 = col[j], y1 = col[j + 1];
        for (let iy = clamp(y0 / py, ny); iy <= clamp(y1 / py, ny); iy++) {
          const lo = Math.max(y0, iy * py), hi = Math.min(y1, (iy + 1) * py);
          if (hi > lo) fn(iy, lo, hi);
        }
      }
    };

    for (let ci = 0; ci < GRID; ci++) {
      const ix = clamp((ci + 0.5) * A.cw / px, nx);
      for (let ck = 0; ck < GRID; ck++) {
        const col = A.cols[ci * GRID + ck];
        if (!col.length) continue;
        const iz = clamp((ck + 0.5) * A.cd / pz, nz);
        spread(col, (iy, lo, hi) => {
          const part = parts[idx(ix, iy, iz)];
          part.vol += (hi - lo) * cell;
          part.minY = Math.min(part.minY, lo);
          part.maxY = Math.max(part.maxY, hi);
          colTotal += (hi - lo) * cell;
        });
        // caras de corte horizontales
        for (let b = 1; b < ny; b++) {
          const yc = b * py;
          for (let j = 0; j < col.length; j += 2) {
            if (col[j] < yc && yc < col[j + 1]) {
              parts[idx(ix, b - 1, iz)].area += cell;
              parts[idx(ix, b, iz)].area += cell;
            }
          }
        }
      }
    }
    // caras de corte verticales (en X y en Z)
    for (let b = 1; b < nx; b++) {
      const ci = clamp((b * px) / A.cw, GRID);
      for (let ck = 0; ck < GRID; ck++) {
        const iz = clamp((ck + 0.5) * A.cd / pz, nz);
        spread(A.cols[ci * GRID + ck], (iy, lo, hi) => {
          parts[idx(b - 1, iy, iz)].area += (hi - lo) * A.cd;
          parts[idx(b, iy, iz)].area += (hi - lo) * A.cd;
        });
      }
    }
    for (let b = 1; b < nz; b++) {
      const ck = clamp((b * pz) / A.cd, GRID);
      for (let ci = 0; ci < GRID; ci++) {
        const ix = clamp((ci + 0.5) * A.cw / px, nx);
        spread(A.cols[ci * GRID + ck], (iy, lo, hi) => {
          parts[idx(ix, iy, b - 1)].area += (hi - lo) * A.cw;
          parts[idx(ix, iy, b)].area += (hi - lo) * A.cw;
        });
      }
    }
    // superficie del modelo: cada triángulo va a la placa de su centroide
    for (let t = 0; t < A.ar.length; t++) {
      const ix = clamp((A.cen[t * 3] - A.x0) / px, nx);
      const iy = clamp(A.cen[t * 3 + 1] / py, ny);
      const iz = clamp((A.cen[t * 3 + 2] - A.z0) / pz, nz);
      parts[idx(ix, iy, iz)].area += A.ar[t];
    }

    // corregir el error de la rejilla con el volumen exacto y descartar placas vacías
    const k = colTotal > 0 ? m.volume / colTotal : 1;
    const result = parts
      .filter((p) => p.vol > colTotal * 0.002)
      .map((p) => ({ vol: p.vol * k, area: p.area, minY: p.minY, h: p.maxY - p.minY, b: p.b }));
    return (m.partsCache[key] = result);
  }

  // Centra la malla sobre la cama (Y hacia arriba) y mide volumen, área y tamaño
  // (también de cada pieza, si el archivo trae varias)
  function prepareGeometry(geo, zUp, pieces) {
    if (geo.index) geo = geo.toNonIndexed();
    if (zUp) geo.rotateX(-Math.PI / 2); // STL y 3MF vienen con Z hacia arriba
    geo.computeVertexNormals();
    geo.computeBoundingBox();
    const bb = geo.boundingBox;
    const center = new THREE.Vector3();
    bb.getCenter(center);
    geo.translate(-center.x, -bb.min.y, -center.z);
    geo.computeBoundingBox();
    const size = new THREE.Vector3();
    geo.boundingBox.getSize(size);
    const total = geo.attributes.position.count / 3;
    const list = (pieces && pieces.length ? pieces : [{ name: "", start: 0, count: total }])
      .map((pc) => ({ ...pc, ...analyze(geo, pc.start, pc.count) }));
    geo.clearGroups();
    if (list.length > 1) list.forEach((pc, j) => geo.addGroup(pc.start * 3, pc.count * 3, j));
    return { geo, size, pieces: list, ...analyze(geo) };
  }

  function setModel(model) {
    if (viewer.mesh) {
      viewer.scene.remove(viewer.mesh);
      viewer.mesh.geometry.dispose();
    }
    const n = model.multi ? 1 : model.pieces.length;
    viewer.mesh = new THREE.Mesh(model.geo, n > 1 ? model.pieces.map(() => viewer.material.clone()) : viewer.material);
    viewer.scene.add(viewer.mesh);
    viewer.viewKey = null;
    state.model = model;
    state.pieceColors = {};
    state.led.metros = null;

    $("#dropzone").style.display = "none";
    $("#reset-btn").hidden = false;
    $("#file-name").textContent = model.name;

    // Si cabe, se limita el tamaño a la impresora; si no, se divide en placas a tamaño real
    state.scale = 100;
    setFit(model.multi || maxScale() >= 100 ? "ajustar" : "dividir");
  }

  function showModel(geo, name, zUp = true, pieces) {
    const m = prepareGeometry(geo, zUp, pieces);
    setModel({ name, ...m, columns: buildColumns(m.geo, m.size), partsCache: {} });
  }

  // Archivo que ya viene repartido en placas (proyecto de Bambu Studio): cada placa se cotiza aparte
  function showPlates(list, name, auto) {
    const plates = list.map(({ id, geo, pieces }) => ({ id, ...prepareGeometry(geo, true, pieces) }));
    const size = new THREE.Vector3();
    plates.forEach((pl) => size.max(pl.size));
    const total = (k) => plates.reduce((a, pl) => a + pl[k], 0);
    setModel({ name, multi: true, auto, plates, size, geo: plates[0].geo, volume: total("volume"), area: total("area"), partsCache: {} });
  }

  function setFit(mode) {
    state.fit = mode;
    const slider = $("#scale");
    slider.max = mode === "ajustar" ? maxScale() : 300;
    slider.min = Math.min(10, +slider.max);
    $("#fit-chips").hidden = maxScale() >= 300 || state.model.multi;
    $("#fit-chips").replaceChildren(
      chip(`Ajustar a la ${C.maquina.nombre}`, mode === "ajustar", () => setFit("ajustar")),
      chip("Dividir en placas", mode === "dividir", () => setFit("dividir"))
    );
    setScale(Math.min(state.scale, +slider.max));
    fitCamera();
  }

  function setScale(v) {
    state.scale = v;
    $("#scale").value = v;
    $("#scale-out").textContent = v + "%";
    if (state.led.on) renderLed();
    update();
  }

  function fitCamera() {
    const [bx, by, bz] = C.maquina.volumen_mm;
    if (viewer.layout) {
      const { w, d } = viewer.layout;
      const half = Math.max(w, d) / 2;
      const dist = (half / Math.tan(THREE.MathUtils.degToRad(viewer.camera.fov / 2))) * 1.25;
      viewer.camera.position.set(dist * 0.55, dist * 0.55, dist * 0.75);
      viewer.controls.target.set(0, bz * 0.3, 0);
      return;
    }
    const s = state.scale / 100;
    const h = state.model ? state.model.size.y * s : 0;
    const r = state.model ? Math.max(state.model.size.x, state.model.size.y, state.model.size.z) * s : 0;
    // pieza grande: se ve la impresora completa; pieza pequeña: la cámara se acerca para que
    // se lean sus medidas (con la rueda del mouse se puede alejar)
    const small = r && r < Math.max(bx, by) * 0.35;
    const dist = small ? Math.max(r * 6, 150) : Math.max(bx, by) * 2.5;
    viewer.camera.position.set(dist * 0.62, dist * 0.42 + (small ? h * 0.4 : 0), dist * 0.68);
    viewer.controls.target.set(0, small ? h * 0.45 : Math.max(h / 2, bz * 0.38), 0);
  }

  function textSprite(text, height = 30) {
    const font = "600 64px 'JetBrains Mono', monospace";
    const cv = document.createElement("canvas");
    const probe = cv.getContext("2d");
    probe.font = font;
    cv.width = Math.max(512, Math.ceil(probe.measureText(text).width) + 80);
    cv.height = 128;
    const g = cv.getContext("2d");
    g.fillStyle = "rgba(8,9,12,.85)";
    g.beginPath();
    g.roundRect(4, 4, cv.width - 8, 120, 28);
    g.fill();
    g.fillStyle = "#c6ff3d";
    g.font = font;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(text, cv.width / 2, 68);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), depthTest: false }));
    sp.scale.set(height * (cv.width / 128), height, 1);
    return sp;
  }

  // Cotas en cm (ancho, fondo y alto) alrededor de la pieza
  function renderDims(size, s) {
    if (viewer.dimGroup) {
      viewer.scene.remove(viewer.dimGroup);
      viewer.dimGroup.traverse((o) => {
        if (o.material) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); }
        if (o.geometry) o.geometry.dispose();
      });
      viewer.dimGroup = null;
    }
    if (!size) return;
    const w = size.x * s, d = size.z * s, h = size.y * s;
    const big = Math.max(w, d, h);
    const off = Math.max(4, big * 0.06);   // separación de la cota respecto a la pieza
    const tick = off * 0.5;
    const label = Math.min(26, Math.max(3, big * 0.11));
    const g = new THREE.Group();
    const pts = [];
    const seg = (a, b) => pts.push(...a, ...b);
    const x0 = -w / 2, x1 = w / 2, z0 = -d / 2, z1 = d / 2;
    // ancho: borde delantero sobre la cama
    seg([x0, 0, z1 + off], [x1, 0, z1 + off]);
    seg([x0, 0, z1 + off - tick], [x0, 0, z1 + off + tick]);
    seg([x1, 0, z1 + off - tick], [x1, 0, z1 + off + tick]);
    // fondo: borde derecho sobre la cama
    seg([x1 + off, 0, z0], [x1 + off, 0, z1]);
    seg([x1 + off - tick, 0, z0], [x1 + off + tick, 0, z0]);
    seg([x1 + off - tick, 0, z1], [x1 + off + tick, 0, z1]);
    // alto: esquina delantera derecha
    seg([x1 + off, 0, z1 + off], [x1 + off, h, z1 + off]);
    seg([x1 + off - tick, h, z1 + off], [x1 + off + tick, h, z1 + off]);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    g.add(new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: ACCENT, depthTest: false, transparent: true, opacity: 0.9 })));
    const put = (text, x, y, z) => {
      const sp = textSprite(text, label);
      sp.position.set(x, y, z);
      g.add(sp);
    };
    put(`${cm(w)} cm`, 0, label * 0.6, z1 + off + label * 0.6);
    put(`${cm(d)} cm`, x1 + off + label * 1.8, label * 0.6, 0);
    put(`${cm(h)} cm`, x1 + off, h + label * 0.9, z1 + off);
    g.renderOrder = 30;
    viewer.scene.add(g);
    viewer.dimGroup = g;
  }

  // Dibuja la pieza en la impresora, o cada placa sobre su propia cama si se dividió
  function renderView(parts, s) {
    const key = parts.length + "|" + s + "|" + state.fit + "|" + !!parts.packed;
    if (viewer.viewKey === key) return;
    viewer.viewKey = key;

    if (viewer.partsGroup) {
      viewer.scene.remove(viewer.partsGroup);
      viewer.partsGroup.traverse((o) => {
        if (o.material) [].concat(o.material).forEach((mt) => { if (mt.map) mt.map.dispose(); mt.dispose(); });
        if (o.geometry && !o.userData.shared) o.geometry.dispose();
      });
      viewer.partsGroup = null;
    }
    viewer.partMats = [];
    viewer.layout = null;
    const wasFocused = viewer.focus != null;
    viewer.focus = null;
    viewer.plateViews = [];

    const split = parts.length > 1;
    viewer.mesh.visible = !split;
    viewer.printer.group.visible = !split;
    renderDims(split ? null : state.model.size, s);
    if (!split) {
      viewer.mesh.scale.setScalar(s);
      // pieza pequeña: el cabezal se estaciona arriba para no tapar la vista de cerca
      const sz = state.model.size, [bx, , bz] = C.maquina.volumen_mm;
      const small = Math.max(sz.x, sz.y, sz.z) * s < bx * 0.35;
      viewer.printer.setHeight(small ? bz * 0.8 : sz.y * s);
      return;
    }

    const [bx, by] = C.maquina.volumen_mm;
    const gap = 70;
    const cols = Math.ceil(Math.sqrt(parts.length)), rows = Math.ceil(parts.length / cols);
    const group = new THREE.Group();
    const bedMat = new THREE.MeshStandardMaterial({ color: 0x24272e, roughness: 0.7, metalness: 0.3 });
    const e = 0.02;

    viewer.plateViews = [];
    parts.forEach((p, i) => {
      const ox = (i % cols - (cols - 1) / 2) * (bx + gap);
      const oz = (Math.floor(i / cols) - (rows - 1) / 2) * (by + gap);
      const sub = new THREE.Group();

      const bed = new THREE.Mesh(new THREE.BoxGeometry(bx + 8, 5, by + 8), bedMat);
      bed.position.set(ox, -2.5, oz);
      const grid = new THREE.GridHelper(bx, bx / 16, 0x4a505e, 0x2d313b);
      grid.position.set(ox, 0.2, oz);
      sub.add(bed, grid);

      const b = p.b;
      const w = (b.x1 - b.x0) * s, d = (b.z1 - b.z0) * s;
      const lift = p.minY * s;
      const top = b.y1 * s - lift;
      const planes = [
        new THREE.Plane(new THREE.Vector3(1, 0, 0), -(ox - w / 2) + e),
        new THREE.Plane(new THREE.Vector3(-1, 0, 0), ox + w / 2 + e),
        new THREE.Plane(new THREE.Vector3(0, 1, 0), -(b.y0 * s - lift) + e),
        new THREE.Plane(new THREE.Vector3(0, -1, 0), top + e),
        new THREE.Plane(new THREE.Vector3(0, 0, 1), -(oz - d / 2) + e),
        new THREE.Plane(new THREE.Vector3(0, 0, -1), oz + d / 2 + e),
      ];
      const nPieces = p.pieces && p.pieces.length > 1 ? p.pieces.length : 1;
      const fronts = Array.from({ length: nPieces }, () =>
        new THREE.MeshStandardMaterial({ color: viewer.material.color, roughness: 0.5, metalness: 0.05, clippingPlanes: planes }));
      // el interior que se ve por el corte se pinta de color acento: así se nota la cara de corte
      // solo las piezas cortadas muestran la cara de corte en verde; las enteras, su interior oscuro
      const isCut = !parts.packed && !state.model.multi;
      const backMat = new THREE.MeshBasicMaterial({ color: isCut ? ACCENT : 0x1b1d24, side: THREE.BackSide, clippingPlanes: planes });
      const front = nPieces > 1 ? fronts : fronts[0];
      const back = nPieces > 1 ? fronts.map(() => backMat) : backMat;
      viewer.partMats.push(fronts);
      const cx = ((b.x0 + b.x1) / 2) * s, cz = ((b.z0 + b.z1) / 2) * s;
      for (const mt of [front, back]) {
        const mesh = new THREE.Mesh(p.geo || state.model.geo, mt);
        mesh.userData.shared = true; // la malla del modelo no se libera al redibujar
        if (mt === front) Object.assign(mesh.userData, { part: i, planes });
        sub.add(mesh);
        mesh.scale.setScalar(s);
        mesh.position.set(ox - cx, -lift, oz - cz);
      }

      // en celular: etiqueta grande y corta (las medidas están en la lista de placas)
      const narrow = viewer.el.clientWidth < 520;
      const label = narrow
        ? textSprite(`PLACA ${p.label || i + 1}`, 64)
        : textSprite(`PLACA ${p.label || i + 1} · ${fmtDims([(b.x1 - b.x0) * s, (b.z1 - b.z0) * s, p.h * s])}`);
      label.position.set(ox, Math.max(top, 40) + 30, oz);
      sub.add(label);
      group.add(sub);
      viewer.plateViews.push({ sub, ox, oz, top, label });
    });

    viewer.scene.add(group);
    viewer.partsGroup = group;
    viewer.layout = { w: cols * (bx + gap), d: rows * (by + gap) };
    renderPlateNav();
    if (wasFocused) fitCamera();
  }

  // Colores del visor según el color de cada pieza
  function paintViews() {
    const cols = C.materiales[state.mat].colores;
    viewer.material.color.set(cols[state.color].hex);
    if (viewer.mesh && Array.isArray(viewer.mesh.material)) {
      viewer.mesh.material.forEach((mt, j) => mt.color.set(cols[colorOf(0, j)].hex));
    }
    (viewer.partMats || []).forEach((mats, i) => mats.forEach((mt, j) => mt.color.set(cols[colorOf(i, j)].hex)));
  }

  // Multicolor: clic (sin arrastrar) sobre una pieza la pinta con el color elegido
  function initPainting() {
    const ray = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    let down = null;
    const canvas = viewer.renderer.domElement;
    canvas.addEventListener("pointerdown", (e) => { down = [e.clientX, e.clientY]; });
    canvas.addEventListener("pointerup", (e) => {
      if (!down || state.acabado !== "multi" || !state.model) return;
      const moved = Math.hypot(e.clientX - down[0], e.clientY - down[1]);
      down = null;
      if (moved > 5) return; // fue un giro de cámara
      const rect = canvas.getBoundingClientRect();
      ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      ray.setFromCamera(ndc, viewer.camera);
      const targets = viewer.partsGroup
        ? (() => { const list = []; viewer.partsGroup.traverse((o) => o.userData.planes && o.parent.visible && list.push(o)); return list; })()
        : [viewer.mesh];
      // las placas comparten la malla: descartar choques en zonas recortadas o en otra placa
      const hit = ray.intersectObjects(targets, false).find((h) =>
        !h.object.userData.planes || h.object.userData.planes.every((pl) => pl.distanceToPoint(h.point) >= -0.05));
      if (!hit) return;
      const i = hit.object.userData.part || 0;
      const pieces = (state.lastParts[i] && state.lastParts[i].r.pieces) || [];
      const src = state.lastParts[i].pieces || [];
      let j = 0;
      if (src.length > 1) j = Math.max(0, src.findIndex((pc) => hit.faceIndex >= pc.start && hit.faceIndex < pc.start + pc.count));
      if (!pieces.length) return;
      state.pieceColors[`${i}:${j}`] = state.color;
      update();
    });
  }

  /* Ver todas las placas o una sola */
  function focusPlate(i) {
    const views = viewer.plateViews || [];
    viewer.focus = i == null || i < 0 || i >= views.length ? null : i;
    views.forEach((v, k) => { v.sub.visible = viewer.focus === null || k === viewer.focus; });
    if (viewer.focus === null) {
      fitCamera();
    } else {
      const v = views[viewer.focus];
      const dist = C.maquina.volumen_mm[0] * 1.7;
      viewer.camera.position.set(v.ox + dist * 0.6, dist * 0.6, v.oz + dist * 0.8);
      viewer.controls.target.set(v.ox, Math.min(v.top, 160) / 2, v.oz);
    }
    renderPlateNav();
    document.querySelectorAll("#plates .plate[data-focus]")
      .forEach((el) => el.classList.toggle("active", +el.dataset.focus === viewer.focus));
  }

  function renderPlateNav() {
    const views = viewer.plateViews || [];
    const nav = $("#plate-nav");
    nav.hidden = views.length < 2;
    if (nav.hidden) return;
    const btn = (label, i, title) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = label;
      b.title = title;
      b.className = viewer.focus === i ? "active" : "";
      b.onclick = () => focusPlate(i);
      return b;
    };
    const labels = state.lastParts || [];
    $("#pn-chips").replaceChildren(btn("Todas", null, "Ver todas las placas"),
      ...views.map((v, i) => btn(String((labels[i] && labels[i].label) || i + 1), i, `Ver solo la placa ${i + 1}`)));
  }

  // anterior/siguiente recorre: Todas → 1 → 2 → … → Todas
  function stepPlate(dir) {
    const n = (viewer.plateViews || []).length;
    if (!n) return;
    const order = [null, ...Array.from({ length: n }, (_, i) => i)];
    const at = order.indexOf(viewer.focus);
    focusPlate(order[(at + dir + order.length) % order.length]);
  }

  const contrast = (hex) => {
    const n = parseInt(hex.slice(1), 16);
    const l = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
    return l > 0.6 ? "#0a0b0f" : "#ffffff";
  };

  // Uno o varios archivos. Varios STL = un proyecto en piezas: se acomodan en las placas.
  function loadFiles(files) {
    if (!files.length) return;
    if (files.length === 1) return loadFile(files[0]);
    const stls = files.filter((f) => /\.stl$/i.test(f.name));
    if (stls.length !== files.length) {
      toast("Para cargar varios archivos a la vez deben ser STL. Cargamos solo el primero.");
      return loadFile(files[0]);
    }
    loadSTLs(stls);
  }

  function loadSTLs(files) {
    const total = files.reduce((a, f) => a + f.size, 0);
    const mb = (total / 1048576).toFixed(1);
    const sub = `${files.length} archivos STL · ${mb} MB`;
    let done = 0;
    showLoader("Leyendo archivos… 0%", 0, sub);
    Promise.all(files.map((f) => f.arrayBuffer().then((buf) => {
      done += f.size;
      showLoader(`Leyendo archivos… ${Math.round((done / total) * 100)}%`, done / total, sub);
      return { name: f.name, buf };
    }))).then((list) => {
      showLoader("Acomodando piezas en las placas…", null, sub);
      requestAnimationFrame(() => setTimeout(() => {
        try {
          const loader = new THREE.STLLoader();
          const items = list.map(({ name, buf }) => {
            let geo = loader.parse(buf);
            if (geo.index) geo = geo.toNonIndexed();
            return { name, pos: geo.attributes.position.array };
          });
          const [bx, by, bz] = C.maquina.volumen_mm;
          const tooBig = items.filter((it) => {
            let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
            for (let i = 0; i < it.pos.length; i += 3) {
              x0 = Math.min(x0, it.pos[i]); x1 = Math.max(x1, it.pos[i]);
              y0 = Math.min(y0, it.pos[i + 1]); y1 = Math.max(y1, it.pos[i + 1]);
              z0 = Math.min(z0, it.pos[i + 2]); z1 = Math.max(z1, it.pos[i + 2]);
            }
            return x1 - x0 > bx || y1 - y0 > by || z1 - z0 > bz;
          });
          if (tooBig.length) {
            hideLoader();
            showWarn(`${tooBig.map((t) => t.name).join(", ")} no ${tooBig.length === 1 ? "cabe" : "caben"} en la ${C.maquina.nombre}. Cárgalo solo para dividirlo en placas, o escríbenos.`);
            return;
          }
          const plates = packPieces(items, [bx, by, bz]).map((pl) => {
            const geo = new THREE.BufferGeometry();
            geo.setAttribute("position", new THREE.BufferAttribute(pl.positions, 3));
            return { id: pl.id, geo, pieces: pl.pieces };
          });
          finishLoad({ origen: "auto", plates }, projectName(files.map((f) => f.name)));
        } catch (e) {
          failLoad(e, "STL");
        }
      }, 30));
    }).catch((e) => failLoad(e, "STL"));
  }

  // "HHH-GAMER_v3_1_letras.stl", "HHH-GAMER_v3_2_tapa.stl"… → "HHH-GAMER_v3 (4 STL)"
  function projectName(names) {
    let pre = names[0];
    for (const n of names) while (!n.startsWith(pre)) pre = pre.slice(0, -1);
    pre = pre.replace(/[\s_\-.]+\d*$/, "").replace(/[\s_\-.]+$/, "");
    return `${pre || "Proyecto"} (${names.length} STL)`;
  }

  function loadFile(file) {
    if (!file) return;
    const ext = (file.name.match(/\.(stl|3mf)$/i) || [])[1];
    if (!ext) {
      showWarn("Solo se aceptan archivos .STL o .3MF");
      return;
    }
    const mb = file.size / 1048576;
    const sub = `${file.name} · ${mb < 1 ? Math.max(1, Math.round(file.size / 1024)) + " KB" : mb.toFixed(1) + " MB"}`;
    showLoader("Leyendo archivo…", 0, sub);
    const reader = new FileReader();
    reader.onprogress = (e) => {
      if (e.lengthComputable) showLoader(`Leyendo archivo… ${Math.round((e.loaded / e.total) * 100)}%`, e.loaded / e.total, sub);
    };
    reader.onerror = () => {
      hideLoader();
      showWarn("No se pudo leer el archivo.");
    };
    reader.onload = () => {
      if (ext.toLowerCase() === "3mf") {
        read3MF(reader.result, sub)
          .then((res) => finishLoad(res, file.name))
          .catch((e) => failLoad(e, ext));
        return;
      }
      // el STL se analiza en la página: primero se pinta el aviso y luego se procesa
      showLoader("Procesando modelo 3D…", null, sub);
      requestAnimationFrame(() => setTimeout(() => {
        try {
          const geo = new THREE.STLLoader().parse(reader.result);
          finishLoad({ origen: "archivo", plates: [{ id: 1, geo }] }, file.name);
        } catch (e) {
          failLoad(e, ext);
        }
      }, 30));
    };
    reader.readAsArrayBuffer(file);
  }

  // 3MF en segundo plano (worker3mf.js) con progreso real; si el navegador no permite
  // workers (p. ej. abriendo index.html con doble clic) se lee en la misma página
  function read3MF(buffer, sub) {
    const bed = C.maquina.volumen_mm;
    const toGeos = (res) => ({
      origen: res.origen,
      plates: res.plates.map((pl) => {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute("position", new THREE.BufferAttribute(pl.positions, 3));
        return { id: pl.id, geo, pieces: pl.pieces };
      }),
    });
    const progress = (stage, p) => showLoader(p >= 1 || p == null ? stage : `${stage} ${Math.round(p * 100)}%`, p, sub);
    const inPage = () => new Promise((resolve, reject) => {
      showLoader("Procesando 3MF…", null, sub);
      setTimeout(() => {
        try { resolve(toGeos(parse3MFBuffer(buffer, bed, progress))); } catch (e) { reject(e); }
      }, 30);
    });
    let worker;
    try {
      worker = new Worker("worker3mf.js?v=1");
    } catch (e) {
      return inPage();
    }
    return new Promise((resolve, reject) => {
      worker.onmessage = (e) => {
        const m = e.data;
        if (m.type === "progress") progress(m.stage, m.p);
        else {
          worker.terminate();
          if (m.type === "done") resolve(toGeos(m.res));
          else reject(new Error(m.message));
        }
      };
      worker.onerror = (e) => {
        e.preventDefault();
        worker.terminate();
        inPage().then(resolve, reject);
      };
      worker.postMessage({ buffer, bed }, [buffer]);
    });
  }

  function finishLoad(res, name) {
    try {
      const list = res.plates;
      if (!list[0].geo.attributes.position.count) throw new Error("vacío");
      showLoader("Calculando volumen y costos…", null);
      requestAnimationFrame(() => setTimeout(() => {
        try {
          if (list.length === 1) showModel(list[0].geo, name, true, list[0].pieces);
          else showPlates(list, name, res.origen === "auto");
        } catch (e) {
          failLoad(e, name.split(".").pop());
          return;
        }
        hideLoader();
      }, 30));
    } catch (e) {
      failLoad(e, name.split(".").pop());
    }
  }

  function failLoad(e, ext) {
    console.error(e);
    hideLoader();
    showWarn(`No se pudo leer el archivo. Verifica que sea un ${String(ext).toUpperCase()} válido.`);
  }

  // progreso: número de 0 a 1, o null para una barra indeterminada
  function showLoader(text, progress, sub) {
    $("#loader").hidden = false;
    $("#loader-text").textContent = text;
    if (sub !== undefined) $("#loader-sub").textContent = sub;
    const bar = $("#loader-bar");
    bar.parentElement.classList.toggle("indeterminate", progress === null);
    bar.style.width = progress === null ? "" : `${Math.round(progress * 100)}%`;
  }

  function hideLoader() {
    $("#loader").hidden = true;
  }

  function showWarn(msg) {
    const w = $("#warn");
    w.textContent = msg || "";
    w.hidden = !msg;
  }

  /* ---------------- cálculo ---------------- */
  // Una placa: vol (mm³), area (mm²) y h (mm) ya escalados
  // Una placa con sus piezas (cada una puede ir en otro color). Valores ya escalados.
  function calcPart(pieces, h) {
    const mat = C.materiales[state.mat];
    const P = C.impresion, K = C.costos, M = C.multicolor;
    const noz = nozzle(), capa = layerHeight(), lw = noz.d * 1.05;
    const sup = state.supports ? 1 + P.recargo_soportes : 1;

    let printed = 0, filamento = 0, grams = 0, interior = 0, volumen = 0;
    for (const pc of pieces) {
      pc.color = mat.colores[pc.colorIdx] || mat.colores[0];
      const shell = Math.min(pc.vol, pc.area * P.perimetros * lw);
      const pr = (shell + (pc.vol - shell) * (state.infill / 100)) * sup;
      interior += pc.vol - shell; // lo único que cambia con el relleno
      volumen += pc.vol;
      pc.grams = (pr / 1000) * mat.densidad;
      printed += pr;
      grams += pc.grams;
      filamento += (pc.grams / 1000) * priceKg(state.mat) * (1 + pc.color.recargo);
    }

    // varios colores en la misma placa: en cada capa donde conviven, el AMS cambia de filamento
    const colors = [...new Set(pieces.map((pc) => pc.colorIdx))];
    let cambios = 0;
    if (colors.length > 1 && M.ams) {
      const ranges = colors.map((c) => {
        const own = pieces.filter((pc) => pc.colorIdx === c);
        return [Math.min(...own.map((pc) => pc.minY)), Math.max(...own.map((pc) => pc.maxY))];
      });
      for (let l = 0, L = Math.ceil(h / capa); l < L; l++) {
        const z = (l + 0.5) * capa;
        const k = ranges.filter(([lo, hi]) => z >= lo && z <= hi).length;
        if (k > 1) cambios += k - 1;
      }
    }
    const purgaG = cambios * M.purga_g_por_cambio;
    // color con el que arranca la placa (pieza más baja) y con el que termina (pieza más alta)
    const first = pieces.reduce((a, pc) => (pc.minY < a.minY ? pc : a), pieces[0]).colorIdx;
    const last = pieces.reduce((a, pc) => (pc.maxY > a.maxY ? pc : a), pieces[0]).colorIdx;

    const meters = (grams / mat.densidad) * 1000 / FIL_AREA / 1000;
    const flow = Math.min(capa * lw * noz.velocidad, P.flujo_max_mm3_s) * P.eficiencia; // mm³/s
    const layers = h / capa;
    const hours = (printed / flow + layers * P.seg_por_capa) / 3600;
    const color = mat.colores[pieces[0].colorIdx] || mat.colores[0];
    const kwh = hours * (C.energia.potencia_w / 1000);
    const energia = kwh * C.energia.precio_kwh;
    const maquina = hours * machineHour();
    // mano de obra de esta placa: preparar la impresión y, si aplica, quitar soportes.
    // Sin AMS, cada color extra es otra tanda de impresión que hay que preparar.
    const tandas = M.ams ? 1 : colors.length;
    const minutos = K.min_preparacion * tandas + (state.supports ? K.min_soportes : 0);
    const manoObra = (minutos / 60) * K.mano_obra_hora;
    const riesgo = (filamento + energia + maquina) * K.margen_fallos;
    const costo = filamento + energia + maquina + manoObra + riesgo;
    const margen = costo * K.margen_ganancia;
    return { grams, meters, hours, layers, kwh, minutos, filamento, energia, maquina, manoObra, riesgo, margen,
      precio: costo + margen, color, colors: colors.length, cambios, purgaG, first, last, pieces, interior, volumen };
  }

  const machineHour = () => C.maquina.costo / C.maquina.vida_util_horas + C.maquina.mantenimiento_hora;
  // color de la pieza j de la placa i (en "Multicolor"; si no, el color general)
  const colorOf = (i, j) => {
    if (state.acabado !== "multi") return state.color;
    const c = state.pieceColors[`${i}:${j}`];
    return c != null ? c : state.baseColor; // sin pintar: el color que había al activar multicolor
  };
  const plateColor = (i) => colorOf(i, 0);

  function calculate() {
    const s = state.scale / 100, q = state.qty, K = C.costos, A = C.acabados;
    const hourCost = (min) => (min / 60) * K.mano_obra_hora;
    const base = packedParts(s) || computeParts(...splitCounts(s));
    const parts = base.map((p, i) => {
      const src = p.pieces && p.pieces.length ? p.pieces : [{ name: "", volume: p.vol, area: p.area, minY: p.minY, maxY: p.minY + p.h }];
      const pieces = src.map((pc, j) => ({
        name: pc.name, colorIdx: colorOf(i, j), dims: (pc.dims || [0, 0, 0]).map((v) => v * s),
        vol: pc.volume * s ** 3, area: pc.area * s ** 2, minY: (pc.minY - p.minY) * s, maxY: (pc.maxY - p.minY) * s,
      }));
      return { ...p, colorIdx: plateColor(i), r: calcPart(pieces, p.h * s) };
    });
    for (const p of parts) p.precio = roundTo(p.r.precio * q, K.redondeo);

    // trabajos de todo el pedido (cada uno con su costo y su margen)
    const extras = [];
    // margenInsumos: margen distinto para materiales comprados (p. ej. LED); el trabajo usa el del taller
    const addExtra = (key, label, minutos, insumos, margenInsumos = K.margen_ganancia) => {
      const costo = hourCost(minutos) + insumos;
      const margen = hourCost(minutos) * K.margen_ganancia + insumos * margenInsumos;
      extras.push({ key, label, minutos, insumos, costo, margen, precio: roundTo(costo + margen, K.redondeo) });
    };
    // ensamble solo cuando nosotros cortamos la pieza (las placas del archivo no se pegan)
    const packed = !!base.packed;
    parts.packed = packed; // el visor lo usa para no pintar caras de corte
    const uniones = state.model.multi || packed ? 0 : parts.length - 1;
    if (uniones) addExtra("ensamble", `Ensamble: ${uniones} ${uniones === 1 ? "unión" : "uniones"} (pegado y lijado)`, uniones * K.min_ensamble * q, uniones * K.insumos_ensamble * q);
    // cambios de color: dentro de cada placa (AMS) y entre placas que arrancan con otro filamento
    const M = C.multicolor;
    const coloresUsados = new Set(parts.flatMap((p) => p.r.pieces.map((pc) => pc.colorIdx))).size;
    const dentro = parts.reduce((a, p) => a + p.r.cambios, 0) * q;
    let entre = 0;
    if (state.acabado === "multi") for (let i = 1; i < parts.length; i++) if (parts[i].r.first !== parts[i - 1].r.last) entre++;
    entre *= q;
    const cambiosColor = dentro + entre;
    const purgaG = cambiosColor * M.purga_g_por_cambio;
    const horasCambio = (cambiosColor * M.seg_por_cambio) / 3600;
    if (state.acabado === "multi" && (cambiosColor || coloresUsados > 1)) {
      const maquinaLuz = horasCambio * (machineHour() + (C.energia.potencia_w / 1000) * C.energia.precio_kwh);
      const purga = (purgaG / 1000) * priceKg(state.mat);
      // tu tiempo: preparar cada carrete extra y, sin AMS, cambiar el filamento a mano entre placas
      const minutos = Math.max(0, coloresUsados - 1) * M.min_por_color_extra + (M.ams ? 0 : entre * A.min_cambio_filamento);
      addExtra("color",
        `Cambios de color: ${cambiosColor} (${dentro} dentro de placas, ${entre} entre placas) · purga ${fmtG(purgaG)} · ${Math.round(horasCambio * 60)} min de máquina · ${coloresUsados} colores`,
        minutos, purga + maquinaLuz);
    }
    // pintura a mano según la superficie de la pieza
    const cm2 = parts.reduce((a, p) => a + p.area * s ** 2, 0) / 100;
    if (state.acabado === "pintado") {
      const n = A.pintura[state.pintura];
      addExtra("pintura", `Pintura a mano ${n.nombre.toLowerCase()}: ${Math.round(cm2 * q)} cm²`,
        (cm2 / 100) * n.min_por_100cm2 * q, (cm2 / 100) * n.insumos_por_100cm2 * q);
    }

    // letrero con iluminación LED: materiales + instalación
    if (state.led.on) {
      const L = C.led, tipo = L.tipos.find((t) => t.id === state.led.tipo) || L.tipos[0];
      const m = ledMeters();
      const materiales = (m * tipo.precio_m + L.fuente + L.cable_conectores + tipo.extra) * q;
      const minutos = (L.min_instalacion + m * L.min_por_metro) * q;
      addExtra("led", `Iluminación LED ${tipo.nombre}: ${m.toLocaleString("es-CO")} m + fuente + instalación`, minutos, materiales, L.margen);
    }

    const sum = (f) => parts.reduce((a, p) => a + f(p), 0);
    const bruto = sum((p) => p.precio) + extras.reduce((a, e) => a + e.precio, 0);
    const total = Math.max(bruto, roundTo(K.pedido_minimo, K.redondeo));

    const mat = C.materiales[state.mat], color = mat.colores[state.color];
    const t = (k) => sum((p) => p.r[k]) * q;
    const grams = sum((p) => p.r.grams), hours = sum((p) => p.r.hours);
    const exMin = extras.reduce((a, e) => a + e.minutos, 0);
    const exIns = extras.reduce((a, e) => a + e.insumos, 0);
    const manoObra = t("manoObra") + hourCost(exMin);
    const margen = t("margen") + extras.reduce((a, e) => a + e.margen, 0);
    const exactos = t("filamento") + t("energia") + t("maquina") + manoObra + exIns + t("riesgo") + margen;
    const pct = (x) => `${Math.round(x * 100)}%`;
    const colorTxt = coloresUsados > 1 ? ` · ${coloresUsados} colores` : color.recargo ? ` (+${pct(color.recargo)} color)` : "";
    return {
      parts, extras, uniones, packed, total, s, cm2, minimo: total - bruto, colores: coloresUsados,
      cambiosColor, purgaG, horasCambio,
      grams, meters: sum((p) => p.r.meters), hours: hours + horasCambio / q, layers: sum((p) => p.r.layers),
      lines: [
        [`Filamento ${mat.nombre} · ${fmtG(grams * q)} a ${cop(priceKg(state.mat))}/kg${colorTxt}`, t("filamento")],
        [`Energía · ${t("kwh").toFixed(2)} kWh a ${cop(C.energia.precio_kwh)}/kWh`, t("energia")],
        [`Máquina (desgaste y mantenimiento) · ${fmtTime(hours * q)} a ${cop(machineHour())}/h`, t("maquina")],
        [`Mano de obra · ${Math.round(t("minutos") + exMin)} min a ${cop(K.mano_obra_hora)}/h`, manoObra],
        ...(exIns ? [["Insumos (LED, pegamento, pintura, purga y máquina en cambios de color)", exIns]] : []),
        [`Reserva por impresiones fallidas · ${pct(K.margen_fallos)}`, t("riesgo")],
        [`Margen del taller · ${pct(K.margen_ganancia)}${state.led.on ? ` (materiales LED ${pct(C.led.margen)})` : ""}`, margen],
        [total > bruto ? "Ajuste a pedido mínimo y redondeo" : "Redondeo", total - exactos],
      ],
    };
  }

  const fmtTime = (h) => {
    const t = Math.max(1, Math.round(h * 60));
    return t < 60 ? `${t} min` : `${Math.floor(t / 60)} h ${String(t % 60).padStart(2, "0")} min`;
  };
  const fmtG = (g) => `${g.toFixed(g < 10 ? 1 : 0)} g`;

  function renderBadge(r) {
    const [vx, vy, vz] = C.maquina.volumen_mm;
    let status = "";
    if (r && r.packed) status = `<span class="split">▦ Piezas repartidas en ${r.parts.length} placas</span>`;
    else if (r && state.model.multi) status = `<span class="split">▦ ${state.model.auto ? "Organizado en" : "Archivo con"} ${r.parts.length} placas</span>`;
    else if (r && r.parts.length > 1) status = `<span class="split">✂ Dividido en ${r.parts.length} placas</span>`;
    else if (r) status = `<span class="ok">✓ Cabe en la impresora</span>`;
    $("#badge").innerHTML =
      `<b>${C.maquina.nombre.toUpperCase()}</b>` +
      `<span>Boquilla Ø${state.nozzle} mm · capa ${layerHeight()} mm</span>` +
      `<span>Área ${vx}×${vy}×${vz} mm · ${C.maquina.temp_max_boquilla} °C</span>` + status;
  }

  function update() {
    paintViews();
    $("#nozzle-name").textContent = `Ø ${state.nozzle} mm`;
    const res = $("#result");
    if (!state.model) {
      renderBadge(null);
      res.classList.add("empty");
      $("#wa-btn").removeAttribute("href");
      return;
    }
    res.classList.remove("empty");
    const r = calculate();
    state.lastParts = r.parts;
    const s = r.s, sz = state.model.size, q = state.qty;
    const split = r.parts.length > 1;
    renderView(r.parts, s);
    if (split !== !!viewer.wasSplit) fitCamera();
    viewer.wasSplit = split;
    renderBadge(r);

    const dims = [sz.x * s, sz.z * s, sz.y * s];
    $("#dims").textContent = (state.model.multi ? `${r.parts.length} placas · hasta ` : "") +
      `${fmtDims(dims)} (${dims.map((d) => Math.round(d)).join(" × ")} mm)`;
    $("#dims").title = "Ancho × fondo × alto";

    const [vx, vy, vz] = C.maquina.volumen_mm;
    if (state.fit === "ajustar" && maxScale() < 100) {
      showWarn(`Tu modelo es más grande que la ${C.maquina.nombre} (${vx}×${vy}×${vz} mm), así que lo ajustamos al ${maxScale()}%. Para tenerlo a tamaño real elige "Dividir en placas".`);
    } else if (state.model.multi) {
      showWarn(state.model.auto
        ? `Acomodamos tus piezas enteras (sin cortarlas) en ${r.parts.length} placas de la ${C.maquina.nombre}.`
        : `Tu archivo ya viene en ${r.parts.length} placas: cada una se imprime por separado y aquí ves el precio de cada una.`);
    } else if (r.packed) {
      showWarn(`Tus ${state.model.pieces.length} piezas no caben juntas en la ${C.maquina.nombre}: las repartimos enteras, sin cortarlas, en ${r.parts.length} placas.`);
    } else if (split) {
      showWarn(`A este tamaño no cabe en la ${C.maquina.nombre}: se imprime en ${r.parts.length} placas que luego se pegan. Las caras verdes son los cortes.`);
    } else if (state.model.volume < 1) {
      showWarn("El modelo parece no estar cerrado; el cálculo puede ser inexacto.");
    } else showWarn("");

    // piezas de pared delgada (lámparas, cáscaras): casi todo es pared sólida
    const interior = r.parts.reduce((a, p) => a + p.r.interior, 0), volumen = r.parts.reduce((a, p) => a + p.r.volumen, 0);
    const thin = volumen > 0 && interior / volumen < 0.1;
    $("#infill-hint").hidden = !thin;
    if (thin) $("#infill-hint").textContent = `Esta pieza es de pared delgada: el ${Math.round((1 - interior / volumen) * 100)} % del material es pared sólida, así que el relleno casi no cambia su precio.`;
    $("#r-weight").textContent = fmtG(r.grams * q);
    $("#r-time").textContent = fmtTime(r.hours * q);
    $("#r-length").textContent = `${(r.meters * q).toFixed(1)} m`;
    $("#r-total").textContent = money(r.total);
    const usd = (r.total / state.trm).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const fecha = state.trmFecha ? ` del ${state.trmFecha}` : "";
    const trmTxt = TALLER ? ` · TRM ${cop(state.trm)}${fecha}` : "";
    $("#r-fx").textContent = state.currency === "USD" ? `≈ ${cop(r.total)} COP${trmTxt}` : `≈ US$ ${usd}${trmTxt}`;
    let unit = `${Math.round(r.layers)} capas de ${layerHeight()} mm`;
    if (split) unit = r.uniones ? `${r.parts.length} placas + ${r.uniones} ${r.uniones === 1 ? "unión" : "uniones"}` : `${r.parts.length} placas`;
    if (q > 1) unit = `${money(r.total / q)} c/u · ${q} unidades`;
    $("#r-unit").textContent = unit;
    const li = ([k, v], cls = "") => `<li class="${cls}"><span>${k}</span><span>${money(v)}</span></li>`;
    const costLines = r.lines.filter(([k]) => !/^Margen|^Redondeo|^Ajuste/.test(k));
    const margen = r.lines.find(([k]) => /^Margen/.test(k));
    const ajuste = r.lines.find(([k]) => /^Redondeo|^Ajuste/.test(k));
    const costo = costLines.reduce((a, [, v]) => a + v, 0);
    $("#r-breakdown").innerHTML = costLines.map((l) => li(l)).join("") +
      li(["= Costo de producción", costo], "sum") +
      li([`+ ${margen[0]}`, margen[1]], "margin") +
      (Math.abs(ajuste[1]) >= 1 ? li([`+ ${ajuste[0]}`, ajuste[1]]) : "") +
      li(["= Precio al cliente", r.total], "sum total") +
      `<li class="meta"><span>TRM usada · luz estrato ${C.energia.estrato || ""}</span><span>${cop(state.trm)} · ${cop(C.energia.precio_kwh)}/kWh</span></li>`;

    const multi = state.acabado === "multi";
    const mode = $("#r-mode");
    mode.textContent = r.colores > 1 ? `multicolor · ${r.colores} colores` : state.acabado === "pintado" ? "un color + pintado a mano" : "un solo color";
    mode.className = "mode-tag" + (r.colores > 1 ? " multi" : "");
    $("#paint-hint").hidden = !multi;
    viewer.el.classList.toggle("painting", multi);

    const plates = $("#plates");
    const hasPieces = r.parts.some((p) => p.r.pieces.length > 1);
    const showList = split || r.extras.length > 0 || (multi && (hasPieces || split));
    plates.hidden = !showList;
    if (showList) {
      const cols = C.materiales[state.mat].colores;
      const options = (sel) => cols.map((c, k) =>
        `<option value="${k}" ${k === sel ? "selected" : ""}>${c.nombre}${c.recargo ? ` (+${Math.round(c.recargo * 100)}%)` : ""}</option>`).join("");
      // en multicolor: un selector por pieza (si la placa tiene una sola, va en la fila de la placa)
      const picker = (i, p) => !multi || p.r.pieces.length > 1 ? "" : `
          <select class="piece-color" data-key="${i}:0" aria-label="Color de la placa ${p.label || i + 1}">${options(p.r.pieces[0].colorIdx)}</select>`;
      const piecesBlock = (i, p) => !multi || p.r.pieces.length < 2 ? "" : `
        <div class="pieces">
          ${p.r.pieces.map((pc, j) => `
          <label class="piece">
            <span class="dot" style="background:${pc.color.hex}"></span>
            <span class="pname" title="${pc.name} · ancho × fondo × alto">${pc.name || `Pieza ${j + 1}`} · ${fmtDims(pc.dims)} · ${fmtG(pc.grams * q)}</span>
            <select class="piece-color" data-key="${i}:${j}" aria-label="Color de ${pc.name || `la pieza ${j + 1}`}">${options(pc.colorIdx)}</select>
          </label>`).join("")}
        </div>`;
      const colorInfo = (p) => p.r.cambios ? ` · ${p.r.colors} colores, ${p.r.cambios} cambios (purga ${fmtG(p.r.purgaG * q)})` : "";
      const rows = split ? r.parts.map((p, i) => `
        <div class="plate${viewer.focus === i ? " active" : ""}" data-focus="${i}">
          <i style="${multi && p.r.colors === 1 ? `background:${p.r.color.hex};color:${contrast(p.r.color.hex)}` : ""}">${p.label || i + 1}</i>
          <div><span>${fmtDims([(p.b.x1 - p.b.x0) * s, (p.b.z1 - p.b.z0) * s, p.h * s])} · ${fmtG(p.r.grams * q)} · ${fmtTime(p.r.hours * q)} · ${Math.round(p.r.layers)} capas${colorInfo(p)}</span>
            <small class="pcost taller-only">Filamento ${money(p.r.filamento * q)} · Luz ${money(p.r.energia * q)} · Máquina ${money(p.r.maquina * q)} · Mano de obra ${money(p.r.manoObra * q)} · Reserva ${money(p.r.riesgo * q)} · Margen ${money(p.r.margen * q)}</small>${picker(i, p)}</div>
          <b>${money(p.precio)}</b></div>${piecesBlock(i, p)}`).join("")
        : piecesBlock(0, r.parts[0]).replace('<div class="pieces">', `<div class="pieces"><h5>Color de cada pieza${colorInfo(r.parts[0])}</h5>`);
      const extras = r.extras.map((e) => `
        <div class="plate extra ${e.key}"><i>${{ color: "◐", led: "💡" }[e.key] || "+"}</i><div><span>${e.label}</span></div><b>${money(e.precio)}</b></div>`).join("");
      const minimo = r.minimo > 0 ? `
        <div class="plate extra"><i>$</i><div><span>Ajuste a pedido mínimo</span></div><b>${money(r.minimo)}</b></div>` : "";
      plates.innerHTML = `<h4>${split ? "Precio por placa" : multi ? "Multicolor" : "Servicios adicionales"}</h4>` + rows + extras + minimo;
    }

    const mat = C.materiales[state.mat];
    const lines = [
      `Hola ${C.negocio.nombre}! Quiero cotizar esta impresión:`,
      `• Archivo: ${state.model.name}`,
      `• Material: ${mat.nombre} – ${r.colores > 1 ? `multicolor (${r.colores} colores)` : mat.colores[state.color].nombre}` +
        (state.acabado === "pintado" ? ` · pintado a mano (${C.acabados.pintura[state.pintura].nombre.toLowerCase()})` : ""),
      `• Boquilla ${state.nozzle} mm · Calidad ${C.calidades[state.calidad]} (${layerHeight()} mm) · Relleno ${state.infill}% · Escala ${state.scale}%`,
      `• Medidas: ${$("#dims").textContent}`,
      `• Soportes: ${state.supports ? "sí" : "no"} · Cantidad: ${q}`,
    ];
    if (state.led.on) {
      const tipo = C.led.tipos.find((t) => t.id === state.led.tipo);
      lines.push(`• Letrero con LED ${tipo.nombre}: ${ledMeters().toLocaleString("es-CO")} m de tira, fuente e instalación`);
    }
    if (split) {
      r.parts.forEach((p, i) => lines.push(`   – Placa ${p.label || i + 1}: ${fmtG(p.r.grams * q)}, ${fmtTime(p.r.hours * q)}` +
        (r.colores > 1 ? `, ${[...new Set(p.r.pieces.map((pc) => pc.color.nombre))].join("/")}` : "") + `, ${cop(p.precio)}`));
    }
    if (r.colores > 1) {
      r.parts.forEach((p) => p.r.pieces.length > 1 && p.r.pieces.forEach((pc) => lines.push(`      · ${pc.name}: ${pc.color.nombre}`)));
    }
    r.extras.forEach((e) => lines.push(`   – ${e.label}: ${cop(e.precio)}`));
    lines.push(`• Estimado web: ${cop(r.total)}${state.currency === "USD" ? ` (≈ ${money(r.total)})` : ""} (${fmtTime(r.hours * q)})`,
      `Adjunto la ficha con la imagen de cada placa. Te envío el archivo ${state.model.name.split(".").pop().toUpperCase()} por aquí.`);
    state.lastQuote = r;
    state.waText = lines.join("\n");
    $("#wa-btn").href = `https://wa.me/${C.negocio.whatsapp}?text=${encodeURIComponent(state.waText)}`;
  }

  /* ---------------- controles del formulario ---------------- */
  function chip(label, active, onClick) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "chip" + (active ? " active" : "");
    b.textContent = label;
    b.onclick = onClick;
    return b;
  }

  function renderMaterials() {
    const box = $("#mat-chips");
    box.replaceChildren(...Object.entries(C.materiales).map(([k, m]) =>
      chip(m.nombre, k === state.mat, () => { state.mat = k; state.color = 0; state.pieceColors = {}; renderMaterials(); update(); })
    ));
    $("#mat-desc").textContent = C.materiales[state.mat].desc;
    renderSwatches();
  }

  function renderSwatches() {
    const cols = C.materiales[state.mat].colores;
    $("#swatches").replaceChildren(...cols.map((c, i) => {
      const s = document.createElement("button");
      s.type = "button";
      s.className = "swatch" + (i === state.color ? " active" : "");
      s.style.background = c.hex;
      s.title = c.nombre + (c.recargo ? ` (+${Math.round(c.recargo * 100)}%)` : "");
      if (c.recargo) s.dataset.extra = "";
      s.onclick = () => { state.color = i; renderSwatches(); update(); };
      return s;
    }));
    const c = cols[state.color];
    $("#color-name").textContent = c.nombre + (c.recargo ? ` · +${Math.round(c.recargo * 100)}%` : "");
  }

  const FINISH = { uno: "Un color", multi: "Multicolor (por pieza)", pintado: "Pintado a mano" };
  function renderFinish() {
    $("#finish-chips").replaceChildren(...Object.entries(FINISH).map(([k, label]) =>
      chip(label, k === state.acabado, () => {
        // al pasar a multicolor, la paleta se vuelve pincel y las piezas conservan su color
        if (k === "multi" && state.acabado !== "multi") state.baseColor = state.color;
        state.acabado = k;
        renderFinish();
        update();
      })
    ));
    const pc = $("#paint-chips");
    pc.hidden = state.acabado !== "pintado";
    pc.replaceChildren(...Object.entries(C.acabados.pintura).map(([k, n]) =>
      chip(n.nombre, k === state.pintura, () => { state.pintura = k; renderFinish(); update(); })
    ));
    const desc = {
      uno: "Toda la pieza en el color elegido arriba, sin pintar.",
      multi: C.multicolor.ams
        ? `Cada pieza en su filamento. Elige un color arriba y toca la pieza en el visor, o usa la lista. Varios colores en la misma placa usan el AMS lite (máx. ${C.multicolor.max_colores}): cada cambio suma purga y tiempo.`
        : "Cada pieza en su filamento. Sin AMS, cada color de una placa se imprime en una tanda aparte.",
      pintado: `${C.acabados.pintura[state.pintura].desc}. Se cobra según la superficie de la pieza; te recomendamos imprimir en blanco o gris.`,
    };
    $("#finish-desc").textContent = desc[state.acabado];
  }

  // metros de tira sugeridos: contorno de la pieza (ancho y fondo), redondeado a medio metro
  function suggestedMeters() {
    if (!state.model) return 1;
    const s = state.scale / 100, sz = state.model.size;
    return Math.max(0.5, Math.ceil(((2 * (sz.x + sz.z) * s) / 1000) * 2) / 2);
  }
  const ledMeters = () => state.led.metros ?? suggestedMeters();

  function renderLed() {
    $("#led-on").checked = state.led.on;
    $("#led-box").hidden = !state.led.on;
    $("#led-chips").replaceChildren(...C.led.tipos.map((t) =>
      chip(t.nombre, t.id === state.led.tipo, () => { state.led.tipo = t.id; renderLed(); update(); })
    ));
    $("#led-m").value = ledMeters();
    const tipo = C.led.tipos.find((t) => t.id === state.led.tipo);
    $("#led-hint").textContent = `${tipo.desc}. ` + (state.led.metros == null
      ? `Sugerimos ${suggestedMeters().toLocaleString("es-CO")} m según el contorno de tu pieza; ajústalo si lo necesitas.`
      : `Sugerido para tu pieza: ${suggestedMeters().toLocaleString("es-CO")} m.`) + " Incluye fuente, cableado e instalación.";
  }

  function renderQualities() {
    $("#q-chips").replaceChildren(...C.calidades.map((nombre, i) =>
      chip(`${nombre} · ${nozzle().capas[i]}`, i === state.calidad, () => { state.calidad = i; renderQualities(); update(); })
    ));
  }

  function renderNozzles() {
    $("#n-chips").replaceChildren(...C.boquillas.map((b) =>
      chip(`${b.d} mm`, b.d === state.nozzle, () => { state.nozzle = b.d; renderNozzles(); renderQualities(); update(); })
    ));
  }

  function initForm() {
    renderMaterials();
    renderFinish();
    renderLed();
    $("#led-on").onchange = (e) => { state.led.on = e.target.checked; renderLed(); update(); };
    const setLed = (v) => {
      state.led.metros = Math.max(0.5, Math.min(50, Math.round((+v || 0.5) * 2) / 2));
      renderLed();
      update();
    };
    $("#led-m").onchange = (e) => setLed(e.target.value);
    $("#led-minus").onclick = () => setLed(ledMeters() - 0.5);
    $("#led-plus").onclick = () => setLed(ledMeters() + 0.5);
    renderNozzles();
    renderQualities();

    // lista de placas: clic para enfocar en el visor; selector de color por placa
    $("#plates").addEventListener("click", (e) => {
      if (e.target.closest("select, label")) return;
      const row = e.target.closest(".plate[data-focus]");
      if (row) focusPlate(+row.dataset.focus === viewer.focus ? null : +row.dataset.focus);
    });
    $("#plates").addEventListener("change", (e) => {
      const sel = e.target.closest(".piece-color");
      if (!sel) return;
      state.pieceColors[sel.dataset.key] = +sel.value;
      update();
    });
    initPainting();
    // pedir por WhatsApp con la ficha ilustrada de la cotización
    $("#wa-btn").addEventListener("click", (e) => {
      if (!state.lastQuote) return;
      e.preventDefault();
      let blob = null;
      try { blob = quoteImage(state.lastQuote); } catch (err) { console.error(err); }
      sendWhatsApp(state.waText, blob, `cotizacion-${slug(C.negocio.nombre)}.png`);
    });
    $("#pn-prev").onclick = () => stepPlate(-1);
    $("#pn-next").onclick = () => stepPlate(1);

    $("#infill").oninput = (e) => { state.infill = +e.target.value; $("#infill-out").textContent = state.infill + "%"; update(); };
    $("#scale").oninput = (e) => setScale(+e.target.value);
    $("#supports").onchange = (e) => { state.supports = e.target.checked; update(); };

    const qty = $("#qty");
    const setQty = (v) => { state.qty = Math.max(1, Math.min(500, v | 0 || 1)); qty.value = state.qty; update(); };
    qty.oninput = () => setQty(+qty.value);
    $("#qty-minus").onclick = () => setQty(state.qty - 1);
    $("#qty-plus").onclick = () => setQty(state.qty + 1);

    const dz = $("#dropzone");
    $("#file").onchange = (e) => { loadFiles([...e.target.files]); e.target.value = ""; };
    ["dragenter", "dragover"].forEach((ev) => viewer.el.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add("over"); }));
    ["dragleave", "drop"].forEach((ev) => viewer.el.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove("over"); }));
    viewer.el.addEventListener("drop", (e) => loadFiles([...e.dataTransfer.files]));

    $("#demo-btn").onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      showModel(new THREE.TorusKnotGeometry(22, 7, 220, 36), "ejemplo-nudo.stl", false);
    };
    $("#reset-btn").onclick = () => $("#file").click();
  }

  /* ---------------- catálogo ---------------- */
  function shapeGeometry(forma) {
    switch (forma) {
      case "knot": return new THREE.TorusKnotGeometry(1, 0.32, 200, 32);
      case "torus": return new THREE.TorusGeometry(1.1, 0.42, 48, 96);
      case "ico": return new THREE.IcosahedronGeometry(1.4, 0);
      case "box": return new THREE.BoxGeometry(1.8, 1.4, 1.8);
      case "cone": return new THREE.ConeGeometry(1.2, 2.2, 6, 1, true);
      case "cylinder": return new THREE.CylinderGeometry(1, 1, 1.8, 48);
      case "sphere": return new THREE.SphereGeometry(1.3, 48, 32);
      case "gear": {
        const shape = new THREE.Shape(), teeth = 14;
        for (let i = 0; i <= teeth * 4; i++) {
          const a = (i / (teeth * 4)) * Math.PI * 2;
          const r = i % 4 < 2 ? 1.45 : 1.15;
          i ? shape.lineTo(Math.cos(a) * r, Math.sin(a) * r) : shape.moveTo(Math.cos(a) * r, Math.sin(a) * r);
        }
        const hole = new THREE.Path();
        hole.absarc(0, 0, 0.4, 0, Math.PI * 2, true);
        shape.holes.push(hole);
        const g = new THREE.ExtrudeGeometry(shape, { depth: 0.5, bevelEnabled: true, bevelSize: 0.04, bevelThickness: 0.04 });
        g.center();
        return g;
      }
      default: return new THREE.DodecahedronGeometry(1.3);
    }
  }

  /* ---------------- compartir por WhatsApp con imagen ---------------- */
  // wa.me solo acepta texto. En celular se usa "Compartir" del sistema (adjunta la imagen);
  // en computador la imagen se copia al portapapeles para pegarla en el chat.
  function dataUrlToBlob(url) {
    const [head, body] = url.split(",");
    const bin = atob(body);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: head.match(/:(.*?);/)[1] });
  }

  function toPng(blob) {
    if (blob.type === "image/png") return Promise.resolve(blob);
    return createImageBitmap(blob).then((bmp) => {
      const cv = document.createElement("canvas");
      cv.width = bmp.width;
      cv.height = bmp.height;
      cv.getContext("2d").drawImage(bmp, 0, 0);
      return new Promise((res) => cv.toBlob(res, "image/png"));
    });
  }

  function toast(msg) {
    const t = $("#toast");
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => { t.hidden = true; }, 6000);
  }

  // blob: la imagen ya lista (Blob) o null. Debe llamarse directo desde el clic.
  function sendWhatsApp(text, blob, fileName) {
    const waUrl = `https://wa.me/${C.negocio.whatsapp}?text=${encodeURIComponent(text)}`;
    const file = blob ? new File([blob], fileName, { type: blob.type }) : null;
    const touch = matchMedia("(pointer: coarse)").matches;
    if (file && touch && navigator.canShare && navigator.canShare({ files: [file] })) {
      navigator.share({ files: [file], text }).catch((e) => {
        if (e.name !== "AbortError") window.open(waUrl, "_blank", "noopener");
      });
      return;
    }
    if (!blob) {
      window.open(waUrl, "_blank", "noopener");
      return;
    }
    // computador: ventana con la imagen. Se copia AHORA, mientras la página tiene el foco
    // (si primero se abre WhatsApp, el navegador ya no deja copiar).
    openShareDialog(waUrl, blob, fileName);
  }

  function copyImage(blob) {
    if (!navigator.clipboard || !window.ClipboardItem) return Promise.reject(new Error("sin portapapeles"));
    const png = blob.type === "image/png" ? blob : toPng(blob);
    return navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
  }

  let shareUrl = null;
  function openShareDialog(waUrl, blob, fileName) {
    const dlg = $("#share");
    if (shareUrl) URL.revokeObjectURL(shareUrl);
    shareUrl = URL.createObjectURL(blob);
    $("#share-img").src = shareUrl;
    const dl = $("#share-dl");
    dl.href = shareUrl;
    dl.download = fileName;
    const status = $("#share-status");
    const setStatus = (ok) => {
      status.className = "share-status " + (ok ? "ok" : "fail");
      status.textContent = ok
        ? "✓ Imagen copiada. Abre WhatsApp y pégala en el chat con Ctrl+V (o clic derecho → Pegar)."
        : "No se pudo copiar automáticamente: usa «Copiar imagen» o descárgala y adjúntala en WhatsApp con el clip 📎.";
    };
    status.className = "share-status";
    status.textContent = "Copiando imagen…";
    dlg.hidden = false;
    copyImage(blob).then(() => setStatus(true), () => setStatus(false));
    $("#share-copy").onclick = () => copyImage(blob).then(() => setStatus(true), () => setStatus(false));
    $("#share-wa").onclick = () => {
      const win = window.open(waUrl, "_blank");
      if (win) win.opener = null;
    };
    $("#share-wa").focus();
  }

  function closeShareDialog() {
    $("#share").hidden = true;
  }

  /* Ficha de la cotización: vista de cada placa con sus colores + datos y total.
     Todo es síncrono: compartir/copiar solo se permite en el mismo instante del clic. */
  function quoteImage(r) {
    const views = viewer.plateViews && viewer.plateViews.length ? viewer.plateViews : null;
    const n = views ? views.length : 1;
    const cols = n === 1 ? 1 : n <= 4 ? 2 : 3;
    const rows = Math.ceil(n / cols);
    const W = 1080, pad = 36, head = 210, foot = 64, gap = 16, info = 56;
    const tile = Math.floor((W - pad * 2 - (cols - 1) * gap) / cols);
    // servicios adicionales (LED, pintura, colores, ensamble, mínimo) para que la ficha cuadre con el total
    const icons = { led: "💡", color: "◐", pintura: "🖌", ensamble: "✚", cambios: "◐" };
    const extraRows = r.extras.map((e) => [icons[e.key] || "+", e.label, e.precio]);
    if (r.minimo > 0) extraRows.push(["$", "Ajuste a pedido mínimo", r.minimo]);
    const rowH = 46, extrasH = extraRows.length ? 56 + extraRows.length * rowH : 0;
    const tilesH = rows * (tile + info + gap);
    const H = head + tilesH + extrasH + foot;
    const cv = document.createElement("canvas");
    cv.width = W;
    cv.height = H;
    const g = cv.getContext("2d");
    const q = state.qty, s = r.s, sz = state.model.size;
    const mat = C.materiales[state.mat];

    // fondo y encabezado
    g.fillStyle = "#08090c";
    g.fillRect(0, 0, W, H);
    g.fillStyle = "#c6ff3d";
    g.font = "700 46px 'Space Grotesk', sans-serif";
    g.fillText(C.negocio.nombre, pad, 70);
    g.fillStyle = "#8b909c";
    g.font = "400 22px 'JetBrains Mono', monospace";
    g.fillText(`Cotización · ${new Date().toLocaleDateString("es-CO")}`, pad, 104);
    g.fillStyle = "#eceef2";
    g.font = "500 26px 'Space Grotesk', sans-serif";
    const colTxt = r.colores > 1 ? `multicolor (${r.colores} colores)` : mat.colores[state.color].nombre;
    g.fillText(`${state.model.name} · ${mat.nombre} ${colTxt}`.slice(0, 60), pad, 148);
    g.fillStyle = "#8b909c";
    g.font = "400 20px 'JetBrains Mono', monospace";
    const dd = fmtDims([sz.x * s, sz.z * s, sz.y * s]);
    g.fillText(`${n > 1 ? `${n} placas · hasta ` : ""}${dd} · ${fmtG(r.grams * q)} · ${fmtTime(r.hours * q)}`, pad, 182);
    g.textAlign = "right";
    g.fillStyle = "#c6ff3d";
    g.font = "700 52px 'Space Grotesk', sans-serif";
    g.fillText(money(r.total), W - pad, 74);
    g.fillStyle = "#8b909c";
    g.font = "400 20px 'JetBrains Mono', monospace";
    g.fillText(q > 1 ? `${q} unidades` : "total estimado", W - pad, 104);
    g.textAlign = "left";

    // cada placa: se dibuja el 3D directo en su cuadro
    const rend = viewer.renderer;
    const prevRatio = rend.getPixelRatio();
    const prevSize = rend.getSize(new THREE.Vector2());
    rend.setPixelRatio(1);
    rend.setSize(tile, tile, false);
    const cam = new THREE.PerspectiveCamera(36, 1, 1, 20000);
    const visible = views ? views.map((v) => v.sub.visible) : null;
    if (views) views.forEach((v) => { if (v.label) v.label.visible = false; }); // la ficha pone sus propios títulos
    const dimsVisible = viewer.dimGroup ? viewer.dimGroup.visible : null;
    const printerVisible = viewer.printer.group.visible;
    for (let i = 0; i < n; i++) {
      const x = pad + (i % cols) * (tile + gap);
      const y = head + Math.floor(i / cols) * (tile + info + gap);
      const p = r.parts[i];
      if (views) {
        const v = views[i];
        views.forEach((o, k) => { o.sub.visible = k === i; });
        const big = Math.max((p.b.x1 - p.b.x0) * s, p.h * s, (p.b.z1 - p.b.z0) * s, 60);
        const dist = Math.max(big * 2.1, 160);
        cam.position.set(v.ox + dist * 0.55, dist * 0.6, v.oz + dist * 0.7);
        cam.lookAt(v.ox, Math.min(p.h * s, 200) * 0.35, v.oz);
      } else {
        viewer.printer.group.visible = false;
        const big = Math.max(sz.x, sz.y, sz.z) * s;
        const dist = Math.max(big * 2.3, 60);
        cam.position.set(dist * 0.62, dist * 0.5 + sz.y * s * 0.3, dist * 0.72);
        cam.lookAt(0, sz.y * s * 0.42, 0);
      }
      rend.render(viewer.scene, cam);
      g.save();
      g.beginPath();
      g.roundRect(x, y, tile, tile + info, 18);
      g.fillStyle = "#11131a";
      g.fill();
      g.clip();
      g.drawImage(rend.domElement, 0, 0, tile, tile, x, y, tile, tile);
      g.restore();

      if (n > 1) {
        g.fillStyle = "#c6ff3d";
        g.font = "700 22px 'JetBrains Mono', monospace";
        g.fillText(`PLACA ${p.label || i + 1}`, x + 16, y + 34);
      }
      const colors = [...new Map(p.r.pieces.map((pc) => [pc.color.hex, pc.color])).values()];
      colors.slice(0, 6).forEach((c, k) => {
        g.beginPath();
        g.arc(x + tile - 22 - k * 26, y + 26, 10, 0, Math.PI * 2);
        g.fillStyle = c.hex;
        g.fill();
        g.lineWidth = 2;
        g.strokeStyle = "rgba(255,255,255,.35)";
        g.stroke();
      });
      g.fillStyle = "#eceef2";
      g.font = `500 ${cols === 3 ? 17 : 20}px 'JetBrains Mono', monospace`;
      g.fillText(`${fmtG(p.r.grams * q)} · ${fmtTime(p.r.hours * q)}`, x + 14, y + tile + 36);
      g.textAlign = "right";
      g.fillStyle = "#c6ff3d";
      g.fillText(money(p.precio), x + tile - 14, y + tile + 36);
      g.textAlign = "left";
    }
    if (views) views.forEach((v, k) => { v.sub.visible = visible[k]; if (v.label) v.label.visible = true; });
    viewer.printer.group.visible = printerVisible;
    if (viewer.dimGroup) viewer.dimGroup.visible = dimsVisible;
    rend.setPixelRatio(prevRatio);
    rend.setSize(prevSize.x, prevSize.y, false);
    rend.render(viewer.scene, viewer.camera);

    g.fillStyle = "#8b909c";
    g.font = "400 18px 'JetBrains Mono', monospace";
    if (extraRows.length) {
      let y = head + tilesH + 8;
      g.fillStyle = "#8b909c";
      g.font = "600 18px 'JetBrains Mono', monospace";
      g.fillText("INCLUYE ADEMÁS", pad, y + 18);
      y += 34;
      for (const [icon, label, price] of extraRows) {
        g.fillStyle = "#11131a";
        g.beginPath();
        g.roundRect(pad, y, W - pad * 2, rowH - 8, 12);
        g.fill();
        g.font = "20px 'Space Grotesk', sans-serif";
        g.fillStyle = "#eceef2";
        g.fillText(`${icon}  ${label}`.slice(0, 78), pad + 16, y + 26);
        g.textAlign = "right";
        g.fillStyle = "#c6ff3d";
        g.font = "600 20px 'JetBrains Mono', monospace";
        g.fillText(money(price), W - pad - 16, y + 26);
        g.textAlign = "left";
        y += rowH;
      }
    }
    g.fillStyle = "#8b909c";
    g.font = "400 18px 'JetBrains Mono', monospace";
    g.fillText(`${C.maquina.nombre} · boquilla ${state.nozzle} mm · capa ${layerHeight()} mm · relleno ${state.infill}% · estimación automática`, pad, H - 28);
    return dataUrlToBlob(cv.toDataURL("image/png"));
  }

  /* ---------------- catálogo con fotos y videos ---------------- */
  const isVideo = (src) => /\.(mp4|webm|mov|m4v)(\?|#|$)/i.test(src);
  const slug = (txt) => txt.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

  // Sin fotos: tres vistas 3D generadas con la "forma" del trabajo
  function makeThumbs(items) {
    const r = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    r.setSize(480, 480);
    const scene = new THREE.Scene();
    const cam = new THREE.PerspectiveCamera(35, 1, 0.1, 50);
    cam.position.set(3.4, 2.4, 4.2);
    cam.lookAt(0, 0, 0);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x222233, 0.8));
    const l = new THREE.DirectionalLight(0xffffff, 1);
    l.position.set(3, 5, 4);
    scene.add(l);
    const rim = new THREE.DirectionalLight(0x7c5cff, 0.7);
    rim.position.set(-4, 1, -3);
    scene.add(rim);
    const angles = [[0.4, 0.6], [0.15, 2.3], [1.05, 4.1]];

    const lists = items.map((it) => {
      const media = (it.media && it.media.length ? it.media : it.imagen ? [it.imagen] : []).filter(Boolean);
      if (media.length) return media;
      const mesh = new THREE.Mesh(shapeGeometry(it.forma),
        new THREE.MeshStandardMaterial({ color: it.color, roughness: 0.4, metalness: 0.15, side: THREE.DoubleSide, flatShading: it.forma === "ico" }));
      scene.add(mesh);
      const urls = angles.map(([x, y]) => {
        mesh.rotation.set(x, y, 0);
        r.render(scene, cam);
        return r.domElement.toDataURL("image/png");
      });
      scene.remove(mesh);
      mesh.geometry.dispose();
      return urls;
    });
    r.dispose();
    return lists;
  }

  let catFilter = "Todos", gallery = [];
  const slideAt = new Map(); // trabajo → foto visible en la tarjeta

  function slideHTML(src, alt, inCard) {
    if (isVideo(src)) {
      return inCard
        ? `<div class="slide"><video src="${src}" muted loop playsinline preload="metadata"></video><span class="play" aria-hidden="true">▶</span></div>`
        : `<video src="${src}" controls autoplay playsinline></video>`;
    }
    return inCard ? `<div class="slide"><img src="${src}" alt="${alt}" loading="lazy" draggable="false"></div>` : `<img src="${src}" alt="${alt}">`;
  }

  function renderCatalog() {
    $("#cat-note").hidden = !C.catalogo.some((it) => it.ejemplo);
    const cats = ["Todos", ...new Set(C.catalogo.map((i) => i.categoria))];
    $("#cat-filters").replaceChildren(...cats.map((c) =>
      chip(c, c === catFilter, () => { catFilter = c; renderCatalog(); })
    ));
    $("#catalog").innerHTML = C.catalogo.map((it, i) => {
      if (catFilter !== "Todos" && it.categoria !== catFilter) return "";
      const base = C.materiales[it.material];
      const precio = base ? roundTo(it.desde * (priceKg(it.material) / base.precio_kg), 500) : it.desde;
      const media = gallery[i] || [];
      const k = Math.min(slideAt.get(i) || 0, media.length - 1);
      const vids = media.filter(isVideo).length, fotos = media.length - vids;
      return `
        <article class="card" id="trabajo-${slug(it.nombre)}">
          <div class="card-media" data-i="${i}" role="button" tabindex="0" aria-label="Ver fotos de ${it.nombre}">
            <div class="track" style="transform:translateX(-${k * 100}%)">
              ${media.map((m, j) => slideHTML(m, `${it.nombre} ${j + 1}`, true)).join("")}
            </div>
            ${media.length > 1 ? `
            <button type="button" class="slide-btn prev" data-step="-1" aria-label="Foto anterior">‹</button>
            <button type="button" class="slide-btn next" data-step="1" aria-label="Foto siguiente">›</button>
            <div class="dots">${media.map((_, j) => `<span class="${j === k ? "on" : ""}"></span>`).join("")}</div>` : ""}
            ${it.media && it.media.length ? `<span class="count mono">${fotos ? `📷 ${fotos}` : ""}${vids ? ` 🎬 ${vids}` : ""}</span>` : ""}
            ${it.ejemplo ? `<span class="demo-tag mono">Ejemplo</span>` : ""}
          </div>
          <div class="card-body">
            <span class="card-tag mono">${it.categoria} · ${it.material}</span>
            <h3>${it.nombre}</h3>
            <div class="card-foot">
              <span class="card-price">desde ${money(precio)}</span>
              <button type="button" class="btn btn-ghost btn-sm" data-order="${i}">Pedir</button>
            </div>
          </div>
        </article>`;
    }).join("");
  }

  function setSlide(i, k) {
    const media = gallery[i] || [];
    if (!media.length) return;
    k = (k + media.length) % media.length;
    slideAt.set(i, k);
    const box = document.querySelector(`.card-media[data-i="${i}"]`);
    if (!box) return;
    box.querySelector(".track").style.transform = `translateX(-${k * 100}%)`;
    box.querySelectorAll(".dots span").forEach((d, j) => d.classList.toggle("on", j === k));
    box.querySelectorAll("video").forEach((v) => v.pause());
  }

  // imagen para adjuntar al pedido (la foto visible o la primera que no sea video)
  const mediaBlobs = new Map();
  function prefetchMedia(i) {
    const media = gallery[i] || [];
    const src = [media[slideAt.get(i) || 0], ...media].find((m) => m && !isVideo(m));
    if (!src || mediaBlobs.has(src)) return src;
    if (src.startsWith("data:")) mediaBlobs.set(src, dataUrlToBlob(src));
    else fetch(src).then((r) => r.blob()).then((b) => mediaBlobs.set(src, b)).catch(() => {});
    return src;
  }

  function orderWork(i) {
    const it = C.catalogo[i];
    const src = prefetchMedia(i);
    const link = `${location.origin}${location.pathname}#trabajo-${slug(it.nombre)}`;
    const text = `Hola ${C.negocio.nombre}! Me interesa "${it.nombre}" (${it.material}) de tus trabajos.\n${link}`;
    sendWhatsApp(text, (src && mediaBlobs.get(src)) || null, `${slug(it.nombre)}.png`);
  }

  /* visor a pantalla completa */
  const lb = { i: 0, k: 0 };
  function openLightbox(i, k = 0) {
    lb.i = i;
    lb.k = k;
    $("#lightbox").hidden = false;
    document.body.style.overflow = "hidden";
    renderLightbox();
    $("#lb-close").focus();
  }
  function closeLightbox() {
    $("#lightbox").hidden = true;
    document.body.style.overflow = "";
    $("#lb-stage").innerHTML = "";
  }
  function renderLightbox() {
    const it = C.catalogo[lb.i], media = gallery[lb.i] || [];
    lb.k = (lb.k + media.length) % media.length;
    $("#lb-stage").innerHTML = slideHTML(media[lb.k], `${it.nombre} ${lb.k + 1}`, false);
    $("#lb-title").textContent = it.nombre;
    $("#lb-count").textContent = `${lb.k + 1} / ${media.length}`;
    $("#lb-thumbs").innerHTML = media.length > 1 ? media.map((m, j) => `
      <button type="button" class="${j === lb.k ? "on" : ""}" data-k="${j}" aria-label="Ver ${j + 1}">
        ${isVideo(m) ? `<span>▶</span>` : `<img src="${m}" alt="">`}
      </button>`).join("") : "";
    const multi = media.length > 1;
    $("#lb-prev").hidden = $("#lb-next").hidden = !multi;
    setSlide(lb.i, lb.k);
    prefetchMedia(lb.i);
  }

  function initCatalog() {
    const cat = $("#catalog");
    let start = null;
    cat.addEventListener("click", (e) => {
      const order = e.target.closest("[data-order]");
      if (order) return orderWork(+order.dataset.order);
      const box = e.target.closest(".card-media");
      if (!box) return;
      const i = +box.dataset.i;
      const step = e.target.closest("[data-step]");
      if (step) return setSlide(i, (slideAt.get(i) || 0) + +step.dataset.step);
      if (box.dataset.swiped) { delete box.dataset.swiped; return; }
      openLightbox(i, slideAt.get(i) || 0);
    });
    cat.addEventListener("keydown", (e) => {
      const box = e.target.closest(".card-media");
      if (box && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); openLightbox(+box.dataset.i, slideAt.get(+box.dataset.i) || 0); }
    });
    // deslizar con el dedo en la tarjeta
    cat.addEventListener("pointerdown", (e) => {
      const box = e.target.closest(".card-media");
      if (box) start = { box, x: e.clientX };
    });
    cat.addEventListener("pointerup", (e) => {
      if (!start) return;
      const dx = e.clientX - start.x;
      if (Math.abs(dx) > 40) {
        start.box.dataset.swiped = "1";
        const i = +start.box.dataset.i;
        setSlide(i, (slideAt.get(i) || 0) + (dx < 0 ? 1 : -1));
      }
      start = null;
    });
    // videos de la tarjeta: se reproducen al pasar el mouse; preparar la imagen del pedido
    cat.addEventListener("pointerover", (e) => {
      const box = e.target.closest(".card-media");
      if (!box) return;
      prefetchMedia(+box.dataset.i);
      const v = box.querySelectorAll(".slide")[slideAt.get(+box.dataset.i) || 0]?.querySelector("video");
      if (v) v.play().catch(() => {});
    });
    cat.addEventListener("pointerout", (e) => {
      const box = e.target.closest(".card-media");
      if (box && !box.contains(e.relatedTarget)) box.querySelectorAll("video").forEach((v) => v.pause());
    });

    $("#lb-close").onclick = closeLightbox;
    $("#share-close").onclick = closeShareDialog;
    $("#share").addEventListener("click", (e) => { if (e.target.id === "share") closeShareDialog(); });
    addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("#share").hidden) closeShareDialog(); });
    $("#lb-prev").onclick = () => { lb.k--; renderLightbox(); };
    $("#lb-next").onclick = () => { lb.k++; renderLightbox(); };
    $("#lb-order").onclick = () => orderWork(lb.i);
    $("#lb-thumbs").addEventListener("click", (e) => {
      const b = e.target.closest("[data-k]");
      if (b) { lb.k = +b.dataset.k; renderLightbox(); }
    });
    $("#lightbox").addEventListener("click", (e) => { if (e.target.id === "lightbox") closeLightbox(); });
    let lbStart = null;
    $("#lb-stage").addEventListener("pointerdown", (e) => { lbStart = e.clientX; });
    $("#lb-stage").addEventListener("pointerup", (e) => {
      if (lbStart == null) return;
      const dx = e.clientX - lbStart;
      lbStart = null;
      if (Math.abs(dx) > 50) { lb.k += dx < 0 ? 1 : -1; renderLightbox(); }
    });
    addEventListener("keydown", (e) => {
      if ($("#lightbox").hidden) return;
      if (e.key === "Escape") closeLightbox();
      else if (e.key === "ArrowLeft") { lb.k--; renderLightbox(); }
      else if (e.key === "ArrowRight") { lb.k++; renderLightbox(); }
    });

    // enlace directo a un trabajo (el que va en el mensaje de WhatsApp)
    const m = location.hash.match(/^#trabajo-(.+)$/);
    if (m) {
      const i = C.catalogo.findIndex((it) => slug(it.nombre) === m[1]);
      if (i >= 0) {
        document.getElementById(location.hash.slice(1))?.scrollIntoView({ block: "center" });
        openLightbox(i, 0);
      }
    }
  }

  /* ---------------- materiales y ticker ---------------- */
  function renderMaterialCards() {
    const labels = { resistencia: "Resistencia", flexibilidad: "Flexibilidad", temperatura: "Temperatura", detalle: "Detalle" };
    $("#materials").innerHTML = Object.values(C.materiales).map((m, i) => {
      const key = Object.keys(C.materiales)[i];
      return `
        <div class="mat">
          <h3>${m.nombre}<small class="taller-only">${money(priceKg(key))}/kg</small></h3>
          <p>${m.desc}</p>
          ${Object.entries(m.props).map(([k, v]) => `<div class="bar"><span>${labels[k]}</span><i style="--v:${v * 20}%"></i></div>`).join("")}
        </div>`;
    }).join("");

    const fecha = state.trmFecha ? ` del ${state.trmFecha}` : "";
    $("#price-note").classList.add("taller-only");
    $("#price-note").textContent =
      `Los precios por kilo se ajustan solos con el dólar (TRM ${cop(state.trm)}${fecha}, fuente: ${state.trmFuente}). ` +
      `Precios de filamento y energía actualizados automáticamente el ${C.precios_revisados}.`;
  }

  function renderTicker() {
    const delta = (state.trm / C.trm.referencia - 1) * 100;
    const arrow = delta >= 0 ? `<span class="up">▲ ${delta.toFixed(1)}%</span>` : `<span class="down">▼ ${Math.abs(delta).toFixed(1)}%</span>`;
    const items = [
      `<span>USD/COP <b>${cop(state.trm)}</b> ${arrow}</span>`,
      `<span>ENERGÍA ESTRATO ${C.energia.estrato || ""} <b>${cop(C.energia.precio_kwh)}/kWh</b></span>`,
      ...Object.entries(C.materiales).map(([k, m]) => `<span>${m.nombre} <b>${money(priceKg(k))}/kg</b></span>`),
      `<span>MÁQUINA <b>${C.maquina.nombre.toUpperCase()}</b></span>`,
      `<span>ÁREA MÁX <b>${C.maquina.volumen_mm.join("×")} mm</b></span>`,
      `<span>ENVÍOS <b>TODA COLOMBIA</b></span>`,
    ].join("");
    const publicItems = [
      `<span>IMPRESIÓN EN <b>${C.maquina.nombre.toUpperCase()}</b></span>`,
      `<span>MATERIALES <b>${Object.values(C.materiales).map((m) => m.nombre.split(" ")[0]).join(" · ")}</b></span>`,
      `<span>PIEZAS HASTA <b>${C.maquina.volumen_mm.map((v) => v / 10).join(" × ")} CM</b> · MÁS GRANDES POR PARTES</span>`,
      `<span>MULTICOLOR Y <b>PINTADO A MANO</b></span>`,
      `<span>COTIZA <b>AL INSTANTE</b> CON TU STL O 3MF</span>`,
      `<span>ENVÍOS A <b>TODA COLOMBIA</b></span>`,
    ].join("");
    const shown = TALLER ? items : publicItems;
    $("#ticker-track").innerHTML = shown + shown; // duplicado para el bucle continuo
  }

  function renderPrices() {
    renderMaterialCards();
    renderTicker();
    renderCatalog();
    update();
  }

  /* ---------------- moneda ---------------- */
  function initCurrency() {
    try {
      if (localStorage.getItem("moneda") === "USD") state.currency = "USD";
    } catch (e) { /* almacenamiento no disponible: queda en pesos */ }
    const btns = document.querySelectorAll("[data-cur]");
    const paint = () => btns.forEach((b) => {
      b.classList.toggle("active", b.dataset.cur === state.currency);
      b.setAttribute("aria-pressed", b.dataset.cur === state.currency);
    });
    btns.forEach((b) => (b.onclick = () => {
      state.currency = b.dataset.cur;
      try { localStorage.setItem("moneda", state.currency); } catch (e) { /* sin almacenamiento */ }
      paint();
      renderPrices();
    }));
    paint();
  }

  /* ---------------- arranque ---------------- */
  bindTexts();
  initCurrency();
  initHero();
  initViewer();
  initForm();
  gallery = makeThumbs(C.catalogo);
  initCatalog();
  renderPrices();
  loadDailyPrices().then(renderPrices).then(loadTRM).then(renderPrices);
})();
