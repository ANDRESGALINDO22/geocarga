const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const pool = new Pool({
  user: process.env.DB_USER || 'postgres',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'geocarga_db',
  password: process.env.DB_PASSWORD || 'admin123',
  port: process.env.DB_PORT || 5432,
});

async function resetear() {
  try {
    const hash = await bcrypt.hash('admin123', 10);

    // Asegurar rol Administrador
    await pool.query(`
      INSERT INTO roles (id_rol, nombre_rol, descripcion, matriz_permisos)
      VALUES (1, 'Administrador', 'Rol Administrador', '{"admin": true, "reportes": true}')
      ON CONFLICT (id_rol) DO UPDATE 
      SET matriz_permisos = '{"admin": true, "reportes": true}';
    `);

    // Insertar o actualizar usuario admin
    await pool.query(`
      INSERT INTO usuarios (id_usuario, id_rol, nombre_usuario, correo, contrasena, mfa_activo, sso_provider)
      VALUES (1, 1, 'Admin GeoCarga', 'admin@geocarga.com', $1, false, 'local')
      ON CONFLICT (correo) DO UPDATE 
      SET contrasena = $1, id_rol = 1;
    `, [hash]);

    console.log('\n=========================================');
    console.log('>>> USUARIO RESTABLECIDO CON ÉXITO');
    console.log('Correo: admin@geocarga.com');
    console.log('Clave:  admin123');
    console.log('=========================================\n');
  } catch (err) {
    console.error('Error detallado:', err);
  } finally {
    await pool.end();
  }
}

resetear();