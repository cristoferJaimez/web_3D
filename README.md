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

## Precios automáticos

- **Dólar (TRM)**: cada visitante consulta la TRM oficial (datos.gov.co).
- **Filamento**: la tarea diaria lee los enlaces de tu proveedor en `fuentes` de cada material
  (y MercadoLibre si configuras `ML_CLIENT_ID` y `ML_CLIENT_SECRET` como secretos del repositorio).
  Si no encuentra nada, ajusta el precio base según la TRM.
- **Luz**: la tarifa de tu factura en `energia.precio_kwh`, ajustada por el tiempo transcurrido.
  Actualízala cuando llegue la factura (Enel no publica la tarifa en un formato automático).
- **LED**: precios de referencia del mercado colombiano en `led`; revísalos con tu proveedor.
