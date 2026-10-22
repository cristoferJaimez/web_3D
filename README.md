# HHH3D — impresión 3D a pedido

Sitio estático (HTML + CSS + JavaScript + Three.js) publicado con GitHub Pages. No necesita instalación ni compilación.

## Qué hace

- **Cotizador**: el cliente sube un STL, varios STL o un 3MF (incluidos proyectos de Bambu Studio con varias placas), lo ve en 3D sobre la Bambu Lab A1 y obtiene peso, tiempo y precio por placa.
- Piezas que no caben se dividen en placas; varias piezas sueltas se acomodan enteras.
- Boquilla, calidad, relleno, tamaño, soportes, cantidad, multicolor por pieza (AMS lite), pintado a mano y letreros con LED.
- Pedido por WhatsApp con una ficha ilustrada de la cotización.
- Catálogo de trabajos con fotos y videos.
- Precios en COP o USD con la TRM oficial del día.

## Probar en tu computador

```bash
npx http-server -p 8765 -c-1
```

y abre http://localhost:8765

## Modo taller

Agrega `?taller` a la dirección (por ejemplo `https://cristoferjaimez.github.io/web_3D/?taller`) para ver los costos internos:
desglose completo, margen, TRM, tarifa de luz y precio por kilo. El cliente no ve esa información,
pero no es secreta: cualquiera que conozca la dirección puede verla.

## Archivos

| Archivo | Para qué |
|---|---|
| `config.js` | **Lo que tienes que editar**: WhatsApp, precios, impresora, márgenes, LED, catálogo |
| `trabajos/` | Fotos y videos de tus trabajos (ver `trabajos/LEEME.md`) |
| `precios.json` | Lo genera la tarea diaria (TRM y filamento). No lo edites a mano |
| `scripts/actualizar-precios.mjs` | Script que actualiza `precios.json` |
| `.github/workflows/precios.yml` | Tarea diaria de GitHub Actions |
| `index.html`, `styles.css`, `app.js` | La página |
| `parser3mf.js`, `worker3mf.js` | Lector de archivos 3MF |

## Recibir los archivos de los pedidos en tu Google Drive

WhatsApp no permite que una página adjunte archivos. Para que el STL/3MF del cliente te llegue solo:

1. Entra a https://script.google.com con tu cuenta → **Nuevo proyecto**.
2. Borra lo que aparece y pega todo el contenido de `apps-script/Code.gs`. Guarda.
3. **Implementar → Nueva implementación → Aplicación web**. Ejecutar como: **Yo**. Acceso: **Cualquier usuario**.
4. Autoriza el acceso (Configuración avanzada → Ir al proyecto) y copia la **URL de la aplicación web** (termina en `/exec`).
5. Pégala en `config.js` → `subida.url` y sube el cambio.

Cada pedido llega como un `.zip` (archivos del cliente + `pedido.txt`) en la carpeta **HHH3D - Pedidos** de tu Drive,
y el mensaje de WhatsApp trae el enlace. Los archivos no se comparten: solo tu cuenta puede abrirlos.
Mientras `subida.url` esté vacío, la página le pide al cliente adjuntar el archivo en el chat.

## Precios automáticos

- **Dólar (TRM)**: cada visitante consulta la TRM oficial (datos.gov.co).
- **Filamento**: la tarea diaria lee los enlaces de tu proveedor en `fuentes` de cada material
  (y MercadoLibre si configuras `ML_CLIENT_ID` y `ML_CLIENT_SECRET` como secretos del repositorio).
  Si no encuentra nada, ajusta el precio base según la TRM.
- **Luz**: la tarifa de tu factura en `energia.precio_kwh`, ajustada por el tiempo transcurrido.
  Actualízala cuando llegue la factura (Enel no publica la tarifa en un formato automático).
- **LED**: precios de referencia del mercado colombiano en `led`; revísalos con tu proveedor.
