/* Lector rápido de 3MF (sin DOM). Funciona en la página y dentro de un Web Worker.
   Lee proyectos de Bambu Studio / PrusaSlicer: mallas, componentes en otros archivos
   .model, transformaciones y las placas definidas en Metadata/model_settings.config.
   Requiere fflate (global). Expone parse3MFBuffer(buffer, bed, onProgress).            */
(function (root) {
  const UNITS = { micron: 0.001, millimeter: 1, centimeter: 10, inch: 25.4, foot: 304.8, meter: 1000 };
  const decoder = new TextDecoder();

  /* ---------- matrices 3MF: 12 números, vectores fila ---------- */
  const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];
  function parseMatrix(str) {
    if (!str) return IDENTITY;
    const v = str.trim().split(/\s+/).map(Number);
    return v.length === 12 && v.every(Number.isFinite) ? v : IDENTITY;
  }
  // primero a, luego b (p' = p·a·b)
  function combine(a, b) {
    const r = new Array(12);
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 3; j++) {
        r[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j] + (i === 3 ? b[9 + j] : 0);
      }
    }
    return r;
  }

  /* ---------- arreglo que crece ---------- */
  class Grow {
    constructor(Type, n = 1 << 16) { this.Type = Type; this.a = new Type(n); this.n = 0; }
    push3(x, y, z) {
      if (this.n + 3 > this.a.length) {
        const b = new this.Type(this.a.length * 2);
        b.set(this.a);
        this.a = b;
      }
      this.a[this.n++] = x;
      this.a[this.n++] = y;
      this.a[this.n++] = z;
    }
    get data() { return this.a.subarray(0, this.n); }
  }

  /* ---------- lectura de XML byte a byte ---------- */
  const LT = 60, GT = 62, SLASH = 47, QUOTE = 34, APOS = 39, EQ = 61;

  // número decimal directo desde los bytes (más rápido que crear strings)
  function num(bytes, i, end) {
    let sign = 1, v = 0, frac = 0, div = 1, exp = 0, expSign = 1, k = i;
    if (bytes[k] === 45) { sign = -1; k++; } else if (bytes[k] === 43) k++;
    while (k < end && bytes[k] >= 48 && bytes[k] <= 57) v = v * 10 + (bytes[k++] - 48);
    if (bytes[k] === 46) {
      k++;
      while (k < end && bytes[k] >= 48 && bytes[k] <= 57) { frac = frac * 10 + (bytes[k++] - 48); div *= 10; }
    }
    if (bytes[k] === 101 || bytes[k] === 69) {
      k++;
      if (bytes[k] === 45) { expSign = -1; k++; } else if (bytes[k] === 43) k++;
      while (k < end && bytes[k] >= 48 && bytes[k] <= 57) exp = exp * 10 + (bytes[k++] - 48);
    }
    const r = sign * (v + frac / div);
    return exp ? r * Math.pow(10, expSign * exp) : r;
  }

  // nombre de la etiqueta (sin prefijo de espacio de nombres)
  function tagName(bytes, i) {
    let k = i, start = i;
    while (k < bytes.length && bytes[k] > 32 && bytes[k] !== GT && bytes[k] !== SLASH) {
      if (bytes[k] === 58) start = k + 1; // "p:..." → "..."
      k++;
    }
    return decoder.decode(bytes.subarray(start, k));
  }

  // atributos de la etiqueta que empieza en i; llama fn(nombre, inicioValor, finValor)
  function eachAttr(bytes, i, fn) {
    let k = i;
    while (k < bytes.length && bytes[k] > 32 && bytes[k] !== GT && bytes[k] !== SLASH) k++;
    while (k < bytes.length && bytes[k] !== GT) {
      while (bytes[k] <= 32) k++;
      if (bytes[k] === GT || bytes[k] === SLASH) break;
      const ns = k;
      while (bytes[k] !== EQ && bytes[k] > 32) k++;
      const ne = k;
      while (bytes[k] !== QUOTE && bytes[k] !== APOS) k++;
      const q = bytes[k++];
      const vs = k;
      while (bytes[k] !== q) k++;
      fn(ns, ne, vs, k);
      k++;
    }
    return k;
  }
  const nameIs = (bytes, s, e, word) => {
    if (e - s !== word.length) return false;
    for (let j = 0; j < word.length; j++) if (bytes[s + j] !== word.charCodeAt(j)) return false;
    return true;
  };
  const str = (bytes, s, e) => decoder.decode(bytes.subarray(s, e));

  /* Lee un archivo .model: objetos (malla o componentes), ítems de build y unidad */
  function scanModel(bytes, path, objects, report) {
    const out = { items: [], unit: 1 };
    let cur = null, verts = null, tris = null;
    let i = 0, lastReport = 0;
    const n = bytes.length;
    while ((i = bytes.indexOf(LT, i)) !== -1) {
      i++;
      const c = bytes[i];
      if (c === SLASH) {
        // cierre de </object>
        if (cur && bytes[i + 1] === 111 && tagName(bytes, i + 1) === "object") {
          if (verts) { cur.verts = verts.data; cur.tris = tris.data; }
          cur = verts = tris = null;
        }
        continue;
      }
      if (c === 63 || c === 33) continue; // <? y <!
      if (c === 118 && verts && bytes[i + 1] === 101 && bytes[i + 4] === 101 && bytes[i + 5] === 120) { // <vertex (no <vertices>)
        let x = 0, y = 0, z = 0;
        eachAttr(bytes, i, (ns, ne, vs, ve) => {
          const a = bytes[ns];
          if (ne - ns === 1) {
            if (a === 120) x = num(bytes, vs, ve);
            else if (a === 121) y = num(bytes, vs, ve);
            else if (a === 122) z = num(bytes, vs, ve);
          }
        });
        verts.push3(x, y, z);
      } else if (c === 116 && tris && bytes[i + 1] === 114 && bytes[i + 7] === 101 && bytes[i + 8] !== 115) { // <triangle (no <triangles>)
        let a = 0, b = 0, d = 0;
        eachAttr(bytes, i, (ns, ne, vs, ve) => {
          if (ne - ns === 2 && bytes[ns] === 118) {
            const w = bytes[ns + 1];
            if (w === 49) a = num(bytes, vs, ve);
            else if (w === 50) b = num(bytes, vs, ve);
            else if (w === 51) d = num(bytes, vs, ve);
          }
        });
        tris.push3(a, b, d);
      } else {
        const name = tagName(bytes, i);
        if (name === "object") {
          let id = null;
          eachAttr(bytes, i, (ns, ne, vs, ve) => { if (nameIs(bytes, ns, ne, "id")) id = str(bytes, vs, ve); });
          cur = { comps: [] };
          objects.set(path + "#" + id, cur);
        } else if (name === "mesh" && cur) {
          verts = new Grow(Float32Array);
          tris = new Grow(Uint32Array);
        } else if (name === "component" && cur) {
          let ref = path, id = null, m = IDENTITY;
          eachAttr(bytes, i, (ns, ne, vs, ve) => {
            const nm = str(bytes, ns, ne);
            if (nm === "objectid") id = str(bytes, vs, ve);
            else if (nm === "transform") m = parseMatrix(str(bytes, vs, ve));
            else if (/(^|:)path$/.test(nm)) ref = "/" + str(bytes, vs, ve).replace(/^\/+/, "");
          });
          cur.comps.push({ key: ref + "#" + id, m });
        } else if (name === "item") {
          let id = null, m = IDENTITY;
          eachAttr(bytes, i, (ns, ne, vs, ve) => {
            const nm = str(bytes, ns, ne);
            if (nm === "objectid") id = str(bytes, vs, ve);
            else if (nm === "transform") m = parseMatrix(str(bytes, vs, ve));
          });
          out.items.push({ id, key: path + "#" + id, m });
        } else if (name === "model") {
          eachAttr(bytes, i, (ns, ne, vs, ve) => {
            if (nameIs(bytes, ns, ne, "unit")) out.unit = UNITS[str(bytes, vs, ve)] || 1;
          });
        }
      }
      if (report && i - lastReport > 4e6) {
        lastReport = i;
        report(i / n);
      }
    }
    return out;
  }

  /* Triángulos de un objeto (con sus componentes) ya transformados al mundo */
  function countTris(objects, key, depth = 0) {
    const o = objects.get(key);
    if (!o || depth > 16) return 0;
    let t = o.tris ? o.tris.length / 3 : 0;
    for (const c of o.comps) t += countTris(objects, c.key, depth + 1);
    return t;
  }
  function emit(objects, key, m, out, depth = 0) {
    const o = objects.get(key);
    if (!o || depth > 16) return;
    if (o.tris) {
      const V = o.verts, T = o.tris;
      for (let t = 0; t < T.length; t++) {
        const j = T[t] * 3, x = V[j], y = V[j + 1], z = V[j + 2];
        out.a[out.n++] = x * m[0] + y * m[3] + z * m[6] + m[9];
        out.a[out.n++] = x * m[1] + y * m[4] + z * m[7] + m[10];
        out.a[out.n++] = x * m[2] + y * m[5] + z * m[8] + m[11];
      }
    }
    for (const c of o.comps) emit(objects, c.key, combine(c.m, m), out, depth + 1);
  }

  function bounds(a) {
    const b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    for (let i = 0; i < a.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        if (a[i + k] < b[k]) b[k] = a[i + k];
        if (a[i + k] > b[3 + k]) b[3 + k] = a[i + k];
      }
    }
    return b;
  }

  // Une piezas en una sola malla, desplazando cada una (dx, dy, dz) si se reacomodó.
  // Devuelve también dónde queda cada pieza (en triángulos) para poder colorearla aparte.
  function merge(list) {
    const out = new Float32Array(list.reduce((n, it) => n + it.pos.length, 0));
    const pieces = [];
    let o = 0;
    for (const { pos, name, dx = 0, dy = 0, dz = 0 } of list) {
      pieces.push({ name: name || "", start: o / 9, count: pos.length / 9 });
      if (!dx && !dy && !dz) { out.set(pos, o); o += pos.length; continue; }
      for (let i = 0; i < pos.length; i += 3) {
        out[o++] = pos[i] + dx;
        out[o++] = pos[i + 1] + dy;
        out[o++] = pos[i + 2] + dz;
      }
    }
    return { positions: out, pieces };
  }

  // Acomoda piezas enteras en filas dentro de cada cama; abre otra placa si no caben
  function pack(items, bx, by, gap = 6) {
    const size = (it) => ({ w: it.box[3] - it.box[0], d: it.box[4] - it.box[1] });
    const sorted = [...items].sort((a, b) => size(b).d - size(a).d);
    const plates = [];
    const place = (pl, it) => {
      const { w, d } = size(it);
      const put = (x, y) => pl.items.push({ pos: it.pos, name: it.name, dx: x - it.box[0], dy: y - it.box[1], dz: -it.box[2] });
      for (const row of pl.rows) {
        if (row.x + w <= bx && d <= row.h) {
          put(row.x, row.y);
          row.x += w + gap;
          return true;
        }
      }
      const last = pl.rows[pl.rows.length - 1];
      const y = last ? last.y + last.h + gap : 0;
      if (y + d > by) return false;
      pl.rows.push({ y, h: d, x: w + gap });
      put(0, y);
      return true;
    };
    for (const it of sorted) {
      if (!plates.some((pl) => place(pl, it))) {
        const pl = { rows: [], items: [] };
        plates.push(pl);
        place(pl, it);
      }
    }
    return plates.map((pl) => pl.items);
  }

  // Placas de Bambu Studio: plater_id → object_id de los ítems
  function readPlates(text) {
    const plateOf = {};
    const meta = (s, key) => {
      const m = s.match(new RegExp(`key="${key}"\\s+value="([^"]*)"`));
      return m ? m[1] : null;
    };
    for (const [, body] of text.matchAll(/<plate>([\s\S]*?)<\/plate>/g)) {
      const id = +(meta(body, "plater_id") || 0);
      for (const [, inst] of body.matchAll(/<model_instance>([\s\S]*?)<\/model_instance>/g)) {
        const oid = meta(inst, "object_id");
        if (oid) plateOf[oid] = id;
      }
    }
    return plateOf;
  }

  // Nombres que Bambu Studio le pone a cada objeto
  function readNames(text) {
    const names = {};
    for (const [, id, body] of text.matchAll(/<object id="([^"]+)">([\s\S]*?)<\/object>/g)) {
      const m = body.match(/key="name"\s+value="([^"]*)"/);
      if (m) names[id] = m[1];
    }
    return names;
  }

  /* bed = [x, y, z] de la impresora. Devuelve { plates: [{ id, positions }], origen } */
  function parse3MFBuffer(buffer, bed, onProgress = () => {}) {
    onProgress("Descomprimiendo 3MF…", 0);
    const files = root.fflate.unzipSync(new Uint8Array(buffer), {
      filter: (f) => /\.model$/i.test(f.name) || /model_settings\.config$/i.test(f.name),
    });
    const modelPaths = Object.keys(files).filter((f) => /\.model$/i.test(f));
    const rootPath = modelPaths.find((p) => /^\/?3D\/3dmodel\.model$/i.test(p)) || modelPaths[0];
    if (!rootPath) throw new Error("3MF sin modelo");

    const total = modelPaths.reduce((n, p) => n + files[p].length, 0);
    let done = 0;
    const objects = new Map();
    let rootInfo = null;
    // primero los archivos de objetos, al final el principal
    for (const p of [...modelPaths.filter((x) => x !== rootPath), rootPath]) {
      const bytes = files[p];
      const key = "/" + p.replace(/^\/+/, "");
      const info = scanModel(bytes, key, objects, (f) => onProgress("Leyendo mallas…", (done + f * bytes.length) / total));
      done += bytes.length;
      if (p === rootPath) rootInfo = info;
      files[p] = null; // liberar memoria
    }

    onProgress("Armando placas…", 1);
    const u = rootInfo.unit;
    const unitM = [u, 0, 0, 0, u, 0, 0, 0, u, 0, 0, 0];
    const items = [];
    for (const it of rootInfo.items) {
      const n = countTris(objects, it.key);
      if (!n) continue;
      const out = { a: new Float32Array(n * 9), n: 0 };
      emit(objects, it.key, combine(it.m, unitM), out);
      items.push({ id: it.id, pos: out.a, box: bounds(out.a) });
    }
    if (!items.length) throw new Error("3MF sin triángulos");

    const cfg = Object.keys(files).find((f) => /model_settings\.config$/i.test(f));
    const cfgText = cfg ? decoder.decode(files[cfg]) : "";
    const plateOf = cfg ? readPlates(cfgText) : {};
    const names = cfg ? readNames(cfgText) : {};
    items.forEach((it, k) => { it.name = names[it.id] || `Pieza ${k + 1}`; });

    // 1) el archivo dice en qué placa va cada pieza: se respeta
    if (Object.keys(plateOf).length) {
      const groups = new Map();
      for (const it of items) {
        const k = plateOf[it.id] ?? 1;
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k).push(it);
      }
      return {
        origen: "archivo",
        plates: [...groups.entries()].sort((a, b) => a[0] - b[0]).map(([id, list]) => ({ id, ...merge(list) })),
      };
    }
    // 2) piezas sueltas que juntas no caben: se acomodan ENTERAS en placas de la impresora
    const [bx, by, bz] = bed;
    const fits = (b) => b[3] - b[0] <= bx && b[4] - b[1] <= by && b[5] - b[2] <= bz;
    const all = items.reduce((acc, it) => acc.map((v, k) => (k < 3 ? Math.min(v, it.box[k]) : Math.max(v, it.box[k]))),
      [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]);
    if (items.length > 1 && !fits(all) && items.every((it) => fits(it.box))) {
      return { origen: "auto", plates: pack(items, bx, by).map((list, i) => ({ id: i + 1, ...merge(list) })) };
    }
    // 3) una sola placa (si no cabe, el cotizador la corta)
    return { origen: "archivo", plates: [{ id: 1, ...merge(items) }] };
  }

  /* Varias piezas sueltas (p. ej. varios STL): se acomodan enteras en las placas necesarias.
     items: [{ name, pos: Float32Array (Z hacia arriba) }] */
  function packPieces(items, bed) {
    const list = items.map((it) => ({ ...it, box: bounds(it.pos) }));
    return pack(list, bed[0], bed[1]).map((group, i) => ({ id: i + 1, ...merge(group) }));
  }

  root.parse3MFBuffer = parse3MFBuffer;
  root.packPieces = packPieces;
})(typeof self !== "undefined" ? self : window);
