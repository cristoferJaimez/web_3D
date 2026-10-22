/* Actualiza precios.json con TRM, filamentos y energía.
   Lo ejecuta GitHub Actions todos los días (ver .github/workflows/precios.yml).
   También se puede correr a mano:  node scripts/actualizar-precios.mjs        */
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const sandbox = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(root, "config.js"), "utf8"), sandbox);
const C = sandbox.window.CONFIG;
const outFile = path.join(root, "precios.json");
const prev = fs.existsSync(outFile) ? JSON.parse(fs.readFileSync(outFile, "utf8")) : {};

const UA = "Mozilla/5.0 (compatible; actualizador-precios/1.0)";
const MIN_KG = 30000, MAX_KG = 600000; // descarta precios absurdos
const today = new Date().toISOString().slice(0, 10);

async function get(url, opts = {}) {
  const r = await fetch(url, { ...opts, headers: { "User-Agent": UA, ...(opts.headers || {}) }, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r;
}

const median = (a) => {
  const s = [...a].sort((x, y) => x - y), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/* ---------- TRM ---------- */
async function trm() {
  try {
    const d = await (await get("https://www.datos.gov.co/resource/32sa-8pi3.json?$order=vigenciadesde%20DESC&$limit=1")).json();
    return { valor: +d[0].valor, fecha: d[0].vigenciadesde.slice(0, 10), fuente: "datos.gov.co" };
  } catch (e) {
    console.warn("TRM datos.gov.co falló:", e.message);
  }
  try {
    const d = await (await get("https://open.er-api.com/v6/latest/USD")).json();
    return { valor: d.rates.COP, fecha: today, fuente: "open.er-api.com" };
  } catch (e) {
    console.warn("TRM respaldo falló:", e.message);
  }
  return prev.trm || { valor: C.trm.respaldo, fecha: null, fuente: "config" };
}

/* ---------- precio desde un enlace de producto ---------- */
// Shopify (/products/x.json), JSON-LD schema.org, o meta product:price.
async function priceFromUrl(url) {
  const clean = url.split("?")[0].replace(/\/$/, "");
  if (/\/products\//.test(clean)) {
    try {
      const d = await (await get(clean + ".json")).json();
      const v = d.product.variants.find((x) => x.available !== false) || d.product.variants[0];
      return parseFloat(v.price);
    } catch (e) { /* no es Shopify, seguir con HTML */ }
  }
  const html = await (await get(url)).text();
  for (const m of html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const found = findPrice(JSON.parse(m[1]));
      if (found) return found;
    } catch (e) {}
  }
  const meta = html.match(/(?:product:price:amount|itemprop="price")[^>]*content="([\d.,]+)"/i);
  if (meta) return parseNum(meta[1]);
  throw new Error("precio no encontrado");
}

function findPrice(node) {
  if (!node || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (const n of node) { const p = findPrice(n); if (p) return p; }
    return null;
  }
  const offers = node.offers;
  if (offers) {
    const list = Array.isArray(offers) ? offers : [offers];
    for (const o of list) {
      const p = parseNum(o.price ?? o.lowPrice);
      if (p) return p;
    }
  }
  return findPrice(node["@graph"]);
}

function parseNum(v) {
  if (v == null) return null;
  if (typeof v === "number") return v;
  // "85.000" o "85,000.00" o "85000"
  const s = String(v).trim();
  const n = /^\d{1,3}([.,]\d{3})+$/.test(s) ? s.replace(/[.,]/g, "") : s.replace(/,(?=\d{3}\b)/g, "").replace(",", ".");
  return parseFloat(n) || null;
}

/* ---------- MercadoLibre (opcional, requiere app gratuita) ---------- */
let mlToken = null;
async function mercadoLibre(q) {
  const id = process.env.ML_CLIENT_ID, secret = process.env.ML_CLIENT_SECRET;
  if (!id || !secret || !q) return [];
  if (!mlToken) {
    const r = await get("https://api.mercadolibre.com/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "client_credentials", client_id: id, client_secret: secret }),
    });
    mlToken = (await r.json()).access_token;
  }
  const d = await (await get(`https://api.mercadolibre.com/sites/MCO/search?q=${encodeURIComponent(q)}&limit=50`, {
    headers: { Authorization: `Bearer ${mlToken}` },
  })).json();
  // solo publicaciones que digan 1 kg, nuevas
  return d.results
    .filter((r) => r.condition === "new" && /1\s?kg|1000\s?g/i.test(r.title))
    .map((r) => r.price);
}

/* ---------- energía ---------- */
// No existe una API pública con la tarifa de cada operador; se ajusta por
// el tiempo transcurrido desde la última tarifa que anotaste.
function energia() {
  const e = C.energia;
  const años = Math.max(0, (Date.now() - new Date(e.revisada)) / (365.25 * 864e5));
  return {
    precio_kwh: Math.round(e.precio_kwh * (1 + e.alza_anual) ** años),
    fuente: años < 0.08 ? "tarifa de config" : `tarifa ${e.revisada} + ${(e.alza_anual * 100).toFixed(0)}%/año`,
  };
}

/* ---------- principal ---------- */
const t = await trm();
console.log(`TRM: ${t.valor} (${t.fuente})`);

const materiales = {};
for (const [key, m] of Object.entries(C.materiales)) {
  const muestras = [];
  for (const url of m.fuentes || []) {
    try {
      const p = await priceFromUrl(url);
      console.log(`  ${key} ${p} ← ${url}`);
      muestras.push(p);
    } catch (e) {
      console.warn(`  ${key} sin precio en ${url}: ${e.message}`);
    }
  }
  try {
    const ml = await mercadoLibre(m.busqueda_ml);
    if (ml.length) console.log(`  ${key} MercadoLibre: ${ml.length} publicaciones`);
    muestras.push(...ml);
  } catch (e) {
    console.warn(`  ${key} MercadoLibre falló: ${e.message}`);
  }

  const validas = muestras.filter((p) => p >= MIN_KG && p <= MAX_KG);
  if (validas.length) {
    materiales[key] = { precio_kg: Math.round(median(validas)), fuente: "mercado", muestras: validas.length };
  } else {
    // sin datos de mercado: precio base ajustado por dólar
    const ratio = t.valor / C.trm.referencia;
    const p = m.importado ? m.precio_kg * (1 + C.trm.peso_importado * (ratio - 1)) : m.precio_kg;
    materiales[key] = { precio_kg: Math.round(p), fuente: "base + TRM", muestras: 0 };
  }
  console.log(`${key}: ${materiales[key].precio_kg} (${materiales[key].fuente})`);
}

// la energía la calcula la página directamente desde config.js; aquí solo queda como registro
const out = { actualizado: today, trm: t, energia: energia(), materiales };
fs.writeFileSync(outFile, JSON.stringify(out, null, 2) + "\n");
console.log("precios.json actualizado");
