/**
 * HHH3D — recibe los archivos de los pedidos y los guarda en TU Google Drive.
 *
 * Cómo instalarlo (una sola vez):
 *  1. Entra a https://script.google.com con tu cuenta de Google → "Nuevo proyecto".
 *  2. Borra lo que aparece y pega TODO este archivo. Guarda (Ctrl + S).
 *  3. Botón "Implementar" → "Nueva implementación" → tipo "Aplicación web".
 *       Ejecutar como: Yo
 *       Quién tiene acceso: Cualquier usuario
 *     Implementar → autoriza con tu cuenta (Configuración avanzada → Ir al proyecto).
 *  4. Copia la "URL de la aplicación web" (termina en /exec) y pégala en config.js
 *     en  subida: { url: "…/exec" }.
 *
 * Los archivos quedan en la carpeta "HHH3D - Pedidos" de tu Drive y NO se comparten:
 * el enlace que llega por WhatsApp solo lo puede abrir tu cuenta.
 */
const CARPETA = "HHH3D - Pedidos";
const MAX_MB = 30;

function doPost(e) {
  try {
    const d = JSON.parse(e.postData.contents);
    if (!d.data || !/\.zip$/i.test(d.name || "")) throw new Error("Archivo no válido");
    const bytes = Utilities.base64Decode(d.data);
    if (bytes.length > MAX_MB * 1024 * 1024) throw new Error("Archivo demasiado grande");
    const nombre = String(d.name).replace(/[^\w.\- ()]/g, "_").slice(0, 120);
    const archivo = carpeta().createFile(Utilities.newBlob(bytes, "application/zip", nombre));
    archivo.setDescription(String(d.resumen || "").slice(0, 2000));
    return json({ ok: true, url: archivo.getUrl() });
  } catch (err) {
    return json({ ok: false, error: String((err && err.message) || err) });
  }
}

function carpeta() {
  const it = DriveApp.getFoldersByName(CARPETA);
  return it.hasNext() ? it.next() : DriveApp.createFolder(CARPETA);
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
