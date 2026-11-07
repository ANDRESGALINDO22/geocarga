const fs = require('node:fs/promises');
const path = require('node:path');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');
require('dotenv').config();

async function prepararDemo() {
  const { DEMO_PASSWORD, DB_USER, DB_PASSWORD, DB_HOST, DB_PORT, DB_NAME } = process.env;
  if (!DEMO_PASSWORD || DEMO_PASSWORD.length < 12) {
    throw new Error('Configura DEMO_PASSWORD con al menos 12 caracteres.');
  }
  const pool = new Pool({
    user: DB_USER || 'postgres', password: DB_PASSWORD,
    host: DB_HOST || 'localhost', port: DB_PORT || 5432,
    database: DB_NAME || 'geocarga_db'
  });
  try {
    const esquema = await fs.readFile(path.join(__dirname, 'esquema.sql'), 'utf8');
    await pool.query(esquema);
    await pool.query("INSERT INTO roles (nombre_rol) VALUES ('Administrador') ON CONFLICT (nombre_rol) DO NOTHING");
    const hash = await bcrypt.hash(DEMO_PASSWORD, 12);
    await pool.query(
      "INSERT INTO usuarios (nombre_usuario, correo, contrasena, id_rol) SELECT 'Operador Demo', 'admin@geocarga.com', $1, id_rol FROM roles WHERE nombre_rol = 'Administrador' ON CONFLICT (correo) DO NOTHING",
      [hash]
    );
    const rutas = JSON.parse(await fs.readFile(path.join(__dirname, '../radar/rutas.json'), 'utf8'));
    for (const ruta of rutas) {
      await pool.query(
        "INSERT INTO vuelos (numero_vuelo, aerolinea, origen, destino, radar_id) SELECT $1, 'GeoCarga Demo', $2, $3, $4 WHERE NOT EXISTS (SELECT 1 FROM vuelos WHERE numero_vuelo = $1)",
        ['GC' + ruta.id, ruta.origen, ruta.destino, ruta.id]
      );
    }
    const carpeta = path.join(__dirname, 'uploads');
    await fs.mkdir(carpeta, { recursive: true });
    for (const [numero, etapa, estado] of [
      ['GC100001', 'EN_VUELO', 'EN_TRANSITO'],
      ['GC100002', 'EN_ADUANA', 'EN_TRANSITO'],
      ['GC100003', 'ENTREGA_FINAL', 'ENTREGADO']
    ]) {
      const archivo = numero + '-AWB-demo.pdf';
      const contenido = 'BT /F1 20 Tf 70 750 Td (GeoCarga - Guia aerea de demostracion) Tj 0 -32 Td (' + numero + ' / AWB DEMO / Sin validez comercial) Tj ET';
      const objetos = [
        '<< /Type /Catalog /Pages 2 0 R >>',
        '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
        '<< /Length ' + contenido.length + ' >>\nstream\n' + contenido + '\nendstream',
        '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
      ];
      let pdf = '%PDF-1.4\n';
      const indices = objetos.map((objeto, i) => {
        const inicio = pdf.length;
        pdf += (i + 1) + ' 0 obj\n' + objeto + '\nendobj\n';
        return String(inicio).padStart(10, '0') + ' 00000 n \n';
      });
      const xref = pdf.length;
      pdf += 'xref\n0 6\n0000000000 65535 f \n' + indices.join('') + 'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n';
      await fs.writeFile(path.join(carpeta, archivo), pdf);
      await pool.query(
        "INSERT INTO operaciones (id_vuelo, etapa_flujo, estado_general) SELECT v.id_vuelo, $2, $3 FROM vuelos v WHERE v.numero_vuelo = $1 AND NOT EXISTS (SELECT 1 FROM operaciones o WHERE o.id_vuelo = v.id_vuelo)",
        [numero, etapa, estado]
      );
      await pool.query(
        "INSERT INTO documentacion (id_operacion, tipo_documento, url_almacenamiento, contenido) SELECT min(o.id_operacion), 'AWB_GUIA_AEREA', $2, $3 FROM operaciones o JOIN vuelos v USING (id_vuelo) WHERE v.numero_vuelo = $1 AND NOT EXISTS (SELECT 1 FROM documentacion WHERE url_almacenamiento = $2) HAVING count(*) > 0",
        [numero, '/uploads/' + archivo, Buffer.from(pdf)]
      );
    }
    console.log('Base de demostracion preparada.');
  } finally {
    await pool.end();
  }
}

prepararDemo().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
