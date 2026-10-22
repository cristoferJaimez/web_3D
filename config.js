/* ==========================================================================
   CONFIGURACIÓN DEL NEGOCIO — edita SOLO este archivo para cambiar precios.
   Todos los valores en pesos colombianos (COP) salvo que se indique.
   ========================================================================== */
window.CONFIG = {
  negocio: {
    nombre: "HHH3D",
    eslogan: "Impresión 3D a pedido en Colombia",
    ciudad: "Bogotá, Colombia",
    whatsapp: "573133361042",          // con indicativo 57, sin + ni espacios
    instagram: "hhh.3d.laminador",
    email: "jaimez07788@gmail.com",
  },

  // Fecha en que revisaste los precios por última vez (se muestra en la web)
  precios_revisados: "2026-10-21",

  // Dólar: el filamento importado se ajusta solo cuando sube o baja la TRM.
  trm: {
    auto: true,               // consulta la TRM oficial (datos.gov.co) al cargar
    referencia: 3200,         // TRM del día en que anotaste los precios de filamento
    respaldo: 3200,           // se usa si no hay internet / falla la API
    peso_importado: 0.7,      // qué parte del precio depende del dólar (0 a 1)
  },

  energia: {
    // Enel Bogotá, estrato 3, pliego de agosto 2026:
    //   hasta 130 kWh/mes (subsistencia, con subsidio 15 %): $734 / kWh
    //   más de 130 kWh/mes: $863,6 / kWh  ← lo que cuesta cada kWh extra de la impresora
    // Enel no publica la tarifa en un formato que se pueda leer automáticamente:
    // cuando llegue tu factura, cambia estos dos valores.
    estrato: 3,
    precio_kwh: 864,
    revisada: "2026-08-01",   // fecha de esa tarifa
    alza_anual: 0.06,         // si no la actualizas, se ajusta sola ~6 % al año
    potencia_w: 100,          // Bambu Lab A1: ~100 W promedio imprimiendo PLA (cama a 65 °C)
  },

  maquina: {
    nombre: "Bambu Lab A1",
    temp_max_boquilla: 300,
    temp_max_cama: 100,
    costo: 2300000,           // lo que costó la impresora (ajústalo a lo que pagaste)
    vida_util_horas: 4000,    // horas de uso antes de reponerla
    mantenimiento_hora: 300,  // boquillas, PEI, correas… por hora
    volumen_mm: [256, 256, 256], // área de impresión de la A1
  },

  impresion: {
    flujo_max_mm3_s: 20,      // caudal máximo del hotend de la A1 (PLA)
    perimetros: 3,
    eficiencia: 0.55,         // aceleraciones, desplazamientos, retracciones
    seg_por_capa: 2,          // cambio de capa
    recargo_soportes: 0.15,   // +15 % de material y tiempo si lleva soportes
  },

  costos: {
    // Mano de obra: tu hora de trabajo. Referencia: salario mínimo 2026 = $1.750.905
    // (≈ $8.338/hora con jornada de 42 h). Trabajo técnico: 1,5 a 2 veces eso.
    mano_obra_hora: 15000,
    min_preparacion: 10,      // por placa: laminar, limpiar cama, arrancar y retirar la pieza
    min_soportes: 8,          // por placa con soportes: retirarlos y limpiar marcas
    min_ensamble: 15,         // por unión cuando la pieza se divide: pegar y lijar
    insumos_ensamble: 800,    // pegamento por unión
    margen_fallos: 0.10,      // reserva por impresiones fallidas
    // tu utilidad sobre el costo. Mercado colombiano 2026: se cobra entre 1,4 y 2 veces el costo
    // (piezas terminadas desde ~$25.000). 0.80 = precio 1,8 veces el costo.
    margen_ganancia: 0.80,
    pedido_minimo: 20000,     // ningún pedido por debajo de esto
    redondeo: 500,            // redondear el total a múltiplos de…
  },

  // Boquillas que tienes para la A1. capas = altura de capa para [Rápida, Estándar, Fina]
  // velocidad = velocidad media real con esa boquilla (mm/s)
  boquillas: [
    { d: 0.2, velocidad: 70,  capas: [0.14, 0.10, 0.06] },
    { d: 0.4, velocidad: 120, capas: [0.28, 0.20, 0.12], defecto: true },
    { d: 0.6, velocidad: 110, capas: [0.42, 0.30, 0.18] },
    { d: 0.8, velocidad: 90,  capas: [0.56, 0.40, 0.24] },
  ],
  calidades: ["Rápida", "Estándar", "Fina"],

  // Acabados: un color, un color distinto por placa, o pintado a mano.
  // La pintura se cobra por superficie de la pieza (cada 100 cm²).
  // Multicolor: cada pieza en su propio filamento.
  // Con AMS lite la A1 cambia de color sola dentro de la misma placa, pero en cada cambio
  // bota filamento (purga) y pierde tiempo. Sin AMS, cada color va en una placa aparte.
  multicolor: {
    ams: true,                // ¿tienes AMS lite?
    max_colores: 4,           // ranuras del AMS lite
    purga_g_por_cambio: 0.5,  // filamento purgado por cada cambio de color (PLA, A1)
    seg_por_cambio: 50,       // lo que tarda cada cambio de color
    min_por_color_extra: 3,   // tu tiempo por cada color adicional: poner el carrete y configurarlo
  },

  // Tiempos de entrega (cola del taller leída de tu hoja de Google)
  produccion: {
    horas_por_dia: 14,        // horas que imprime la A1 en un día normal
    margen_fallas: 0.20,      // +20 % de tiempo por reimpresiones y ajustes
    dias_extra: 1,            // acabado, empaque y despacho
  },

  // Archivos de los pedidos: se guardan comprimidos en TU Google Drive (privados).
  // Pega aquí la URL de tu Apps Script (ver apps-script/Code.gs). Vacío = el cliente
  // adjunta el archivo a mano en WhatsApp.
  subida: {
    url: "https://script.google.com/macros/s/AKfycbyDN7KZmPw9pIS7g0RNbFHdlKwXB9wSpQKmwU8S_9RtJqNHeHy-hAHiXTBtt3JovRi7/exec",
    max_mb: 30,               // tamaño máximo del .zip que se sube a Drive; si es más grande, se adjunta en WhatsApp
    archivo_max_mb: 100,      // tamaño máximo de los archivos que acepta el cotizador (STL/3MF, sumados)
  },

  // Letreros con iluminación LED. Precios reales en Colombia (octubre 2026, IVA incluido):
  //   tira blanca 12 V: rollo 5 m $30.500 (Ecoled) → ~$6.100/m
  //   tira RGB 12 V: rollo 5 m $15.000–21.000 (MercadoLibre) → ~$4.200/m
  //   neón flex 12 V: $7.500/m (Fervicom Bogotá)
  //   adaptador 12 V 2 A: $14.300 · controlador RGB con control IR: $13.000 (Fervicom)
  led: {
    margen: 0.20,             // margen sobre los materiales LED (tu trabajo usa el margen del taller)
    tipos: [
      { id: "blanco", nombre: "Blanco", desc: "Tira LED blanca (cálida o fría)", precio_m: 6100, extra: 0 },
      { id: "rgb", nombre: "RGB con control", desc: "Cambia de color con control remoto", precio_m: 4200, extra: 13000 }, // extra: controlador + control
      { id: "neon", nombre: "Neón flex", desc: "Luz continua tipo neón, sin puntos", precio_m: 7500, extra: 0 },
    ],
    fuente: 14300,            // adaptador de corriente 12 V 2 A
    cable_conectores: 3000,   // cable, conectores, termoencogible
    min_instalacion: 15,      // tu tiempo base: probar, soldar y cablear
    min_por_metro: 10,        // pegar y ajustar la tira por cada metro
  },

  // Tornillería y herrajes que se instalan en la pieza. Precios de referencia por unidad
  // (compra al por mayor en Colombia): revísalos con tu proveedor.
  herrajes: {
    margen: 0.20,             // margen sobre el material (tu tiempo usa el margen del taller)
    // medida: lo que ve el cliente, en cm (M3 = tornillo de 3 mm de grosor, el estándar en impresión 3D).
    // precio: lo que te cuesta cada unidad (referencia del mercado, revísalo); min: tu tiempo de instalación.
    items: [
      { id: "inserto_m2", grupo: "Insertos roscados (latón, se instalan con calor)", nombre: "Inserto M2", medida: "rosca de 0,2 cm · mide 0,35 cm de ancho y 0,3 cm de largo (electrónica)", precio: 450, min: 1.5 },
      { id: "inserto_m25", grupo: "Insertos roscados (latón, se instalan con calor)", nombre: "Inserto M2,5", medida: "rosca de 0,25 cm · mide 0,4 cm de ancho y 0,4 cm de largo (tarjetas electrónicas)", precio: 450, min: 1.5 },
      { id: "inserto", grupo: "Insertos roscados (latón, se instalan con calor)", nombre: "Inserto M3", medida: "rosca de 0,3 cm · mide 0,5 cm de ancho y 0,5 cm de largo (el más común)", precio: 500, min: 1.5 },
      { id: "inserto_m4", grupo: "Insertos roscados (latón, se instalan con calor)", nombre: "Inserto M4", medida: "rosca de 0,4 cm · mide 0,6 cm de ancho y 0,8 cm de largo (más carga)", precio: 700, min: 2 },
      { id: "inserto_m5", grupo: "Insertos roscados (latón, se instalan con calor)", nombre: "Inserto M5", medida: "rosca de 0,5 cm · mide 0,7 cm de ancho y 1 cm de largo (piezas estructurales)", precio: 900, min: 2 },
      { id: "tornillo_m2_6", grupo: "Tornillos (acero, cabeza Allen)", nombre: "Tornillo M2 × 6 mm", medida: "0,2 cm de grosor · 0,6 cm de largo", precio: 200, min: 0.5 },
      { id: "tornillo_m3_8", grupo: "Tornillos (acero, cabeza Allen)", nombre: "Tornillo M3 × 8 mm", medida: "0,3 cm de grosor · 0,8 cm de largo", precio: 200, min: 0.5 },
      { id: "tornillo", grupo: "Tornillos (acero, cabeza Allen)", nombre: "Tornillo M3 × 12 mm", medida: "0,3 cm de grosor · 1,2 cm de largo", precio: 250, min: 0.5 },
      { id: "tornillo_m3_16", grupo: "Tornillos (acero, cabeza Allen)", nombre: "Tornillo M3 × 16 mm", medida: "0,3 cm de grosor · 1,6 cm de largo", precio: 280, min: 0.5 },
      { id: "tornillo_m3_20", grupo: "Tornillos (acero, cabeza Allen)", nombre: "Tornillo M3 × 20 mm", medida: "0,3 cm de grosor · 2 cm de largo", precio: 300, min: 0.5 },
      { id: "tornillo_m3_30", grupo: "Tornillos (acero, cabeza Allen)", nombre: "Tornillo M3 × 30 mm", medida: "0,3 cm de grosor · 3 cm de largo", precio: 400, min: 0.5 },
      { id: "tornillo_m4_16", grupo: "Tornillos (acero, cabeza Allen)", nombre: "Tornillo M4 × 16 mm", medida: "0,4 cm de grosor · 1,6 cm de largo", precio: 400, min: 0.5 },
      { id: "tornillo_m4_25", grupo: "Tornillos (acero, cabeza Allen)", nombre: "Tornillo M4 × 25 mm", medida: "0,4 cm de grosor · 2,5 cm de largo", precio: 500, min: 0.5 },
      { id: "tornillo_m5_20", grupo: "Tornillos (acero, cabeza Allen)", nombre: "Tornillo M5 × 20 mm", medida: "0,5 cm de grosor · 2 cm de largo", precio: 600, min: 0.5 },
      { id: "tuerca_m3", grupo: "Tuercas y arandelas", nombre: "Tuerca M3", medida: "0,55 cm de ancho · 0,25 cm de alto", precio: 100, min: 0.5 },
      { id: "tuerca_m4", grupo: "Tuercas y arandelas", nombre: "Tuerca M4", medida: "0,7 cm de ancho · 0,3 cm de alto", precio: 150, min: 0.5 },
      { id: "tuerca_m3_seg", grupo: "Tuercas y arandelas", nombre: "Tuerca M3 de seguridad (con nylon)", medida: "0,55 cm de ancho · 0,4 cm de alto · no se afloja con la vibración", precio: 200, min: 0.5 },
      { id: "arandela_m3", grupo: "Tuercas y arandelas", nombre: "Arandela M3", medida: "0,7 cm de diámetro · 0,05 cm de grosor", precio: 80, min: 0.3 },
      { id: "iman", grupo: "Imanes de neodimio (pegados)", nombre: "Imán 6 × 3 mm", medida: "0,6 cm de diámetro · 0,3 cm de alto", precio: 400, min: 1 },
      { id: "iman_8", grupo: "Imanes de neodimio (pegados)", nombre: "Imán 8 × 3 mm", medida: "0,8 cm de diámetro · 0,3 cm de alto", precio: 500, min: 1 },
      { id: "iman_10", grupo: "Imanes de neodimio (pegados)", nombre: "Imán 10 × 3 mm", medida: "1 cm de diámetro · 0,3 cm de alto (más fuerza)", precio: 700, min: 1 },
      { id: "iman_12", grupo: "Imanes de neodimio (pegados)", nombre: "Imán 12 × 5 mm", medida: "1,2 cm de diámetro · 0,5 cm de alto (mucha fuerza)", precio: 1200, min: 1 },
      { id: "iman_20", grupo: "Imanes de neodimio (pegados)", nombre: "Imán 20 × 3 mm", medida: "2 cm de diámetro · 0,3 cm de alto (tableros y bases)", precio: 1500, min: 1 },
      { id: "rodamiento_623", grupo: "Rodamientos y ejes", nombre: "Rodamiento 623", medida: "1 cm de diámetro · 0,4 cm de grueso · eje de 0,3 cm", precio: 2000, min: 2 },
      { id: "rodamiento_625", grupo: "Rodamientos y ejes", nombre: "Rodamiento 625", medida: "1,6 cm de diámetro · 0,5 cm de grueso · eje de 0,5 cm", precio: 2500, min: 2 },
      { id: "rodamiento", grupo: "Rodamientos y ejes", nombre: "Rodamiento 608", medida: "2,2 cm de diámetro · 0,7 cm de grueso · eje de 0,8 cm (el de las patinetas)", precio: 3000, min: 2 },
      { id: "eje_3", grupo: "Rodamientos y ejes", nombre: "Eje de acero liso 3 mm", medida: "0,3 cm de grosor · 10 cm de largo (se corta a la medida)", precio: 1500, min: 2 },
      { id: "eje_5", grupo: "Rodamientos y ejes", nombre: "Eje de acero liso 5 mm", medida: "0,5 cm de grosor · 10 cm de largo (se corta a la medida)", precio: 2000, min: 2 },
      { id: "argolla", grupo: "Llaveros y colgantes", nombre: "Argolla de llavero", medida: "2,5 cm de diámetro · acero", precio: 300, min: 0.5 },
      { id: "cadena_bolitas", grupo: "Llaveros y colgantes", nombre: "Cadena de bolitas", medida: "10 cm de largo · para colgantes y llaveros", precio: 400, min: 0.5 },
      { id: "mosqueton", grupo: "Llaveros y colgantes", nombre: "Mosquetón pequeño", medida: "4 cm de largo · para morrales y llaveros", precio: 1500, min: 0.5 },
      { id: "colgador", grupo: "Llaveros y colgantes", nombre: "Colgador para cuadro", medida: "gancho metálico de 2,5 cm · para colgar en la pared", precio: 500, min: 1 },
      { id: "pata_caucho", grupo: "Bases, bisagras y acabados", nombre: "Pata de caucho antideslizante", medida: "1 cm de diámetro · 0,3 cm de alto · autoadhesiva", precio: 200, min: 0.3 },
      { id: "fieltro", grupo: "Bases, bisagras y acabados", nombre: "Base de fieltro", medida: "círculo de 2 cm · autoadhesivo, no raya los muebles", precio: 300, min: 0.3 },
      { id: "bisagra", grupo: "Bases, bisagras y acabados", nombre: "Bisagra metálica pequeña", medida: "2,5 × 2 cm · con tornillos", precio: 1200, min: 2 },
      { id: "portalampara", grupo: "Lámparas", nombre: "Portalámparas E27 con cable e interruptor", medida: "rosca de bombillo normal · cable de 1,5 m", precio: 12000, min: 5 },
      { id: "bombillo", grupo: "Lámparas", nombre: "Bombillo LED E27 luz cálida", medida: "6 cm de diámetro · 9 W · para lámparas", precio: 8000, min: 0 },
      { id: "kit_usb", grupo: "Lámparas", nombre: "Kit de luz LED USB", medida: "base de 4 cm · cable USB con interruptor (sin enchufe)", precio: 7000, min: 3 },
    ],
  },

  // Embalaje según la medida más larga de la pieza (cm). precio: caja o bolsa + protección
  // (plástico de burbujas, papel, cinta); min: tu tiempo de empacar. Es por unidad.
  embalaje: {
    margen: 0.20,
    tamanos: [
      // lado_cm: medida de la caja (para el peso volumétrico del envío)
      { hasta_cm: 10, nombre: "Bolsa o caja pequeña", precio: 1500, min: 3, lado_cm: 14 },
      { hasta_cm: 20, nombre: "Caja mediana", precio: 3000, min: 5, lado_cm: 24 },
      { hasta_cm: 30, nombre: "Caja grande", precio: 5000, min: 8, lado_cm: 34 },
      { hasta_cm: 999, nombre: "Caja extra grande", precio: 8000, min: 12, lado_cm: 48 },
    ],
  },

  // Entrega. El envío se cobra AL COSTO (sin margen): es un estimado, la transportadora confirma.
  // Referencias 2026 (Interrapidísimo, 1 kg): urbano $11.000–13.500 · regional $14.500–17.500 ·
  // zona especial $20.000–25.000. Se cobra por el mayor entre peso real y volumétrico (cm³ ÷ 5000).
  envio: {
    domicilio_bogota: [9000, 12000, 16000, 24000],   // mensajería en moto según la caja (pequeña…extra grande)
    zonas: [
      { id: "principal", nombre: "Ciudad principal", desc: "Medellín, Cali, Barranquilla…", base_kg: 13500, kg_extra: 4000, dias: "1 a 3" },
      { id: "regional", nombre: "Municipio", desc: "Pueblos y ciudades intermedias", base_kg: 17500, kg_extra: 5000, dias: "2 a 4" },
      { id: "especial", nombre: "Zona especial", desc: "San Andrés, Amazonas, zonas rurales", base_kg: 25000, kg_extra: 7000, dias: "4 a 8" },
    ],
    kg_embalaje: 0.2,         // peso de caja y protección por unidad
  },

  acabados: {
    min_cambio_filamento: 4,  // sin AMS: descargar y cargar filamento entre placas de distinto color
    // Pintura: tiempo fijo por pedido (preparar, imprimar, secar, retocar) + tiempo por área visible.
    // Insumos: spray imprimante ~$25.000 rinde ~1 m²; acrílicos y barniz aparte.
    pintura: {
      area_visible: 0.75,     // parte de la superficie del archivo que realmente se pinta
      basica: { nombre: "Básica", desc: "Imprimación y 1 a 3 colores base", min_fijos: 20, min_por_100cm2: 4, insumos_por_100cm2: 400 },
      detallada: { nombre: "Detallada", desc: "Varios colores, sombras, lavados y detalles finos", min_fijos: 40, min_por_100cm2: 12, insumos_por_100cm2: 800 },
    },
  },

  // precio_kg: lo que te cuesta 1 kg en Colombia (con envío). Es el valor base:
  // la tarea automática diaria lo reemplaza por el precio de mercado si lo encuentra.
  // recargo de color: 0.10 = +10 % (colores especiales, silk, etc.)
  materiales: {
    PLA: {
      temp_boquilla: 220, temp_cama: 65,
      nombre: "PLA", densidad: 1.24, precio_kg: 85000, importado: true,
      // Precio automático (ver README): enlaces de producto de tu proveedor
      fuentes: [],
      busqueda_ml: "filamento pla 1kg 1.75",
      desc: "El más usado. Rígido, buen detalle, ideal para decoración, prototipos y figuras.",
      props: { resistencia: 3, flexibilidad: 1, temperatura: 2, detalle: 5 },
      colores: [
        { nombre: "Negro", hex: "#1b1b1f", recargo: 0 },
        { nombre: "Blanco", hex: "#f2f2ee", recargo: 0 },
        { nombre: "Gris", hex: "#8a8d93", recargo: 0 },
        { nombre: "Rojo", hex: "#d7263d", recargo: 0 },
        { nombre: "Azul", hex: "#1f6feb", recargo: 0 },
        { nombre: "Verde lima", hex: "#b6f23a", recargo: 0.05 },
        { nombre: "Naranja", hex: "#ff7a1a", recargo: 0 },
        { nombre: "Silk dorado", hex: "#d4a72c", recargo: 0.25 },
        { nombre: "Silk plata", hex: "#c9ccd1", recargo: 0.25 },
        { nombre: "Brilla en la oscuridad", hex: "#c8f7c5", recargo: 0.35 },
      ],
    },
    PETG: {
      temp_boquilla: 250, temp_cama: 70,
      nombre: "PETG", densidad: 1.27, precio_kg: 95000, importado: true,
      // Precio automático (ver README): enlaces de producto de tu proveedor
      fuentes: [],
      busqueda_ml: "filamento petg 1kg 1.75",
      desc: "Resistente al impacto y a la humedad. Piezas funcionales, exteriores, soportes.",
      props: { resistencia: 4, flexibilidad: 2, temperatura: 3, detalle: 4 },
      colores: [
        { nombre: "Negro", hex: "#1b1b1f", recargo: 0 },
        { nombre: "Blanco", hex: "#f2f2ee", recargo: 0 },
        { nombre: "Transparente", hex: "#cfe8ff", recargo: 0.05 },
        { nombre: "Azul", hex: "#1f6feb", recargo: 0 },
        { nombre: "Rojo", hex: "#d7263d", recargo: 0 },
      ],
    },
    TPU: {
      temp_boquilla: 230, temp_cama: 35,
      nombre: "TPU (flexible)", densidad: 1.21, precio_kg: 130000, importado: true,
      // Precio automático (ver README): enlaces de producto de tu proveedor
      fuentes: [],
      busqueda_ml: "filamento tpu 1kg 1.75",
      desc: "Flexible como caucho. Fundas, empaques, ruedas, amortiguadores.",
      props: { resistencia: 4, flexibilidad: 5, temperatura: 2, detalle: 2 },
      colores: [
        { nombre: "Negro", hex: "#1b1b1f", recargo: 0 },
        { nombre: "Transparente", hex: "#e3f1ff", recargo: 0 },
        { nombre: "Rojo", hex: "#d7263d", recargo: 0 },
      ],
    },
    ASA: {
      temp_boquilla: 260, temp_cama: 100,
      nombre: "ASA", densidad: 1.07, precio_kg: 115000, importado: true,
      fuentes: [],
      busqueda_ml: "filamento asa 1kg 1.75",
      desc: "Resiste sol, lluvia y calor sin decolorarse. Piezas para exteriores y carro.",
      // La A1 es abierta: el ASA se contrae y se despega en piezas grandes
      nota: "En nuestra Bambu Lab A1 (abierta) solo imprimimos piezas pequeñas en ASA, de hasta 10 cm.",
      max_cm: 10,
      props: { resistencia: 4, flexibilidad: 2, temperatura: 5, detalle: 3 },
      colores: [
        { nombre: "Negro", hex: "#1b1b1f", recargo: 0 },
        { nombre: "Blanco", hex: "#f2f2ee", recargo: 0 },
        { nombre: "Gris", hex: "#8a8d93", recargo: 0 },
      ],
    },
  },

  /* Catálogo / tus trabajos.
     media: fotos y videos del trabajo. Copia los archivos en la carpeta "trabajos/"
     y escribe sus nombres, en el orden en que quieres que aparezcan. Ejemplo:
       media: ["trabajos/maceta-1.jpg", "trabajos/maceta-2.jpg", "trabajos/maceta.mp4"]
     Fotos: .jpg .png .webp (ideal ~1200 px de ancho). Videos: .mp4 o .webm, cortos
     (menos de 20 MB). Si "media" está vacío se generan vistas 3D con la "forma":
     knot | torus | ico | box | cone | cylinder | sphere | gear
     ejemplo: true = se muestra con la etiqueta "Ejemplo". Quítalo cuando sea un trabajo real. */
  catalogo: [
    { nombre: "Lámpara Flor de la Vida", categoria: "Hogar", material: "PLA", color: "#1a1a1a", desde: 65000, forma: "cylinder", media: ["trabajos/lampara-flor-de-la-vida-1.jpg", "trabajos/lampara-flor-de-la-vida-2.jpg", "trabajos/lampara-flor-de-la-vida-3.jpg", "trabajos/lampara-flor-de-la-vida-4.jpg", "trabajos/lampara-flor-de-la-vida-5.jpg", "trabajos/lampara-flor-de-la-vida-6.jpg"] },
    { nombre: "Maceta geométrica", categoria: "Hogar", material: "PLA", color: "#b6f23a", desde: 28000, forma: "ico", media: [], ejemplo: true },
    { nombre: "Engranaje de repuesto", categoria: "Repuestos", material: "PETG", color: "#8a8d93", desde: 18000, forma: "gear", media: [], ejemplo: true },
    { nombre: "Escultura paramétrica", categoria: "Arte", material: "PLA", color: "#d4a72c", desde: 45000, forma: "knot", media: [], ejemplo: true },
    { nombre: "Organizador de escritorio", categoria: "Hogar", material: "PLA", color: "#1f6feb", desde: 35000, forma: "box", media: [], ejemplo: true },
    { nombre: "Prototipo de carcasa", categoria: "Prototipos", material: "PETG", color: "#1b1b1f", desde: 60000, forma: "cylinder", media: [], ejemplo: true },
    { nombre: "Anillo / dona decorativa", categoria: "Arte", material: "PLA", color: "#ff7a1a", desde: 15000, forma: "torus", media: [], ejemplo: true },
    { nombre: "Pieza flexible", categoria: "Repuestos", material: "TPU", color: "#d7263d", desde: 22000, forma: "sphere", media: [], ejemplo: true },
    { nombre: "Lámpara cónica", categoria: "Hogar", material: "PETG", color: "#cfe8ff", desde: 52000, forma: "cone", media: [], ejemplo: true },
  ],
};
