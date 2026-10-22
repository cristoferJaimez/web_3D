/**
 * HHH3D — recibe los archivos de los pedidos y los guarda en TU Google Drive.
 *
 * Orden en Drive:
 *   HHH3D - Pedidos/
 *     2026-10/
 *       20261022-1530-separador-hongos.zip   (archivos del cliente + pedido.txt)
 *     2026-11/ …
 * Por cada pedido te llega un correo a tu Gmail con el resumen y el enlace.
 *
 * Instalación: ver los pasos en el README (sección "Recibir los archivos de los pedidos").
 * Los archivos NO se comparten: el enlace solo lo puede abrir tu cuenta.
 */
const CARPETA = "HHH3D - Pedidos";
const MAX_MB = 30;
const AVISAR_POR_CORREO = true;   // correo a tu Gmail con cada pedido
const BORRAR_DESPUES_DIAS = 90;   // limpieza automática (ver activarLimpieza)

function doPost(e) {
  try {
    const d = JSON.parse(e.postData.contents);
    if (!d.data || !/\.zip$/i.test(d.name || "")) throw new Error("Archivo no válido");
    const bytes = Utilities.base64Decode(d.data);
    if (bytes.length > MAX_MB * 1024 * 1024) throw new Error("Archivo demasiado grande");

    const nombre = String(d.name).replace(/[^\w.\- ()]/g, "_").slice(0, 120);
    const resumen = String(d.resumen || "").slice(0, 4000);
    const archivo = carpetaDelMes().createFile(Utilities.newBlob(bytes, "application/zip", nombre));
    archivo.setDescription(resumen);

    if (AVISAR_POR_CORREO) {
      const mb = (bytes.length / 1048576).toFixed(1);
      MailApp.sendEmail({
        to: Session.getEffectiveUser().getEmail(),
        subject: `🖨 Nuevo pedido HHH3D · ${nombre}`,
        body: `${resumen}\n\nArchivo (${mb} MB): ${archivo.getUrl()}`,
      });
    }
    return json({ ok: true, url: archivo.getUrl() });
  } catch (err) {
    return json({ ok: false, error: String((err && err.message) || err) });
  }
}

// HHH3D - Pedidos / AAAA-MM
function carpetaDelMes() {
  const raiz = buscarOCrear(DriveApp.getRootFolder(), CARPETA);
  const mes = Utilities.formatDate(new Date(), "America/Bogota", "yyyy-MM");
  return buscarOCrear(raiz, mes);
}

function buscarOCrear(padre, nombre) {
  const it = padre.getFoldersByName(nombre);
  return it.hasNext() ? it.next() : padre.createFolder(nombre);
}

// Manda a la papelera los pedidos de más de BORRAR_DESPUES_DIAS días (Drive los borra a los 30 días).
function limpiarPedidosViejos() {
  const it = DriveApp.getRootFolder().getFoldersByName(CARPETA);
  if (!it.hasNext()) return;
  const limite = Date.now() - BORRAR_DESPUES_DIAS * 864e5;
  const meses = it.next().getFolders();
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

// Ejecútala UNA vez (menú ▶ Ejecutar) para que la limpieza corra sola cada día.
function activarLimpieza() {
  ScriptApp.getProjectTriggers()
    .filter((t) => t.getHandlerFunction() === "limpiarPedidosViejos")
    .forEach((t) => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger("limpiarPedidosViejos").timeBased().everyDays(1).atHour(3).create();
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
