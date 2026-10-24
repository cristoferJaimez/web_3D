/**
 * HHH3D — pedidos del sitio web: archivos en Google Drive + control en Google Sheets.
 *
 * Orden en Drive:
 *   HHH3D - Pedidos/
 *     HHH3D - Control de pedidos   (hoja de cálculo: una fila por pedido + resumen mensual)
 *     2026-10/
 *       20261022-1530-separador-hongos.zip   (archivos del cliente + pedido.txt)
 * Por cada pedido te llega un correo a tu Gmail con el resumen.
 *
 * Instalación: ver los pasos en el README (sección "Recibir los archivos de los pedidos").
 * Los archivos y la hoja NO se comparten: solo tu cuenta los puede abrir.
 */
const CARPETA = "HHH3D - Pedidos";
const HOJA = "HHH3D - Control de pedidos";
const MAX_MB = 30;
const AVISAR_POR_CORREO = true;   // correo a tu Gmail con cada pedido
const BORRAR_DESPUES_DIAS = 90;   // limpieza de archivos .zip (ver activarLimpieza); la hoja no se borra
// Flujo: Cotización (automático) → En proceso (confirmado por WhatsApp) → Imprimiendo → Listo → Entregado.
// "No concretado" = la cotización no se cerró. Ventas y resumen solo cuentan pedidos confirmados.
const ESTADOS = ["Cotización", "En proceso", "Imprimiendo", "Listo", "Entregado", "No concretado"];
const NO_VENTA = ["Cotización", "No concretado"];
const COLUMNAS = ["Pedido", "Fecha", "Mes", "Cliente", "Celular", "Archivo(s)", "Enlace archivo",
  "Material / color", "Placas", "Peso (g)", "Horas", "Costo", "Total", "Utilidad", "Estado",
  "Abonado", "Saldo", "Entrega", "Observaciones", "Detalle",
  // desglose del costo (columnas U a AC)
  "Filamento ($)", "Energía (kWh)", "Energía ($)", "Máquina ($)", "Mano de obra (min)",
  "Mano de obra ($)", "Insumos ($)", "Reserva fallos ($)", "Margen ($)",
  // entrega (columnas AD a AG)
  "Tipo de entrega", "Ciudad", "Dirección", "Envío ($)"];

function doPost(e) {
  try {
    const d = JSON.parse(e.postData.contents);
    return json(d.tipo === "pedido" ? registrarPedido(d) : guardarArchivo(d));
  } catch (err) {
    return json({ ok: false, error: String((err && err.message) || err) });
  }
}

/* ---------- cola pública para la página (sin nombres, celulares ni precios) ---------- */
function doGet(e) {
  if (e && e.parameter && e.parameter.id) return json(detallePedido(e.parameter.id));
  const cache = CacheService.getScriptCache();
  const hit = cache.get("cola");
  if (hit) return ContentService.createTextOutput(hit).setMimeType(ContentService.MimeType.JSON);
  const sh = libro().getSheetByName("Pedidos");
  const n = sh.getLastRow() - 1;
  const filas = n > 0 ? sh.getRange(2, 1, n, 15).getValues() : [];
  const orden = { Imprimiendo: 0, "En proceso": 1, Listo: 2 };
  const hace14 = Date.now() - 14 * 864e5;
  const cola = [];
  let horas = 0, entregados = 0;
  filas.forEach((f) => {
    const id = f[0], fecha = f[1], material = String(f[7] || ""), placas = Number(f[8]) || 0, h = Number(f[10]) || 0, estado = f[14];
    if (estado in orden) {
      cola.push({ id: String(id), estado, material: material.split(" · ")[0], placas, horas: h,
        fecha: fecha instanceof Date ? fecha.toISOString() : "" });
      if (estado !== "Listo") horas += h;
    } else if (estado === "Entregado" && fecha instanceof Date && fecha.getTime() > hace14) {
      entregados++;
    }
  });
  cola.sort((a, b) => orden[a.estado] - orden[b.estado] || a.fecha.localeCompare(b.fecha));
  let taller = null;
  try { taller = leerTaller(); } catch (err) { /* sin hojas de taller: la página sigue normal */ }
  const out = JSON.stringify({ ok: true, cola, horasPendientes: Math.round(horas * 10) / 10, entregados14: entregados, taller });
  cache.put("cola", out, 60); // 1 minuto (y se borra al editar la hoja: ver activarActualizacion)
  return ContentService.createTextOutput(out).setMimeType(ContentService.MimeType.JSON);
}

/* Detalle de UN pedido para quien tiene su número (sin celular ni dirección completa). */
function detallePedido(idRaw) {
  const id = String(idRaw).trim().toUpperCase().slice(0, 40);
  if (!/^HHH-[0-9A-Z-]+$/.test(id)) return { ok: false, error: "número inválido" };
  const sh = libro().getSheetByName("Pedidos");
  const n = sh.getLastRow() - 1;
  if (n < 1) return { ok: true, pedido: null };
  const ids = sh.getRange(2, 1, n, 1).getValues();
  const i = ids.findIndex(([v]) => String(v).toUpperCase() === id);
  if (i < 0) return { ok: true, pedido: null };
  const f = sh.getRange(i + 2, 1, 1, COLUMNAS.length).getValues()[0];
  const fecha = (v) => (v instanceof Date ? v.toISOString() : "");
  return {
    ok: true,
    pedido: {
      id: String(f[0]), fecha: fecha(f[1]), cliente: String(f[3] || "").split(" ")[0],
      archivos: String(f[5] || ""), material: String(f[7] || ""), placas: Number(f[8]) || 0,
      peso: Number(f[9]) || 0, horas: Number(f[10]) || 0, total: Number(f[12]) || 0,
      estado: String(f[14] || ""), abonado: Number(f[15]) || 0, saldo: Number(f[16]) || 0,
      entrega: fecha(f[17]), tipoEntrega: String(f[29] || ""), ciudad: String(f[30] || ""),
    },
  };
}

/* ---------- archivo del cliente (.zip) ---------- */
function guardarArchivo(d) {
  if (!d.data || !/\.zip$/i.test(d.name || "")) throw new Error("Archivo no válido");
  const bytes = Utilities.base64Decode(d.data);
  if (bytes.length > MAX_MB * 1024 * 1024) throw new Error("Archivo demasiado grande");
  const nombre = String(d.name).replace(/[^\w.\- ()]/g, "_").slice(0, 120);
  const archivo = carpetaDelMes().createFile(Utilities.newBlob(bytes, "application/zip", nombre));
  archivo.setDescription(String(d.resumen || "").slice(0, 4000));
  return { ok: true, url: archivo.getUrl() };
}

/* ---------- fila en la hoja de control ---------- */
function registrarPedido(d) {
  // texto seguro: sin fórmulas inyectadas
  const t = (v, n) => {
    const s = String(v == null ? "" : v).slice(0, n || 200);
    return /^[=+\-@]/.test(s) ? "'" + s : s;
  };
  const num = (v) => Number(v) || 0;
  const fecha = new Date();
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = libro().getSheetByName("Pedidos");
    sh.appendRow([t(d.id, 40), fecha, Utilities.formatDate(fecha, "America/Bogota", "yyyy-MM"),
      t(d.cliente, 100), t(d.celular, 30), t(d.archivos, 300), t(d.url, 300), t(d.material, 200),
      num(d.placas), num(d.peso), num(d.horas), num(d.costo), num(d.total), "", "Cotización", 0, "",
      d.entrega ? new Date(d.entrega) : "",
      t(d.observaciones, 500), t(d.detalle, 4000),
      num(d.filamento), num(d.kwh), num(d.energia), num(d.maquina), num(d.minutos),
      num(d.manoObra), num(d.insumos), num(d.reserva), num(d.margen),
      t(d.tipoEntrega, 60), t(d.ciudad, 60), t(d.direccion, 300), num(d.envio)]);
    const r = sh.getLastRow();
    sh.getRange(r, 14).setFormula(`=M${r}-L${r}`); // utilidad
    sh.getRange(r, 17).setFormula(`=M${r}-P${r}`); // saldo
  } finally {
    lock.releaseLock();
  }
  if (AVISAR_POR_CORREO) {
    MailApp.sendEmail({
      to: Session.getEffectiveUser().getEmail(),
      subject: `🖨 Nuevo pedido ${d.id} · ${d.cliente || "sin nombre"} · $ ${num(d.total).toLocaleString("es-CO")}`,
      body: `${d.detalle || ""}\n\nControl de pedidos: ${libro().getUrl()}`,
    });
  }
  return { ok: true };
}

/* ---------- hoja de cálculo (se crea sola la primera vez) ---------- */
function libro() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty("HOJA_ID");
  if (id) {
    try { return SpreadsheetApp.openById(id); } catch (e) { /* la borraron: se crea de nuevo */ }
  }
  const ss = SpreadsheetApp.create(HOJA);
  DriveApp.getFileById(ss.getId()).moveTo(raiz());
  prepararLibro(ss);
  props.setProperty("HOJA_ID", ss.getId());
  return ss;
}

function prepararLibro(ss) {
  const sh = ss.getSheets()[0].setName("Pedidos");
  sh.getRange(1, 1, 1, COLUMNAS.length).setValues([COLUMNAS])
    .setFontWeight("bold").setBackground("#0f1116").setFontColor("#c6ff3d");
  sh.setFrozenRows(1);
  [130, 125, 70, 160, 110, 220, 170, 200, 60, 70, 60, 90, 90, 90, 120, 90, 90, 95, 240, 300, 95, 90, 90, 90, 110, 110, 90, 110, 90, 150, 130, 260, 90]
    .forEach((w, i) => sh.setColumnWidth(i + 1, w));
  formatoPedidos(sh);
  crearResumen(ss);
  crearGanancias(ss);
  crearTaller(ss);
}

function formatoPedidos(sh) {
  const filas = 2000;
  sh.getRange(2, 1, filas, 1).setNumberFormat("@");               // pedido
  sh.getRange(2, 2, filas, 1).setNumberFormat("dd/mm/yyyy hh:mm"); // fecha
  sh.getRange(2, 3, filas, 1).setNumberFormat("@");               // mes
  sh.getRange(2, 5, filas, 1).setNumberFormat("@");               // celular
  sh.getRange(2, 10, filas, 2).setNumberFormat("0.0");            // peso, horas
  ["L", "M", "N", "P", "Q"].forEach((c) => sh.getRange(`${c}2:${c}${filas + 1}`).setNumberFormat("$ #,##0"));
  sh.getRange(2, 18, filas, 1).setNumberFormat("dd/mm/yyyy");     // entrega
  ["U", "W", "X", "Z", "AA", "AB", "AC"].forEach((c) => sh.getRange(`${c}2:${c}${filas + 1}`).setNumberFormat("$ #,##0"));
  sh.getRange(`V2:V${filas + 1}`).setNumberFormat("0.00");        // kWh
  sh.getRange(`Y2:Y${filas + 1}`).setNumberFormat("0");           // minutos
  sh.getRange(1, 21, 1, 9).setBackground("#1b1f2a").setFontColor("#b9a8ff").setFontWeight("bold"); // bloque de costos
  sh.getRange(1, 30, 1, 4).setBackground("#10243a").setFontColor("#8cc8ff").setFontWeight("bold"); // bloque de entrega
  sh.getRange(`AG2:AG${filas + 1}`).setNumberFormat("$ #,##0");
  const rango = sh.getRange(2, 15, filas, 1);
  rango.setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(ESTADOS, true).setAllowInvalid(false).build());
  const color = { "Cotización": "#fff4c2", "En proceso": "#d9ecff", Imprimiendo: "#e6dcff", Listo: "#d8f5c8", Entregado: "#c8f0d8", "No concretado": "#e3e3e3" };
  sh.setConditionalFormatRules(Object.keys(color).map((k) =>
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo(k).setBackground(color[k]).setRanges([rango]).build()));
}

// Resumen por mes: ventas, costo y utilidad solo de pedidos confirmados; cotizaciones y % de cierre
function crearResumen(ss) {
  const rs = ss.insertSheet("Resumen");
  rs.getRange("A1:I1").setValues([["Mes", "Pedidos", "Ventas", "Costo", "Utilidad", "Cobrado", "Por cobrar", "Cotizaciones", "% cierre"]])
    .setFontWeight("bold").setBackground("#0f1116").setFontColor("#c6ff3d");
  const venta = NO_VENTA.map((e) => `Pedidos!$O$2:$O,"<>${e}"`).join(",");
  rs.getRange("A2").setFormula(`=IFERROR(SORT(UNIQUE(FILTER(Pedidos!C2:C,Pedidos!C2:C<>"")),1,FALSE),"")`);
  rs.getRange("B2").setFormula(`=ARRAYFORMULA(IF(A2:A="",,COUNTIFS(Pedidos!$C$2:$C,A2:A,${venta})))`);
  [["C", "M"], ["D", "L"], ["E", "N"], ["F", "P"], ["G", "Q"]].forEach(([dst, src]) =>
    rs.getRange(`${dst}2`).setFormula(`=ARRAYFORMULA(IF(A2:A="",,SUMIFS(Pedidos!$${src}$2:$${src},Pedidos!$C$2:$C,A2:A,${venta})))`));
  rs.getRange("H2").setFormula(`=ARRAYFORMULA(IF(A2:A="",,COUNTIFS(Pedidos!$C$2:$C,A2:A)))`);
  rs.getRange("I2").setFormula(`=ARRAYFORMULA(IF(A2:A="",,IFERROR(B2:B/H2:H,0)))`);
  rs.getRange("C2:G").setNumberFormat("$ #,##0");
  rs.getRange("I2:I").setNumberFormat("0%");
  rs.getRange("K1").setValue("Total general").setFontWeight("bold");
  const tot = [["Pedidos", `=COUNTIFS(Pedidos!A2:A,"<>",${venta})`, "0"], ["Ventas", `=SUMIFS(Pedidos!M2:M,${venta})`],
    ["Costo", `=SUMIFS(Pedidos!L2:L,${venta})`], ["Utilidad", `=SUMIFS(Pedidos!N2:N,${venta})`],
    ["Cobrado", `=SUMIFS(Pedidos!P2:P,${venta})`], ["Por cobrar", `=SUMIFS(Pedidos!Q2:Q,${venta})`],
    ["Cotizaciones", `=COUNTA(Pedidos!A2:A)`, "0"], ["% cierre", `=IFERROR(L2/L8,0)`, "0%"],
    ["", ""], ["GASTOS (confirmados)", ""],
    ["Filamento usado (g)", `=SUMIFS(Pedidos!J2:J,${venta})`, "#,##0"], ["Horas de impresión", `=SUMIFS(Pedidos!K2:K,${venta})`, "#,##0.0"],
    ["Costo filamento", `=SUMIFS(Pedidos!U2:U,${venta})`], ["Energía (kWh)", `=SUMIFS(Pedidos!V2:V,${venta})`, "#,##0.0"],
    ["Costo energía", `=SUMIFS(Pedidos!W2:W,${venta})`], ["Desgaste máquina", `=SUMIFS(Pedidos!X2:X,${venta})`],
    ["Mano de obra (h)", `=SUMIFS(Pedidos!Y2:Y,${venta})/60`, "#,##0.0"], ["Mano de obra ($)", `=SUMIFS(Pedidos!Z2:Z,${venta})`],
    ["Insumos", `=SUMIFS(Pedidos!AA2:AA,${venta})`], ["Reserva fallos", `=SUMIFS(Pedidos!AB2:AB,${venta})`],
    ["Envíos (pagados a transportadora)", `=SUMIFS(Pedidos!AG2:AG,${venta})`]];
  tot.forEach(([k, f, fmt], i) => {
    rs.getRange(i + 2, 11).setValue(k);
    if (f) rs.getRange(i + 2, 12).setFormula(f).setNumberFormat(fmt || "$ #,##0");
    if (!f && k) rs.getRange(i + 2, 11).setFontWeight("bold");
  });
  rs.setFrozenRows(1);
  rs.setColumnWidths(1, 9, 105);
  rs.setColumnWidth(11, 110);
  rs.setColumnWidth(12, 120);
}

/* Vista fácil para quien no sabe contabilidad: cuánto vendiste, cuánto gastaste y cuánto ganaste,
   por pedido y por producto. Solo cuenta pedidos confirmados (de "En proceso" en adelante). */
function crearGanancias(ss) {
  const g = ss.insertSheet("Ganancias");
  const venta = `Pedidos!O2:O<>"Cotización",Pedidos!O2:O<>"No concretado"`;
  const mes = `Pedidos!C2:C=TEXT(TODAY(),"yyyy-mm")`;
  const sumaMes = (col) => `=SUM(IFERROR(FILTER(${col},Pedidos!A2:A<>"",${mes},${venta}),0))`;
  g.getRange("A1").setValue("💰 ¿Cuánto estoy ganando?").setFontSize(16).setFontWeight("bold");
  g.getRange("A2").setValue("Solo cuenta pedidos confirmados (de «En proceso» en adelante). Las cotizaciones y los no concretados no suman.")
    .setFontColor("#666666");
  const tarjetas = [
    ["Vendiste este mes", sumaMes("Pedidos!M2:M"), "Lo que te pagan los clientes"],
    ["Gastaste este mes", sumaMes("Pedidos!L2:L"), "Filamento, luz, máquina, tu trabajo y reserva por fallos"],
    ["Ganancia neta del mes", sumaMes("Pedidos!M2:M-Pedidos!L2:L"), "Vendido menos gastado: lo que gana el negocio"],
    ["Te queda a ti este mes", sumaMes("Pedidos!M2:M-Pedidos!L2:L+Pedidos!Z2:Z"), "Ganancia neta + el pago por tu trabajo (si lo haces tú)"],
  ];
  tarjetas.forEach(([t, f, nota], i) => {
    const col = 1 + i * 3;
    g.getRange(3, col).setValue(t).setFontWeight("bold").setFontColor("#555555");
    g.getRange(4, col).setFormula(f).setNumberFormat("$ #,##0").setFontSize(18).setFontWeight("bold")
      .setFontColor(i === 1 ? "#c0392b" : "#1e8449");
    g.getRange(5, col).setValue(nota).setFontSize(8).setFontColor("#888888");
  });

  const cab = ["Pedido", "Fecha", "Cliente", "Producto", "Estado", "Vendido en", "Filamento", "Luz", "Máquina",
    "Tu trabajo", "Otros (insumos, envío y reserva)", "Gastos totales", "Ganancia neta", "% de ganancia", "Te queda a ti"];
  g.getRange(7, 1, 1, cab.length).setValues([cab]).setFontWeight("bold").setBackground("#0f1116").setFontColor("#c6ff3d");
  g.getRange("A8").setFormula(`=IFERROR(SORT(FILTER({Pedidos!A2:A,Pedidos!B2:B,Pedidos!D2:D,Pedidos!F2:F,Pedidos!O2:O,` +
    `Pedidos!M2:M,Pedidos!U2:U,Pedidos!W2:W,Pedidos!X2:X,Pedidos!Z2:Z,Pedidos!AA2:AA+Pedidos!AB2:AB+Pedidos!AG2:AG,Pedidos!L2:L,` +
    `Pedidos!M2:M-Pedidos!L2:L,IFERROR((Pedidos!M2:M-Pedidos!L2:L)/Pedidos!M2:M,0),Pedidos!M2:M-Pedidos!L2:L+Pedidos!Z2:Z},` +
    `Pedidos!A2:A<>"",${venta}),2,FALSE),"Aún no hay pedidos confirmados")`);
  g.getRange("B8:B").setNumberFormat("dd/mm/yyyy");
  g.getRange("F8:M").setNumberFormat("$ #,##0");
  g.getRange("N8:N").setNumberFormat("0%");
  g.getRange("O8:O").setNumberFormat("$ #,##0");
  g.getRange("L7:L").setFontColor("#c0392b");
  g.getRange("M7:M").setFontColor("#1e8449").setFontWeight("bold");
  g.setFrozenRows(7);
  [130, 90, 140, 220, 100, 100, 90, 70, 80, 90, 120, 110, 110, 90, 110].forEach((w, i) => g.setColumnWidth(i + 1, w));

  // por producto: qué te deja más plata
  const pp = ss.insertSheet("Por producto");
  pp.getRange("A1").setValue("📦 ¿Qué producto me deja más?").setFontSize(16).setFontWeight("bold");
  pp.getRange("A2").setValue("Suma de todos los pedidos confirmados de cada producto, de mayor a menor ganancia.").setFontColor("#666666");
  pp.getRange("A4").setFormula(`=IFERROR(QUERY(Ganancias!A8:O,"select D, count(D), sum(F), sum(L), sum(M), sum(O) where D is not null and D <> '' group by D order by sum(M) desc label D 'Producto', count(D) 'Veces vendido', sum(F) 'Vendido en', sum(L) 'Gastos', sum(M) 'Ganancia neta', sum(O) 'Te queda a ti'",0),"Aún no hay pedidos confirmados")`);
  pp.getRange("A4:F4").setFontWeight("bold").setBackground("#0f1116").setFontColor("#c6ff3d");
  pp.getRange("C5:F").setNumberFormat("$ #,##0");
  pp.setFrozenRows(4);
  [260, 110, 110, 110, 120, 120].forEach((w, i) => pp.setColumnWidth(i + 1, w));
}

// Pasa una hoja ya creada al flujo nuevo de estados (ejecútala una vez si ya tenías la hoja).
function actualizarHoja() {
  const ss = libro();
  const sh = ss.getSheetByName("Pedidos");
  const cambio = { Nuevo: "Cotización", Confirmado: "En proceso", Cancelado: "No concretado" };
  const n = sh.getLastRow() - 1;
  sh.getRange(2, 15, Math.max(n, 1), 1).clearDataValidations();
  if (n > 0) {
    const r = sh.getRange(2, 15, n, 1);
    r.setValues(r.getValues().map(([v]) => [cambio[v] || v]));
  }
  sh.getRange(1, 1, 1, COLUMNAS.length).setValues([COLUMNAS])
    .setFontWeight("bold").setBackground("#0f1116").setFontColor("#c6ff3d");
  formatoPedidos(sh);
  ["Resumen", "Ganancias", "Por producto"].forEach((n) => { const v = ss.getSheetByName(n); if (v) ss.deleteSheet(v); });
  crearResumen(ss);
  crearGanancias(ss);
  activarActualizacion();
  CacheService.getScriptCache().remove("cola");
  Logger.log("Hoja actualizada: " + ss.getUrl());
}

/* ---------- estado del taller e inventario: los editas tú y la página los muestra ---------- */
const ESTADOS_TALLER = ["Funcionando", "En mantenimiento", "Vacaciones"];
// [material, color, código de color, recargo %, disponible] — lista inicial (la de config.js)
const INVENTARIO_INICIAL = [
  ["PLA", "Negro", "#1b1b1f", 0, true],
  ["PLA", "Blanco", "#f2f2ee", 0, true],
  ["PLA", "Gris", "#8a8d93", 0, true],
  ["PLA", "Rojo", "#d7263d", 0, true],
  ["PLA", "Azul", "#1f6feb", 0, true],
  ["PLA", "Verde lima", "#b6f23a", 5, true],
  ["PLA", "Naranja", "#ff7a1a", 0, true],
  ["PLA", "Silk dorado", "#d4a72c", 25, true],
  ["PLA", "Silk plata", "#c9ccd1", 25, true],
  ["PLA", "Brilla en la oscuridad", "#c8f7c5", 35, true],
  ["PETG", "Negro", "#1b1b1f", 0, true],
  ["PETG", "Blanco", "#f2f2ee", 0, true],
  ["PETG", "Transparente", "#cfe8ff", 5, true],
  ["PETG", "Azul", "#1f6feb", 0, true],
  ["PETG", "Rojo", "#d7263d", 0, true],
  ["TPU", "Negro", "#1b1b1f", 0, true],
  ["TPU", "Transparente", "#e3f1ff", 0, true],
  ["TPU", "Rojo", "#d7263d", 0, true],
  ["ASA", "Negro", "#1b1b1f", 0, true],
  ["ASA", "Blanco", "#f2f2ee", 0, true],
  ["ASA", "Gris", "#8a8d93", 0, true]
];

// Crea las hojas "Taller" e "Inventario" en tu hoja de control (ejecútala una vez si ya la tenías).
function activarTaller() {
  const ss = libro();
  crearTaller(ss);
  activarActualizacion();
  CacheService.getScriptCache().remove("cola");
  Logger.log("Listo: " + ss.getUrl());
}

function crearTaller(ss) {
  const lista = (v) => SpreadsheetApp.newDataValidation().requireValueInList(v, true).build();
  if (!ss.getSheetByName("Taller")) {
    const sh = ss.insertSheet("Taller", 1);
    sh.getRange("A1").setValue("Estado del taller · lo que pongas aquí se ve en la página").setFontWeight("bold").setFontSize(13);
    sh.getRange(3, 1, 4, 2).setValues([
      ["Estado de la impresora", "Funcionando"],
      ["¿Recibimos pedidos?", "Sí"],
      ["Imprimimos a partir de (opcional)", ""],
      ["Mensaje para los clientes (opcional)", ""],
    ]);
    sh.getRange("A3:A6").setFontWeight("bold");
    sh.getRange("B3").setDataValidation(lista(ESTADOS_TALLER));
    sh.getRange("B4").setDataValidation(lista(["Sí", "No"]));
    sh.getRange("B5").setDataValidation(SpreadsheetApp.newDataValidation().requireDate().build()).setNumberFormat("dd/mm/yyyy");
    sh.getRange("B3:B6").setBackground("#f3f8e6");
    sh.setColumnWidth(1, 270);
    sh.setColumnWidth(2, 420);
    sh.getRange(8, 1, 3, 1).setValues([
      ["Vacaciones: Estado «Vacaciones» y la fecha en que vuelves a imprimir. Los pedidos se reciben y la entrega se cuenta desde esa fecha."],
      ["Mantenimiento: Estado «En mantenimiento» (con fecha si sabes cuándo termina)."],
      ["¿Sin pedidos por un tiempo? «¿Recibimos pedidos?» en No: el botón de pedir se desactiva."],
    ]).setFontColor("#777");
  }
  if (!ss.getSheetByName("Inventario")) {
    const inv = ss.insertSheet("Inventario", 2);
    inv.getRange(1, 1, 1, 5).setValues([["Material", "Color", "Código de color", "Recargo %", "Disponible"]])
      .setFontWeight("bold").setBackground("#0f1116").setFontColor("#c6ff3d");
    inv.setFrozenRows(1);
    inv.getRange(2, 1, INVENTARIO_INICIAL.length, 5).setValues(INVENTARIO_INICIAL);
    inv.getRange(2, 5, 300, 1).insertCheckboxes();
    inv.getRange(2, 1, 300, 1).setDataValidation(lista(["PLA", "PETG", "TPU", "ASA"]));
    inv.getRange("C1").setNote("Formato #RRGGBB, por ejemplo #ff7a1a. Si lo dejas vacío se usa el color que ya conoce la página.");
    inv.getRange("D1").setNote("0 = color normal. 25 = el filamento cuesta 25 % más (silk, brilla en la oscuridad…).");
    inv.getRange("E1").setNote("Desmárcalo cuando se acabe: en la página sale como agotado.");
    [90, 200, 130, 100, 100].forEach((w, i) => inv.setColumnWidth(i + 1, w));
  }
}

// Lo que la página necesita saber: estado, fecha de inicio, mensaje y colores disponibles
function leerTaller() {
  const ss = libro();
  const t = { estado: "Funcionando", recibe: true, desde: "", mensaje: "", inventario: [] };
  const sh = ss.getSheetByName("Taller");
  if (sh) {
    const [estado, recibe, desde, mensaje] = sh.getRange("B3:B6").getValues().map((r) => r[0]);
    if (ESTADOS_TALLER.indexOf(estado) >= 0) t.estado = estado;
    t.recibe = String(recibe).trim().toLowerCase() !== "no";
    if (desde instanceof Date) t.desde = Utilities.formatDate(desde, ss.getSpreadsheetTimeZone(), "yyyy-MM-dd");
    t.mensaje = String(mensaje || "").slice(0, 300);
  }
  const inv = ss.getSheetByName("Inventario");
  if (inv && inv.getLastRow() > 1) {
    t.inventario = inv.getRange(2, 1, inv.getLastRow() - 1, 5).getValues()
      .filter((r) => r[0] && r[1])
      .map(([m, c, h, r, d]) => ({
        material: String(m).trim(), color: String(c).trim().slice(0, 40),
        hex: /^#[0-9a-f]{6}$/i.test(String(h).trim()) ? String(h).trim() : "",
        recargo: Number(r) || 0, disponible: d === true,
      }));
  }
  return t;
}

/* ---------- carpetas ---------- */
function raiz() {
  return buscarOCrear(DriveApp.getRootFolder(), CARPETA);
}

// HHH3D - Pedidos / AAAA-MM
function carpetaDelMes() {
  return buscarOCrear(raiz(), Utilities.formatDate(new Date(), "America/Bogota", "yyyy-MM"));
}

function buscarOCrear(padre, nombre) {
  const it = padre.getFoldersByName(nombre);
  return it.hasNext() ? it.next() : padre.createFolder(nombre);
}

/* ---------- utilidades para ejecutar a mano (menú ▶ Ejecutar) ---------- */

// Crea la hoja de control y pide los permisos. Ejecútala una vez después de pegar el código.
function crearHoja() {
  Logger.log("Hoja de control: " + libro().getUrl());
}

// Cada vez que editas la hoja (p. ej. cambias un Estado) la página lo ve al instante.
function alEditarHoja() {
  CacheService.getScriptCache().remove("cola");
}

// Ejecútala UNA vez: instala el aviso de edición de la hoja (también la llama actualizarHoja).
function activarActualizacion() {
  ScriptApp.getProjectTriggers()
    .filter((t) => t.getHandlerFunction() === "alEditarHoja")
    .forEach((t) => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger("alEditarHoja").forSpreadsheet(libro()).onEdit().create();
  Logger.log("Listo: los cambios de la hoja se ven al instante en la página.");
}

// Activa la limpieza diaria de los .zip de más de BORRAR_DESPUES_DIAS días (la hoja se conserva).
function activarLimpieza() {
  ScriptApp.getProjectTriggers()
    .filter((t) => t.getHandlerFunction() === "limpiarPedidosViejos")
    .forEach((t) => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger("limpiarPedidosViejos").timeBased().everyDays(1).atHour(3).create();
}

function limpiarPedidosViejos() {
  const limite = Date.now() - BORRAR_DESPUES_DIAS * 864e5;
  const meses = raiz().getFolders();
  while (meses.hasNext()) {
    const mes = meses.next();
    const archivos = mes.getFiles();
    while (archivos.hasNext()) {
      const f = archivos.next();
      if (f.getDateCreated().getTime() < limite) f.setTrashed(true);
    }
    if (!mes.getFiles().hasNext() && !mes.getFolders().hasNext()) mes.setTrashed(true);
  }
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
