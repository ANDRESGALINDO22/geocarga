const fs = require('fs');
const { Pool } = require('pg');

const codigo = fs.readFileSync('server.js', 'utf8');
const bloque = codigo.match(/const pool\s*=\s*new Pool\s*\(\s*\{([\s\S]*?)\}\s*\)/);

if (!bloque) {
    console.error('No se encontro la configuracion PostgreSQL.');
    process.exit(1);
}

const linea = bloque[1].split('\n').find(x => /^\s*password\s*:/.test(x));

if (!linea) {
    console.error('No se encontro el campo password.');
    process.exit(1);
}

const tieneAlternativa = /\|\|/.test(linea);
const tieneVariable = /process\.env\.DB_PASSWORD/.test(linea);

console.log('Campo password identificado.');
console.log('Usa DB_PASSWORD:', tieneVariable ? 'SI' : 'NO');
console.log('Tiene valor alternativo:', tieneAlternativa ? 'SI' : 'NO');

if (!tieneAlternativa) {
    console.log('No hay una contraseña alternativa visible en la configuracion.');
    process.exit(0);
}

const coincidencia = linea.match(
    /password\s*:\s*process\.env\.DB_PASSWORD\s*\|\|\s*(['"])(.*?)\1/
);

if (!coincidencia) {
    console.log('La expresion necesita otra forma de lectura. No se mostraran credenciales.');
    process.exit(0);
}

const pool = new Pool({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'geocarga_db',
    password: process.env.DB_PASSWORD || coincidencia[2],
    port: Number(process.env.DB_PORT || 5432)
});

(async () => {
    try {
        const resultado = await pool.query(
            'SELECT current_database() AS base, current_user AS usuario'
        );

        console.log('CONEXION POSTGRESQL CORRECTA');
        console.log('Base:', resultado.rows[0].base);
        console.log('Usuario:', resultado.rows[0].usuario);
    } catch (error) {
        console.error('ERROR DE CONEXION:', error.message);
    } finally {
        await pool.end();
    }
})();
