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
const ESTADOS = ["Nuevo", "Confirmado", "Imprimiendo", "Listo", "Entregado", "Cancelado"];
const COLUMNAS = ["Pedido", "Fecha", "Mes", "Cliente", "Celular", "Archivo(s)", "Enlace archivo",
  "Material / color", "Placas", "Peso (g)", "Horas", "Costo", "Total", "Utilidad", "Estado",
  "Abonado", "Saldo", "Entrega", "Observaciones", "Detalle"];

function doPost(e) {
  try {
    const d = JSON.parse(e.postData.contents);
    return json(d.tipo === "pedido" ? registrarPedido(d) : guardarArchivo(d));
  } catch (err) {
    return json({ ok: false, error: String((err && err.message) || err) });
  }
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
      num(d.placas), num(d.peso), num(d.horas), num(d.costo), num(d.total), "", "Nuevo", 0, "", "",
      t(d.observaciones, 500), t(d.detalle, 4000)]);
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
  const filas = 2000;
  sh.getRange(2, 1, filas, 1).setNumberFormat("@");               // pedido
  sh.getRange(2, 2, filas, 1).setNumberFormat("dd/mm/yyyy hh:mm"); // fecha
  sh.getRange(2, 3, filas, 1).setNumberFormat("@");               // mes
  sh.getRange(2, 5, filas, 1).setNumberFormat("@");               // celular
  sh.getRange(2, 10, filas, 2).setNumberFormat("0.0");            // peso, horas
  ["L", "M", "N", "P", "Q"].forEach((c) => sh.getRange(`${c}2:${c}${filas + 1}`).setNumberFormat("$ #,##0"));
  sh.getRange(2, 18, filas, 1).setNumberFormat("dd/mm/yyyy");     // entrega
  sh.getRange(2, 15, filas, 1).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(ESTADOS, true).setAllowInvalid(false).build());
  // colores por estado
  const rango = sh.getRange(2, 15, filas, 1);
  const color = { Nuevo: "#fff4c2", Confirmado: "#d9ecff", Imprimiendo: "#e6dcff", Listo: "#d8f5c8", Entregado: "#c8f0d8", Cancelado: "#f6d0d0" };
  sh.setConditionalFormatRules(Object.keys(color).map((k) =>
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo(k).setBackground(color[k]).setRanges([rango]).build()));
  [130, 125, 70, 160, 110, 220, 170, 200, 60, 70, 60, 90, 90, 90, 110, 90, 90, 95, 240, 300]
    .forEach((w, i) => sh.setColumnWidth(i + 1, w));

  // resumen por mes (sin pedidos cancelados)
  const rs = ss.insertSheet("Resumen");
  rs.getRange("A1:G1").setValues([["Mes", "Pedidos", "Ventas", "Costo", "Utilidad", "Cobrado", "Por cobrar"]])
    .setFontWeight("bold").setBackground("#0f1116").setFontColor("#c6ff3d");
  const ok = `Pedidos!$O$2:$O,"<>Cancelado"`;
  rs.getRange("A2").setFormula(`=IFERROR(SORT(UNIQUE(FILTER(Pedidos!C2:C,Pedidos!C2:C<>"",Pedidos!O2:O<>"Cancelado")),1,FALSE),"")`);
  rs.getRange("B2").setFormula(`=ARRAYFORMULA(IF(A2:A="",,COUNTIFS(Pedidos!$C$2:$C,A2:A,${ok})))`);
  [["C", "M"], ["D", "L"], ["E", "N"], ["F", "P"], ["G", "Q"]].forEach(([dst, src]) =>
    rs.getRange(`${dst}2`).setFormula(`=ARRAYFORMULA(IF(A2:A="",,SUMIFS(Pedidos!$${src}$2:$${src},Pedidos!$C$2:$C,A2:A,${ok})))`));
  rs.getRange("C2:G").setNumberFormat("$ #,##0");
  rs.getRange("I1:J1").setValues([["Total general", ""]]).setFontWeight("bold");
  const tot = [["Pedidos", `=COUNTIFS(Pedidos!A2:A,"<>",${ok})`], ["Ventas", `=SUMIFS(Pedidos!M2:M,${ok})`],
    ["Costo", `=SUMIFS(Pedidos!L2:L,${ok})`], ["Utilidad", `=SUMIFS(Pedidos!N2:N,${ok})`],
    ["Cobrado", `=SUMIFS(Pedidos!P2:P,${ok})`], ["Por cobrar", `=SUMIFS(Pedidos!Q2:Q,${ok})`]];
  tot.forEach(([k, f], i) => {
    rs.getRange(i + 2, 9).setValue(k);
    rs.getRange(i + 2, 10).setFormula(f).setNumberFormat(i ? "$ #,##0" : "0");
  });
  rs.setFrozenRows(1);
  rs.setColumnWidths(1, 7, 110);
  rs.setColumnWidth(9, 110);
  rs.setColumnWidth(10, 120);
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
