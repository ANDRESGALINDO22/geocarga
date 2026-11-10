const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const app = express();
const roles = ['Administrador', 'Operador logístico', 'Supervisor', 'Cliente', 'Conductor', 'Auditor'];
const rolesInternos = ['Administrador', 'Operador logístico', 'Supervisor', 'Auditor'];
const rolesEscritura = ['Administrador', 'Operador logístico'];
const secretoSesion = process.env.JWT_SECRET || require('node:crypto').randomBytes(32).toString('hex');
const cookieSesion = { httpOnly: true, sameSite: 'strict', secure: process.env.COOKIE_SECURE === 'true' };

function leerSesion(req) {
  const cookie = (req.headers.cookie || '').split(';').map(valor => valor.trim())
    .find(valor => valor.startsWith('geocarga_sesion='));
  try {
    return cookie ? jwt.verify(cookie.slice('geocarga_sesion='.length), secretoSesion, { algorithms: ['HS256'] }) : null;
  } catch {
    return null;
  }
}

function exigirRoles(permitidos) {
  return (req, res, next) => {
    req.usuario = leerSesion(req);
    if (!req.usuario) return res.status(401).json({ mensaje: 'Inicia sesión para continuar.' });
    if (!permitidos.includes(req.usuario.rol)) return res.status(403).json({ mensaje: 'Tu rol no tiene acceso a esta función.' });
    next();
  };
}
const exigirAdmin = exigirRoles(['Administrador']);
const exigirLectura = exigirRoles(rolesInternos);
const exigirEscritura = exigirRoles(rolesEscritura);
const exigirSesion = exigirRoles(roles);
const rolesAsignados = ['Cliente', 'Conductor'];
const rolesReportarNovedad = [...rolesEscritura, 'Conductor'];
const rolesValidarNovedad = ['Administrador', 'Supervisor'];
const tiposNovedad = ['Retraso', 'Retención aduanera', 'Documento pendiente', 'Daño', 'Otra'];

function usuarioRestringido(usuario) {
  return rolesAsignados.includes(usuario.rol) ? usuario.id_usuario : null;
}
app.use(cors());
app.use(express.json());

// Asegurar carpeta de subidas de archivos
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}
app.use('/uploads', exigirSesion);
app.get('/uploads/:archivo', async (req, res, next) => {
  try {
    const nombre = req.params.archivo;

    if (nombre !== path.basename(nombre)) {
      return res.sendStatus(400);
    }

    const url = '/uploads/' + nombre;

    const { rows } = await pool.query(
      `SELECT d.contenido
       FROM documentacion d
       WHERE d.url_almacenamiento = $1
       AND (
         $2::int IS NULL
         OR EXISTS (
           SELECT 1 FROM operacion_usuarios a
           WHERE a.id_operacion = d.id_operacion
           AND a.id_usuario = $2
         )
       )
       LIMIT 1`,
      [url, usuarioRestringido(req.usuario)]
    );

    if (!rows.length) {
      return res.sendStatus(404);
    }

    if (rows[0].contenido) {
      return res.attachment(nombre).send(rows[0].contenido);
    }

    const rutaArchivo = path.join(uploadsDir, nombre);

    if (!fs.existsSync(rutaArchivo)) {
      return res.status(404).json({
        mensaje: 'Documento registrado, pero archivo no encontrado.'
      });
    }

    return res.download(rutaArchivo, nombre);
  } catch (error) {
    next(error);
  }
});
app.use('/uploads', express.static(uploadsDir));

// Configuración de Multer para almacenar archivos con nombres únicos
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const nombreLimpio = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9]/g, '_');
    cb(null, `${Date.now()}-${nombreLimpio}${ext}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter(req, file, cb) {
    const extensions = { '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' };
    const expected = extensions[path.extname(file.originalname).toLowerCase()];
    cb(null, Boolean(expected && file.mimetype === expected));
  }
});

const pool = new Pool({
  user: process.env.DB_USER || 'postgres',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'geocarga_db',
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT || 5432,
});

/* GEOCARGA AZUL EXTERNO */
app.get('/tailwind-local.css', (req, res) => {
    res.sendFile(__dirname + '/estilos/tailwind-local.css');
});
app.get('/geocarga-azul.css', (req, res) => {
    res.sendFile(__dirname + '/geocarga-azul.css');
});
const htmlPrincipal = `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>GeoCarga - Sistema de Control Logístico</title>
  <link rel="stylesheet" href="/tailwind-local.css">
  <link href="https://unpkg.com/maplibre-gl@5.6.2/dist/maplibre-gl.css" rel="stylesheet">
  <script src="https://unpkg.com/maplibre-gl@5.6.2/dist/maplibre-gl.js"></script>
  <style>
    #vista-app:has(#sec-tracer:not(.hidden)) #area-aplicacion { flex-direction: column; }
    #vista-app:has(#sec-tracer:not(.hidden)) aside {
      display: flex; flex-wrap: wrap; gap: .5rem; width: 100%;
    }
    #vista-app:has(#sec-tracer:not(.hidden)) aside button { width: auto; margin: 0; }
    #vista-app:has(#sec-tracer:not(.hidden)) main { width: 100%; padding: .75rem; }
    #flota-radar { position: relative; padding: 0; background: transparent; }
    #flota-radar > h2, #flota-radar > table, #estado-mapa, #busqueda-operacion { display: none; }
    #form-filtro-avion {
      position: absolute; z-index: 2; top: .75rem; left: .75rem; right: 4rem;
      width: fit-content; max-width: calc(100% - 4.75rem); margin: 0;
      padding: .5rem; border-radius: .5rem; background: #0f172aee;
    }
    #estado-flota {
      position: absolute; z-index: 2; bottom: 1rem; left: .75rem;
      margin: 0; padding: .35rem .6rem; border-radius: .35rem; background: #0f172aee;
      pointer-events: none;
    }
    #mapa-flota { width: 100%; height: calc(100dvh - 145px); min-height: 420px; }
    #mapa-flota:fullscreen { height: 100%; margin: 0; border-radius: 0; }
  </style>
<style id="geocarga-metal-theme">
:root {
    --metal-bg: #08090c;
    --metal-panel: #15171d;
    --metal-red: #168bff;
    --metal-border: #168bff;
    --metal-text: #f0f0f2;
}

body {
    background:
        radial-gradient(circle at 85% 5%, rgba(22,139,255,.16), transparent 35%),
        linear-gradient(135deg, #08090c, #15171d 60%, #08090c) !important;
    color: var(--metal-text);
    font-family: 'Segoe UI', Arial, sans-serif;
}

.bg-slate-800,
.bg-slate-800\/50 {
    background: linear-gradient(145deg, #1d2027, #0e1015) !important;
    border-color: var(--metal-border) !important;
}

.bg-slate-900 {
    background-color: #0c0e13 !important;
}

.border-slate-700 {
    border-color: #44212a !important;
}

.text-sky-400,
.text-sky-500 {
    color: #168bff !important;
}

.bg-sky-600 {
    background: linear-gradient(135deg, #168bff, #168bff) !important;
    box-shadow: 0 4px 18px rgba(22,139,255,.22);
}

.bg-sky-600:hover {
    background: linear-gradient(135deg, #168bff, #168bff) !important;
}

button {
    transition: transform .2s, box-shadow .2s, background .2s;
}

button:hover {
    transform: translateY(-2px);
}

input:focus {
    border-color: #168bff !important;
    box-shadow: 0 0 0 2px rgba(22,139,255,.16);
}

header {
    background: linear-gradient(90deg, #090a0d, #211118, #090a0d) !important;
    border-bottom: 1px solid #214b80 !important;
}

aside {
    background: linear-gradient(180deg, #15171d, #090a0d) !important;
    border-right: 1px solid #214b80 !important;
}

aside button:hover {
    background: rgba(22,139,255,.16) !important;
    color: white !important;
}

h1, h2, h3 {
    letter-spacing: .4px;
}

h1 {
    font-weight: 900 !important;
    font-style: italic;
    text-transform: uppercase;
    text-shadow: 2px 2px 0 #168bff, 0 0 22px rgba(22,139,255,.35);
}

#vista-login > div,
#vista-login.bg-slate-800 {
    box-shadow: 0 25px 70px rgba(0,0,0,.65),
                0 0 35px rgba(22,139,255,.13) !important;
}

.rounded-xl {
    border-radius: 14px;
}

main section > div,
#vista-dash {
    animation: metalEntrada .45s ease-out both;
}

@keyframes metalEntrada {
    from { opacity: 0; transform: translateY(12px); }
    to { opacity: 1; transform: translateY(0); }
}

@media (prefers-reduced-motion: reduce) {
    *, *::before, *::after {
        animation: none !important;
        transition: none !important;
    }
}
</style>
<style id="geocarga-metal-v2">
:root {
  --rojo-metal: #168bff;
  --acero: #8993a5;
}

body {
  background:
    radial-gradient(ellipse at 85% 0%, #47101d55, transparent 45%),
    repeating-linear-gradient(135deg, transparent 0px, transparent 4px, #ffffff03 5px),
    #08090d !important;
}

header {
  background: linear-gradient(100deg, #09090c, #231017, #09090c) !important;
  border-bottom: 2px solid #168bff !important;
  box-shadow: 0 5px 30px #000a;
}

header h1, header .text-sky-400 {
  font-size: 1.65rem !important;
  font-weight: 1000 !important;
  font-style: italic;
  letter-spacing: -1px;
  color: #f3f4f6 !important;
  text-shadow: 3px 3px #0754bd, 0 0 25px #168bff66;
}

aside {
  background:
    linear-gradient(180deg, #17191f, #090a0d) !important;
  border-right: 2px solid #168bff !important;
  box-shadow: 8px 0 30px #0008;
}

aside button {
  border: 1px solid transparent;
  border-radius: 8px !important;
  font-weight: 700 !important;
  transition: all .25s ease !important;
}

aside button:hover {
  border-color: #168bff !important;
  background: linear-gradient(90deg, #168bff, #190d13) !important;
  box-shadow: inset 3px 0 #168bff, 0 0 18px #168bff2a;
  transform: translateX(4px);
}

aside button.bg-sky-600 {
  background: linear-gradient(100deg, #168bff, #168bff) !important;
  border-color: #168bff !important;
  box-shadow: 0 0 22px #168bff50;
}

main h2 {
  font-size: 1.65rem !important;
  font-weight: 900 !important;
  text-transform: uppercase;
  letter-spacing: 1px;
  border-left: 5px solid #168bff;
  padding-left: 15px;
}

main .bg-slate-800 {
  background:
    linear-gradient(145deg, #252a34, #12151c) !important;
  border: 1px solid #168bff !important;
  border-top: 2px solid #168bff !important;
  box-shadow: 0 12px 30px #0006, inset 0 1px #ffffff12;
}

main .bg-slate-800:hover {
  border-color: #168bff !important;
  box-shadow: 0 14px 35px #0009, 0 0 18px #168bff22;
}

main .text-3xl {
  font-size: 2.5rem !important;
  font-weight: 900 !important;
  text-shadow: 0 0 20px currentColor;
}

input, select, textarea {
  background: #0d1016 !important;
  border-color: #168bff !important;
  color: #f8fafc !important;
}

button.bg-sky-600, button.bg-red-700 {
  background: linear-gradient(135deg, #123e80, #168bff) !important;
  border: 1px solid #168bff !important;
  box-shadow: 0 4px 18px #168bff33;
}

#vista-login > div {
  border: 1px solid #168bff !important;
  border-top: 4px solid #168bff !important;
  box-shadow: 0 30px 90px #000b, 0 0 50px #168bff22 !important;
}

#vista-login h1 {
  font-size: 3rem !important;
  letter-spacing: -2px;
  color: #f8fafc !important;
  text-shadow: 4px 4px #0754bd, 0 0 30px #168bff66;
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation: none !important;
    transition: none !important;
  }
}
</style>
<style id="geocarga-metal-v3">
@import url('https://fonts.googleapis.com/css2?family=Rajdhani:wght@400;500;600;700&family=Orbitron:wght@500;700;900&display=swap');

body {
  font-family: 'Rajdhani', sans-serif !important;
  background: #07090d !important;
  background-image:
    radial-gradient(ellipse at 75% 0%, #5b102033, transparent 45%),
    repeating-linear-gradient(135deg, transparent 0 6px, #ffffff03 7px 8px) !important;
}

#vista-app header {
  min-height: 92px;
  background: linear-gradient(100deg,#08090c,#260b16,#08090c) !important;
  border-bottom: 2px solid #168bff !important;
}

.gc-brand {
  display: flex;
  align-items: center;
  gap: 15px;
}

.gc-emblem {
  font-size: 42px;
  color: #168bff;
  filter: drop-shadow(0 0 12px #168bff77);
}

.gc-brand-name {
  font-family: 'Orbitron', sans-serif;
  font-size: 30px;
  font-weight: 900;
  font-style: italic;
  letter-spacing: -2px;
  color: #f3f4f6;
  text-shadow: 3px 3px #168bff, 0 0 25px #168bff55;
}

.gc-brand-sub {
  font-size: 11px;
  letter-spacing: 3px;
  color: #9ca3af;
}

#area-aplicacion > aside {
  width: 270px;
  flex-shrink: 0;
  background: linear-gradient(180deg,#171a20,#08090c) !important;
  border-right: 2px solid #168bff !important;
}

#area-aplicacion > aside::before {
  content: '⚡ CENTRO DE CONTROL';
  display: block;
  padding: 15px 8px 22px;
  color: #168bff;
  font-family: 'Orbitron',sans-serif;
  font-size: 11px;
  letter-spacing: 1px;
}

#area-aplicacion > aside button {
  min-height: 48px;
  margin-bottom: 8px;
  font-size: 15px !important;
  font-weight: 700 !important;
  border: 1px solid #ffffff12;
  background: linear-gradient(90deg,#1c2028,#101217);
}

#area-aplicacion > aside button:hover {
  background: linear-gradient(90deg,#0754bd,#0b1524) !important;
  border-color: #168bff !important;
  box-shadow: 0 0 20px #168bff33;
}

#sec-dashboard {
  max-width: 1900px;
  margin: auto;
}

.gc-dashboard-title {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 15px;
  flex-wrap: wrap;
  padding: 8px 0 15px;
}

.gc-dashboard-title h2 {
  font-family: 'Orbitron',sans-serif;
  font-size: clamp(19px,2.5vw,32px) !important;
  letter-spacing: 1px;
}

.gc-live {
  padding: 8px 14px;
  border: 1px solid #168bff;
  background: #0b1728;
  color: #7dd3fc;
  font-size: 12px;
  font-weight: 700;
  border-radius: 5px;
}

.gc-control-grid {
  display: grid;
  grid-template-columns: minmax(0,2.2fr) minmax(270px,1fr);
  gap: 18px;
}

.gc-panel {
  background: linear-gradient(145deg,#1c2028,#0b0d12);
  border: 1px solid #315c8b;
  border-top: 2px solid #168bff;
  border-radius: 10px;
  padding: 18px;
  box-shadow: 0 15px 35px #0009;
  min-width: 0;
}

.gc-panel-heading {
  color: #f8fafc;
  font-family: 'Orbitron',sans-serif;
  font-size: 13px;
  margin-bottom: 15px;
  letter-spacing: 1px;
}

.gc-radar-frame {
  height: 450px;
  border: 1px solid #254d7b;
  border-radius: 8px;
  overflow: hidden;
  background: #0b1720;
  position: relative;
}

.gc-radar-frame iframe {
  width: 100%;
  height: 100%;
  border: 0;
}

.gc-radar-label {
  position: absolute;
  z-index: 2;
  top: 12px;
  left: 12px;
  padding: 7px 12px;
  background: #090b10dd;
  border: 1px solid #168bff;
  color: #f3f4f6;
  font-size: 12px;
  pointer-events: none;
}

.gc-side-stack {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.gc-stat {
  padding: 15px;
  border: 1px solid #1c3556;
  border-left: 4px solid #168bff;
  background: #0b0e14;
  margin-bottom: 10px;
}

.gc-stat-label {
  color: #aeb7c5;
  font-size: 13px;
  text-transform: uppercase;
}

.gc-stat-value {
  font-family: 'Orbitron',sans-serif;
  color: #fff;
  font-size: 26px;
  font-weight: 900;
}

.gc-footer {
  margin-top: 20px;
  padding: 15px;
  text-align: center;
  color: #7e8798;
  border-top: 1px solid #168bff;
  font-size: 12px;
  letter-spacing: 2px;
}

@media(max-width:1050px) {
  .gc-control-grid { grid-template-columns: 1fr; }
  #area-aplicacion > aside { width: 220px; }
}

@media(max-width:700px) {
  #area-aplicacion { flex-direction: column; }
  #area-aplicacion > aside {
    width: 100%;
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  #area-aplicacion > aside button { width: auto; }
  .gc-radar-frame { height: 350px; }
  .gc-brand-name { font-size: 22px; }
}
</style>
<style id="gc-radar-fix">
#gc-radar-preview {
  width: 100%;
  height: 100%;
  min-height: 450px;
  display: flex;
  align-items: center;
  justify-content: center;
  background:
    radial-gradient(circle at center,#142b35,#060d13 75%);
}
.gc-radar-message {
  text-align: center;
  color: white;
}
.gc-radar-message h3 {
  font-size: 22px;
  font-weight: 900;
  margin: 12px 0;
}
.gc-radar-message p {
  color: #94a3b8;
  margin-bottom: 20px;
}
.gc-radar-message button {
  padding: 12px 25px;
  background: linear-gradient(90deg,#168bff,#168bff);
  border: 1px solid #168bff;
  border-radius: 8px;
  font-weight: bold;
}
</style>
<style id="gc-ozzy-animation">
.gc-ozzy-bat {
  position: relative;
  width: 55px;
  height: 55px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  flex-shrink: 0;
}

.gc-bat-wings {
  display: block;
  font-size: 38px;
  animation: gcBatFly 2s ease-in-out infinite;
  filter: drop-shadow(0 0 10px #168bff);
  transform-origin: center;
}

.gc-bat-head {
  position: absolute;
  top: 6px;
  left: 17px;
  font-size: 18px;
  opacity: 0;
  pointer-events: none;
}

.gc-ozzy-bat:hover .gc-bat-head {
  animation: gcHeadFly 1.5s ease-out forwards;
}

.gc-ozzy-bat:hover .gc-bat-wings {
  animation: gcBatBite .5s ease-in-out infinite;
}

@keyframes gcBatFly {
  0%,100% { transform: translateY(0) rotate(-7deg) scale(1); }
  50% { transform: translateY(-5px) rotate(7deg) scale(1.13); }
}

@keyframes gcBatBite {
  0%,100% { transform: rotate(-10deg) scale(1); }
  50% { transform: rotate(12deg) scale(1.2); }
}

@keyframes gcHeadFly {
  0% {
    opacity: 1;
    transform: translate(0,0) rotate(0deg);
  }
  35% {
    opacity: 1;
    transform: translate(10px,-15px) rotate(40deg);
  }
  100% {
    opacity: 0;
    transform: translate(70px,-50px) rotate(540deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .gc-bat-wings,
  .gc-ozzy-bat:hover .gc-bat-head {
    animation: none !important;
  }
}
</style>


<script id="gc-blue-white-runtime">
document.addEventListener('DOMContentLoaded', function () {
  var css = document.createElement('style');
  css.textContent = [
    '#vista-app aside button.bg-rose-600,',
    '#vista-app aside button.bg-red-600,',
    '#vista-app aside button.bg-pink-600 {',
    'background:linear-gradient(120deg,#0758cc,#1688ff)!important;',
    'border-color:#42b7ff!important;',
    'box-shadow:0 0 18px rgba(22,119,255,.22)!important;',
    '}'
  ].join('');
  document.head.appendChild(css);
});
</script>


<style id="gc-azul-final">
/* GEOCARGA - NEGRO, AZUL ELECTRICO Y BLANCO */

/* Fondo general */
html, body {
    background: #05080e !important;
    color: #f8fbff !important;
}

/* Encabezado principal */
#vista-app header {
    background: linear-gradient(110deg,#05080e,#09182b) !important;
    border-bottom: 2px solid #168bff !important;
    box-shadow: 0 2px 20px #168bff25 !important;
}

/* Menu lateral */
#vista-app aside {
    background: #090f19 !important;
    border-right: 1px solid #168bff !important;
}

/* Botones del menu */
#vista-app aside button {
    color: #f8fbff !important;
    border-color: #263a54 !important;
    background: #101927 !important;
}

#vista-app aside button:hover {
    background: #17365a !important;
    border-color: #168bff !important;
}

/* Boton activo */
#vista-app aside button.bg-sky-600,
#vista-app aside button.bg-blue-600,
#vista-app aside button[class*="active"] {
    background: linear-gradient(110deg,#0756b8,#168bff) !important;
    border-color: #63b8ff !important;
    color: white !important;
}

/* Tarjetas y paneles */
#vista-app main > div,
#vista-app section > div {
    border-color: #168bff55;
}

/* Botones rojos existentes */
#vista-app button[class*="bg-rose"],
#vista-app button[class*="bg-red"],
#vista-app button[class*="bg-pink"],
#vista-app a[class*="bg-rose"],
#vista-app a[class*="bg-red"] {
    background: linear-gradient(110deg,#0756b8,#168bff) !important;
    border-color: #63b8ff !important;
    color: #fff !important;
}

/* Bordes rojos de Tailwind */
#vista-app [class*="border-rose"],
#vista-app [class*="border-red"],
#vista-app [class*="border-pink"] {
    border-color: #168bff !important;
}

/* Textos rojos */
#vista-app [class*="text-rose"],
#vista-app [class*="text-red"],
#vista-app [class*="text-pink"] {
    color: #65baff !important;
}

/* Brillos */
#vista-app [class*="shadow-rose"],
#vista-app [class*="shadow-red"] {
    --tw-shadow-color: #168bff55 !important;
}

/* Logo */
#vista-app header h1 {
    color: white !important;
    text-shadow: 0 0 14px #168bff88 !important;
}

/* Radar: conservar sus colores de aeronaves */
#gc-traccar-contenedor,
#gc-radar-preview {
    border-color: #168bff !important;
}

/* Elementos de formularios */
#vista-app input:focus,
#vista-app select:focus,
#vista-app textarea:focus {
    border-color: #168bff !important;
    outline-color: #168bff !important;
}

/* Sobrescribir colores rojos definidos por temas antiguos */
#vista-app {
    --gc-red: #168bff;
    --gc-accent: #168bff;
    --gc-border: #168bff;
    --gc-glow: #168bff66;
}

/* Correccion visual global de bordes */
#vista-app [style*="border-color: rgb(225, 29, 72)"],
#vista-app [style*="border-color: #168bff"] {
    border-color: #168bff !important;
}
</style>
<link id="gc-tema-azul" rel="stylesheet" href="/geocarga-azul.css?v=20261108">
</head>
<body class="bg-slate-900 text-slate-100 min-h-screen">

  <!-- VISTA 1: LOGIN -->
  <div id="vista-login" class="flex min-h-screen items-center justify-center p-4">
    <div class="bg-slate-800 p-8 rounded-xl shadow-2xl border border-slate-700 w-full max-w-md">
      <div class="text-center mb-6">
        <h1 class="text-3xl font-bold text-sky-400">GeoCarga</h1>
        <p class="text-xs text-slate-400 mt-1">Control Logístico y Rastreo Transfronterizo</p>
      </div>

      <div id="error-login" class="hidden mb-4 p-3 bg-rose-950 border border-rose-800 text-rose-300 text-sm rounded-lg"></div>

      <form id="form-login" class="space-y-4">
        <div>
          <label class="block text-xs font-semibold uppercase text-slate-300 mb-1">Correo Electrónico</label>
          <input type="email" id="correo" value="admin@geocarga.com" required 
            class="w-full px-4 py-2 bg-slate-900 border border-slate-700 rounded-lg focus:outline-none focus:border-sky-500 text-white text-sm">
        </div>
        <div>
          <label class="block text-xs font-semibold uppercase text-slate-300 mb-1">Contraseña</label>
          <input type="password" id="contrasena" required 
            class="w-full px-4 py-2 bg-slate-900 border border-slate-700 rounded-lg focus:outline-none focus:border-sky-500 text-white text-sm">
        </div>
        <button type="submit" 
          class="w-full py-2.5 bg-sky-600 hover:bg-sky-500 font-semibold rounded-lg text-white transition">
          Iniciar Sesión
        </button>
      </form>
    </div>
  </div>

  <!-- VISTA 2: APLICACIÓN PRINCIPAL -->
  <div id="vista-app" class="hidden min-h-screen flex flex-col">
    <header class="bg-slate-800 border-b border-slate-700 px-6 py-4 flex justify-between items-center">
      <div class="flex items-center space-x-3">
        <div class="gc-brand">
  <div class="gc-emblem gc-ozzy-bat" title="Ozzy Bat">
  <span class="gc-bat-wings">🦇</span>
  <span class="gc-bat-head">💀</span>
</div>
  <div>
    <div class="gc-brand-name">GEOCARGA</div>
    <div class="gc-brand-sub">AIR OPERATIONS COMMAND</div>
  </div>
</div>
        <span class="bg-sky-950 text-sky-400 text-xs px-2.5 py-0.5 rounded border border-sky-800" id="tag-rol">Rol</span>
      </div>
      <div class="flex items-center space-x-4">
        <span class="text-sm text-slate-300" id="nombre-usuario">Usuario</span>
        <button onclick="cerrarSesion()" class="text-xs bg-rose-900/60 hover:bg-rose-800 text-rose-200 px-3 py-1.5 rounded-lg border border-rose-700">
          Cerrar Sesión
        </button>
      </div>
    </header>

    <div id="area-aplicacion" class="flex flex-1">
      <!-- Menú Lateral Dinámico por Roles -->
      <aside class="w-64 bg-slate-800/50 border-r border-slate-700 p-4 space-y-2">
        <button onclick="cambiarSeccion('dashboard')" id="btn-nav-dashboard" class="w-full text-left px-4 py-2.5 rounded-lg text-sm font-medium bg-sky-600 text-white">
          📊 Dashboard General
        </button>
        <button onclick="cambiarSeccion('nuevo-pedido')" id="btn-nav-pedido" class="w-full text-left px-4 py-2.5 rounded-lg text-sm font-medium text-slate-300 hover:bg-slate-700/50">
          📦 Registrar Pedido
        </button>
        <button onclick="cambiarSeccion('documentos')" id="btn-nav-documentos" class="w-full text-left px-4 py-2.5 rounded-lg text-sm font-medium text-slate-300 hover:bg-slate-700/50">
          📎 Documentación y Guías
        </button>
        <button onclick="cambiarSeccion('tracer')" id="btn-nav-tracer" class="w-full text-left px-4 py-2.5 rounded-lg text-sm font-medium text-slate-300 hover:bg-slate-700/50">
          🛰️ Rastreo Tracer
        </button>
        <button onclick="cambiarSeccion('acceso-limitado')" id="btn-nav-mis-envios" class="hidden px-4 py-2.5 rounded-lg text-sm">Mis envíos</button>
        <button onclick="cambiarSeccion('usuarios')" id="btn-nav-usuarios" class="hidden w-full text-left px-4 py-2.5 rounded-lg text-sm font-medium">Usuarios</button>
        <button onclick="cambiarSeccion('reportes')" id="btn-nav-reportes" class="w-full text-left px-4 py-2.5 rounded-lg text-sm font-medium text-slate-300 hover:bg-slate-700/50">
          📄 Reporte de Operaciones
        </button>
      </aside>

      <main class="flex-1 p-6 space-y-6">

        <section id="sec-acceso-limitado" class="hidden p-5 bg-slate-800 rounded-xl">
          <h2 class="text-xl font-semibold mb-3">Mis envíos</h2>
          <p id="mensaje-mis-envios" role="status"></p>
          <ul id="mis-envios" class="space-y-3"></ul>
        </section>
        <section id="sec-usuarios" class="hidden max-w-3xl p-6 bg-slate-800 rounded-xl space-y-4">
          <h2 class="text-xl font-semibold">Crear usuario</h2>
          <form id="form-usuario" class="grid gap-3">
            <label>Nombre <input name="nombre" required maxlength="120" class="block w-full bg-slate-900 rounded p-2"></label>
            <label>Correo <input name="correo" type="email" required maxlength="254" class="block w-full bg-slate-900 rounded p-2"></label>
            <label>Contraseña inicial <input name="contrasena" type="password" minlength="12" autocomplete="new-password" required class="block w-full bg-slate-900 rounded p-2"></label>
            <label>Rol <select name="rol" required class="block w-full bg-slate-900 rounded p-2"></select></label>
            <button class="bg-sky-700 rounded p-2">Crear usuario</button>
          </form>
          <p id="mensaje-usuarios" role="status"></p>
          <h3 class="font-semibold">Asignar un envío</h3>
          <form id="form-asignar" class="flex flex-wrap gap-2 items-end">
            <label>Operación <select name="operacion" required class="block bg-slate-900 rounded p-2"></select></label>
            <label>Cliente o conductor <select name="usuario" required class="block bg-slate-900 rounded p-2"></select></label>
            <button class="bg-sky-700 rounded p-2">Asignar</button>
          </form>
          <h3 class="font-semibold">Usuarios registrados</h3>
          <ul id="lista-usuarios" class="space-y-2"></ul>
        </section>
        <!-- DASHBOARD -->
        <section id="sec-dashboard" class="space-y-6">

          <div class="gc-dashboard-title">
            <h2>⚡ CENTRO DE OPERACIONES</h2>
            <span class="gc-live">● GEOCARGA / DEMO LOCAL</span>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div class="gc-panel">
              <p class="text-xs text-slate-400 uppercase">Cargas en Tránsito</p>
              <h3 class="text-3xl font-bold text-sky-400 mt-2" id="kpi-transito">0</h3>
            </div>
            <div class="gc-panel">
              <p class="text-xs text-slate-400 uppercase">En Aduana</p>
              <h3 class="text-3xl font-bold text-amber-400 mt-2" id="kpi-aduana">0</h3>
            </div>
            <div class="gc-panel">
              <p class="text-xs text-slate-400 uppercase">Entregados</p>
              <h3 class="text-3xl font-bold text-emerald-400 mt-2" id="kpi-entregados">0</h3>
            </div>
          </div>

          <div class="gc-control-grid">

            <div class="gc-panel">
              <div class="gc-panel-heading">✈ RADAR DE OPERACIONES / SUDAMÉRICA</div>
              <div class="gc-radar-frame">
                <div class="gc-radar-label">GEOCARGA RADAR</div>
                <div id="gc-radar-preview">
  <div class="gc-radar-message">
    <div style="font-size:48px">✈</div>
    <h3>RADAR DE SUDAMÉRICA</h3>
    <p>Visualización de aeronaves GeoCarga</p>
    <button onclick="cambiarSeccion('tracer')">
      ACTIVAR RADAR EN VIVO
    </button>
  </div>
</div>
              </div>
            </div>

            <div class="gc-side-stack">
              <div class="gc-panel">
                <div class="gc-panel-heading">⚡ ESTADO LOGÍSTICO</div>

                <div class="gc-stat">
                  <div class="gc-stat-label">Cargas en tránsito</div>
                  <div class="gc-stat-value" id="gc-transito">--</div>
                </div>

                <div class="gc-stat">
                  <div class="gc-stat-label">En aduana</div>
                  <div class="gc-stat-value" id="gc-aduana">--</div>
                </div>

                <div class="gc-stat">
                  <div class="gc-stat-label">Entregados</div>
                  <div class="gc-stat-value" id="gc-entregados">--</div>
                </div>
              </div>

              <div class="gc-panel">
                <div class="gc-panel-heading">📡 ACCESO AL RADAR</div>
                <p class="text-sm text-slate-400 mb-4">
                  Consulta las aeronaves y su posición en el módulo de rastreo.
                </p>
                <button onclick="cambiarSeccion('tracer')"
                  class="w-full bg-sky-600 text-white py-3 rounded-lg font-bold">
                  ABRIR RADAR COMPLETO
                </button>
              </div>
            </div>
          </div>

          <div class="gc-panel">
            <div class="gc-panel-heading">⚠ ÚLTIMAS ALERTAS / NOVEDADES</div>
            <div id="lista-novedades" class="space-y-2 text-sm text-slate-300">
              Cargando alertas...
            </div>
          </div>

          <div class="gc-footer">
            GEOCARGA METAL EDITION · CENTRO DE CONTROL LOGÍSTICO
          </div>

        </section>
        <!-- REGISTRAR PEDIDO -->
        <section id="sec-nuevo-pedido" class="hidden max-w-2xl bg-slate-800 p-6 rounded-xl border border-slate-700 space-y-4">
          <h2 class="text-xl font-semibold">Generar Nuevo Pedido de Carga</h2>
          <div id="mensaje-pedido" class="hidden p-3 rounded text-sm"></div>

          <form id="form-pedido" class="space-y-4">
            <div>
              <label class="block text-xs uppercase font-medium text-slate-300 mb-1">Vuelo / Guía Aérea</label>
              <select id="ped-vuelo" class="w-full bg-slate-900 border border-slate-700 p-2.5 rounded text-white text-sm" required></select>
            </div>
            <div class="grid grid-cols-2 gap-4">
              <div>
                <label class="block text-xs uppercase font-medium text-slate-300 mb-1">Etapa Inicial</label>
                <select id="ped-etapa" class="w-full bg-slate-900 border border-slate-700 p-2.5 rounded text-white text-sm">
                  <option value="ORIGEN_PREPARACION">Origen - Preparación</option>
                  <option value="DESPACHO_AEROPUERTO">Despacho Aeropuerto</option>
                  <option value="EN_VUELO">En Vuelo</option>
                  <option value="EN_ADUANA">En Aduana</option>
                </select>
              </div>
              <div>
                <label class="block text-xs uppercase font-medium text-slate-300 mb-1">Estado General</label>
                <select id="ped-estado" class="w-full bg-slate-900 border border-slate-700 p-2.5 rounded text-white text-sm">
                  <option value="EN_TRANSITO">EN_TRANSITO</option>
                  <option value="PENDIENTE">PENDIENTE</option>
                </select>
              </div>
            </div>
            <div>
              <label class="block text-xs uppercase font-medium text-slate-300 mb-1">Detalle / Notas del Pedido</label>
              <textarea id="ped-detalle" rows="2" placeholder="Ej: Mercancía farmacéutica con cadena de frío..." class="w-full bg-slate-900 border border-slate-700 p-2.5 rounded text-white text-sm"></textarea>
            </div>
            <button type="submit" class="bg-sky-600 hover:bg-sky-500 font-semibold px-5 py-2.5 rounded text-white text-sm">
              Crear Operación Logística
            </button>
          </form>
        </section>

        <!-- DOCUMENTACIÓN Y GUÍAS (NUEVO MÓDULO) -->
        <section id="sec-documentos" class="hidden space-y-6">
          <div class="max-w-2xl bg-slate-800 p-6 rounded-xl border border-slate-700 space-y-4">
            <h2 class="text-xl font-semibold">Adjuntar Guía / Documento Digital</h2>
            <div id="mensaje-doc" class="hidden p-3 rounded text-sm"></div>

            <form id="form-documento" class="space-y-4" enctype="multipart/form-data">
              <div class="grid grid-cols-2 gap-4">
                <div>
                  <label class="block text-xs uppercase font-medium text-slate-300 mb-1">ID Operación</label>
                  <select id="doc-operacion" class="w-full bg-slate-900 border border-slate-700 p-2.5 rounded text-white text-sm" required></select>
                </div>
                <div>
                  <label class="block text-xs uppercase font-medium text-slate-300 mb-1">Tipo de Documento</label>
                  <select id="doc-tipo" class="w-full bg-slate-900 border border-slate-700 p-2.5 rounded text-white text-sm">
                    <option value="AWB_GUIA_AEREA">Guía Aérea (AWB)</option>
                    <option value="FACTURA_COMERCIAL">Factura Comercial</option>
                    <option value="DECLARACION_ADUANAS">Declaración de Aduana</option>
                    <option value="CERTIFICADO_ORIGEN">Certificado de Origen / Fitosanitario</option>
                  </select>
                </div>
              </div>
              <div>
                <label class="block text-xs uppercase font-medium text-slate-300 mb-1">Archivo (PDF o Imagen)</label>
                <input type="file" id="doc-archivo" accept=".pdf,.png,.jpg,.jpeg" required class="w-full bg-slate-900 border border-slate-700 p-2 rounded text-slate-300 text-sm">
              </div>
              <button type="submit" class="bg-sky-600 hover:bg-sky-500 font-semibold px-5 py-2.5 rounded text-white text-sm">
                Subir y Vincular Documento
              </button>
            </form>
          </div>

          <div class="bg-slate-800 p-6 rounded-xl border border-slate-700 space-y-4">
            <div class="flex justify-between items-center">
              <h3 class="text-base font-semibold">Documentos Registrados en el Sistema</h3>
              <button onclick="cargarListaDocumentos()" class="text-xs bg-slate-700 hover:bg-slate-600 px-3 py-1.5 rounded">🔄 Actualizar</button>
            </div>
            <div class="overflow-x-auto">
              <table class="w-full text-left text-sm text-slate-300">
                <thead class="bg-slate-900/80 text-xs uppercase text-slate-400 border-b border-slate-700">
                  <tr>
                    <th class="p-3">ID Doc</th>
                    <th class="p-3">Operación</th>
                    <th class="p-3">Tipo</th>
                    <th class="p-3">Fecha de Carga</th>
                    <th class="p-3">Acción</th>
                  </tr>
                </thead>
                <tbody id="tabla-docs-body" class="divide-y divide-slate-700"></tbody>
              </table>
            </div>
          </div>
        </section>

        <!-- RASTREO TRACER -->
        <section id="sec-tracer" class="hidden space-y-6">
          <div id="busqueda-operacion" class="bg-slate-800 p-5 rounded-xl border border-slate-700 flex flex-col sm:flex-row gap-4 items-center">
            <input type="number" id="input-buscar-id" aria-label="ID de la operación (opcional)" placeholder="ID de operación (opcional)" class="w-full sm:w-80 bg-slate-900 border border-slate-700 px-4 py-2.5 rounded text-sm text-white">
            <button onclick="buscarRastreo()" class="w-full sm:w-auto bg-sky-600 hover:bg-sky-500 px-5 py-2.5 rounded text-sm font-semibold">
              Rastrear aviones
            </button>
          </div>

          <p id="mensaje-rastreo" role="status"></p>
          <p id="telemetria" role="status"></p>
          <div id="flota-radar" class="hidden bg-slate-800 rounded-xl p-5 overflow-x-auto" style="display:none !important;">
            <h2 class="text-lg font-semibold">Aviones en el radar</h2>
            <form id="form-filtro-avion" class="my-3 flex flex-wrap items-center gap-2">
              <label for="filtro-avion">Aeronave</label>
              <select id="filtro-avion" class="bg-slate-900 border border-slate-600 rounded px-2 py-1">
                <option value="">Todos los aviones</option>
              </select>
              <button class="bg-sky-700 rounded px-3 py-1">Filtrar</button>
              <button type="button" id="limpiar-filtro-avion" class="bg-slate-700 rounded px-3 py-1">Ver todos</button>
            </form>
            <p id="estado-flota" role="status" class="my-2 text-sm text-slate-300"></p>
            <div id="mapa-flota" aria-label="Mapa de aeronaves" class="mb-3 rounded-lg"></div>
            <p id="estado-mapa" role="status" class="mb-3 text-sm text-slate-300"></p>
            <table class="w-full text-left text-sm">
              <thead><tr class="border-b border-slate-700">
                <th class="p-2">Aeronave</th><th class="p-2">Ruta</th><th class="p-2">Estado</th>
                <th class="p-2">Última posición</th><th class="p-2">Altitud</th>
              </tr></thead>
              <tbody id="filas-flota"></tbody>
            </table>
          </div>
          <div id="resultado-tracer" class="hidden space-y-6">
            <div class="bg-slate-800 p-6 rounded-xl border border-slate-700 grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <span class="text-xs text-slate-400 block uppercase">Operación</span>
                <span id="tracer-id" class="text-lg font-bold text-sky-400">#0</span>
              </div>
              <div>
                <span class="text-xs text-slate-400 block uppercase">Vuelo / Aerolínea</span>
                <span id="tracer-vuelo" class="text-sm font-semibold text-slate-200">-</span>
              </div>
              <div>
                <span class="text-xs text-slate-400 block uppercase">Ruta</span>
                <span id="tracer-ruta" class="text-sm font-semibold text-slate-200">-</span>
              </div>
              <div>
                <span class="text-xs text-slate-400 block uppercase">Estado</span>
                <span id="tracer-estado" class="text-xs px-2.5 py-1 rounded font-bold">-</span>
              </div>
            </div>

            <div class="bg-slate-800 p-6 rounded-xl border border-slate-700">
              <h3 class="text-base font-semibold text-slate-200 mb-4">Línea de Tiempo del Envío (Tracer)</h3>
              <div id="tracer-linea" class="space-y-4 border-l-2 border-sky-500 pl-4 ml-2"></div>
              <section id="panel-incidencias" class="hidden mt-5 space-y-3">
                <h3 class="font-semibold">Incidencias del envío</h3>
                <p id="mensaje-incidencias" role="status"></p>
                <ul id="lista-incidencias" class="space-y-2"></ul>
                <form id="form-incidencia" class="hidden space-y-2">
                  <label class="block">Tipo <select name="tipo" required class="bg-slate-900 p-2 rounded">
                    <option>Retraso</option><option>Retención aduanera</option><option>Documento pendiente</option><option>Daño</option><option>Otra</option>
                  </select></label>
                  <label class="block">Descripción <textarea name="descripcion" required maxlength="500" class="block w-full bg-slate-900 p-2 rounded"></textarea></label>
                  <button class="bg-sky-700 rounded px-3 py-2">Reportar novedad</button>
                </form>
              </section>
            </div>
          </div>
        </section>

        <!-- REPORTES GENERALES -->
        <section id="sec-reportes" class="hidden space-y-4">
          <form id="filtro-vuelo" class="flex gap-3">
            <label for="numero-vuelo">Número de vuelo</label>
            <input id="numero-vuelo" class="bg-slate-800 border rounded px-2" placeholder="Ej. GC100001">
            <button class="bg-sky-700 rounded px-3">Filtrar</button>
          </form>
          <p id="mensaje-vuelos" role="status"></p>
          <div class="flex justify-between items-center">
            <h2 class="text-xl font-semibold">Reporte General de Operaciones</h2>
                        <button type="button" onclick="descargarPDFGeneral()" class="bg-sky-700 hover:bg-sky-600 text-white px-4 py-2 rounded-lg text-sm font-semibold">
              Descargar PDF General
            </button>
            <button onclick="cargarReportes()" class="text-xs bg-slate-700 hover:bg-slate-600 px-3 py-1.5 rounded-lg text-slate-200">
              🔄 Actualizar Datos
            </button>
          </div>
          <div class="overflow-x-auto bg-slate-800 rounded-xl border border-slate-700">
            <table class="w-full text-left text-sm text-slate-300">
              <thead class="bg-slate-900/80 text-xs uppercase text-slate-400 border-b border-slate-700">
                <tr>
                  <th class="p-3.5">ID</th>
                  <th class="p-3.5">Vuelo</th>
                  <th class="p-3.5">Aerolínea</th>
                  <th class="p-3.5">Ruta</th>
                  <th class="p-3.5">Etapa</th>
                  <th class="p-3.5">Estado</th>
                  <th class="p-3.5">Docs</th>
                  <th class="p-3.5">Novedades</th>
                  <th class="p-3.5">Acción</th>
                </tr>
              </thead>
              <tbody id="tabla-reportes-body" class="divide-y divide-slate-700"></tbody>
            </table>
          </div>
        </section>

      </main>
    </div>
  </div>

  <script>
    const API_URL = '/api';
    function escaparTexto(valor) {
      const elemento = document.createElement('span');
      elemento.textContent = valor;
      return elemento.innerHTML;
    }

    document.getElementById('form-login').addEventListener('submit', async (e) => {
      e.preventDefault();
      const correo = document.getElementById('correo').value;
      const contrasena = document.getElementById('contrasena').value;
      const errorDiv = document.getElementById('error-login');

      try {
        const res = await fetch(API_URL + '/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ correo, contrasena })
        });
        const data = await res.json();

        if (!res.ok) {
          errorDiv.textContent = data.mensaje || 'Error al iniciar sesión';
          errorDiv.classList.remove('hidden');
          return;
        }

        localStorage.setItem('geocarga_user', JSON.stringify(data.usuario));
        mostrarAplicacion(data.usuario);
      } catch (err) {
        errorDiv.textContent = 'Error al conectar con el servidor';
        errorDiv.classList.remove('hidden');
      }
    });

    const formUsuario = document.getElementById('form-usuario');
    const mensajeUsuarios = document.getElementById('mensaje-usuarios');

    async function cargarUsuarios() {
      try {
        const res = await fetch(API_URL + '/usuarios');
        const datos = await res.json();
        if (!res.ok) throw new Error(datos.mensaje);
        formUsuario.elements.rol.replaceChildren(new Option('Selecciona un rol', ''));
        for (const rol of datos.roles) formUsuario.elements.rol.add(new Option(rol, rol));
        const asignar = document.getElementById('form-asignar');
        asignar.elements.usuario.replaceChildren(new Option('Selecciona una cuenta', ''));
        for (const usuario of datos.usuarios) {
          if (['Cliente', 'Conductor'].includes(usuario.rol)) {
            asignar.elements.usuario.add(new Option(usuario.nombre + ' · ' + usuario.rol, usuario.id));
          }
        }
        const operaciones = await fetch(API_URL + '/reportes/operaciones').then(respuesta => respuesta.json());
        asignar.elements.operacion.replaceChildren(new Option('Selecciona un envío', ''));
        for (const operacion of operaciones) {
          asignar.elements.operacion.add(new Option('#' + operacion.id_operacion + ' · ' + operacion.numero_vuelo, operacion.id_operacion));
        }
        const lista = document.getElementById('lista-usuarios');
        lista.replaceChildren();
        for (const usuario of datos.usuarios) {
          const item = document.createElement('li');
          item.textContent = usuario.nombre + ' · ' + usuario.correo + ' · ' + usuario.rol;
          lista.append(item);
        }
      } catch (error) {
        mensajeUsuarios.textContent = error.message;
      }
    }

    formUsuario.addEventListener('submit', async evento => {
      evento.preventDefault();
      const boton = formUsuario.querySelector('button');
      boton.disabled = true;
      try {
        const res = await fetch(API_URL + '/usuarios', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(Object.fromEntries(new FormData(formUsuario)))
        });
        const datos = await res.json();
        if (!res.ok) throw new Error(datos.mensaje);
        formUsuario.reset();
        mensajeUsuarios.textContent = 'Usuario creado. Ya puede iniciar sesión.';
        await cargarUsuarios();
      } catch (error) {
        mensajeUsuarios.textContent = error.message;
      } finally {
        boton.disabled = false;
      }
    });

    document.getElementById('form-asignar').addEventListener('submit', async evento => {
      evento.preventDefault();
      try {
        const respuesta = await fetch(API_URL + '/asignaciones', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(Object.fromEntries(new FormData(evento.target)))
        });
        const resultado = await respuesta.json();
        if (!respuesta.ok) throw new Error(resultado.mensaje);
        mensajeUsuarios.textContent = 'Envío asignado.';
      } catch (error) {
        mensajeUsuarios.textContent = error.message;
      }
    });

    async function cargarMisEnvios() {
      const lista = document.getElementById('mis-envios');
      const mensaje = document.getElementById('mensaje-mis-envios');
      lista.replaceChildren();
      try {
        const respuesta = await fetch(API_URL + '/mis-envios');
        if (!respuesta.ok) throw new Error('No se pudieron consultar tus envíos.');
        const envios = await respuesta.json();
        mensaje.textContent = envios.length ? '' : 'Todavía no tienes envíos asignados.';
        for (const envio of envios) {
          const item = document.createElement('li');
          const boton = document.createElement('button');
          boton.className = 'bg-sky-700 rounded px-3 py-2';
          boton.textContent = 'Rastrear #' + envio.id_operacion + ' · ' + envio.numero_vuelo + ' · ' + envio.estado_general;
          boton.addEventListener('click', () => irARastrear(envio.id_operacion));
          item.append(boton);
          lista.append(item);
        }
      } catch (error) {
        mensaje.textContent = error.message;
      }
    }

    function aplicarControlRoles(rol) {
      const interno = ['Administrador', 'Operador logístico', 'Supervisor', 'Auditor'].includes(rol);
      const escritura = ['Administrador', 'Operador logístico'].includes(rol);
      document.getElementById('btn-nav-usuarios').classList.toggle('hidden', rol !== 'Administrador');
      for (const modulo of ['dashboard', 'documentos', 'tracer', 'reportes']) {
        document.getElementById('btn-nav-' + modulo).classList.toggle('hidden', !interno);
      }
      document.getElementById('btn-nav-documentos').classList.toggle('hidden', !interno && !['Cliente', 'Conductor'].includes(rol));
      document.getElementById('btn-nav-tracer').classList.toggle('hidden', !interno && !['Cliente', 'Conductor'].includes(rol));
      document.getElementById('btn-nav-mis-envios').classList.toggle('hidden', interno);
      document.getElementById('btn-nav-pedido').classList.toggle('hidden', !escritura);
      document.getElementById('form-documento').classList.toggle('hidden', !escritura);
    }

    function mostrarAplicacion(usuario) {
      document.getElementById('vista-login').classList.add('hidden');
      document.getElementById('vista-app').classList.remove('hidden');
      document.getElementById('nombre-usuario').textContent = usuario.nombre;
      document.getElementById('tag-rol').textContent = usuario.rol;
      const interno = ['Administrador', 'Operador logístico', 'Supervisor', 'Auditor'].includes(usuario.rol);
      cambiarSeccion(interno ? 'dashboard' : 'acceso-limitado');
      aplicarControlRoles(usuario.rol);
      if (interno) cargarVuelosDisponibles();
    }

    async function cerrarSesion() {
      await fetch(API_URL + '/auth/logout', { method: 'POST' });
      localStorage.removeItem('geocarga_user');
      location.reload();
    }

    function cambiarSeccion(seccion) {
      ['dashboard', 'nuevo-pedido', 'documentos', 'tracer', 'reportes', 'usuarios', 'acceso-limitado'].forEach(s => {
        const elem = document.getElementById('sec-' + s);
        if (elem) elem.classList.add('hidden');
        const navMap = { 'nuevo-pedido': 'pedido', 'documentos': 'documentos', 'dashboard': 'dashboard', 'tracer': 'tracer', 'reportes': 'reportes', 'usuarios': 'usuarios' };
        const btn = document.getElementById('btn-nav-' + navMap[s]);
        if (btn) btn.className = "w-full text-left px-4 py-2.5 rounded-lg text-sm font-medium text-slate-300 hover:bg-slate-700/50";
      });

      const actual = document.getElementById('sec-' + seccion);
      if (actual) actual.classList.remove('hidden');
      const navMapActual = { 'nuevo-pedido': 'pedido', 'documentos': 'documentos', 'dashboard': 'dashboard', 'tracer': 'tracer', 'reportes': 'reportes', 'usuarios': 'usuarios' };
      const btnActual = document.getElementById('btn-nav-' + navMapActual[seccion]);
      if (btnActual) btnActual.className = "w-full text-left px-4 py-2.5 rounded-lg text-sm font-medium bg-sky-600 text-white";

      if (seccion === 'dashboard') cargarDashboard();
      const usuario = JSON.parse(localStorage.getItem('geocarga_user') || '{}');
      aplicarControlRoles(usuario.rol);
      if (seccion === 'usuarios') cargarUsuarios();
      if (seccion === 'acceso-limitado') cargarMisEnvios();
      if (seccion === 'nuevo-pedido') cargarVuelosDisponibles();
      if (seccion === 'reportes') cargarReportes();
      if (seccion === 'tracer') {
        encuadrarRadar = true;
        cargarFlotaRadar();
      }
      if (seccion === 'documentos') {
        cargarOperacionesParaDocs();
        cargarListaDocumentos();
      }
    }

    async function cargarDashboard() {
      try {
        const res = await fetch(API_URL + '/dashboard');

        if (!res.ok) {
          throw new Error('Error al consultar el dashboard: HTTP ' + res.status);
        }

        const data = await res.json();

        if (!data.resumen) {
          throw new Error('El servidor no devolvió el resumen de operaciones');
        }
        document.getElementById('kpi-transito').textContent = data.resumen.en_transito || 0;
        document.getElementById('kpi-aduana').textContent = data.resumen.en_aduana || 0;
        document.getElementById('kpi-entregados').textContent = data.resumen.entregados || 0;

        const contNovedades = document.getElementById('lista-novedades');
        if (!data.novedadesRecientes || data.novedadesRecientes.length === 0) {
          contNovedades.innerHTML = '<p class="text-slate-500">Sin incidencias activas.</p>';
          return;
        }

        contNovedades.innerHTML = data.novedadesRecientes.map(function(n) {
          return '<div class="flex justify-between items-center bg-slate-900/60 p-3 rounded-lg border border-slate-700/60">' +
            '<div><span class="text-xs font-bold text-amber-400">[' + escaparTexto(n.tipo) + ']</span> <span class="ml-2">' + escaparTexto(n.descripcion) + '</span>' +
            '<span class="text-xs text-slate-400 block mt-0.5">Operación #' + n.id_operacion + ' (Vuelo ' + n.numero_vuelo + ')</span></div>' +
            '<button type="button" class="text-xs bg-sky-700 rounded px-2 py-1" onclick="irARastrear(' + Number(n.id_operacion) + ')">' +
            (n.validada_en ? 'Ver validada' : 'Revisar pendiente') + '</button></div>';
        }).join('');
      } catch (err) {
        console.error(err);
      }
    }

    async function cargarVuelosDisponibles() {
      try {
        const res = await fetch(API_URL + '/vuelos');
        const vuelos = await res.json();
        const sel = document.getElementById('ped-vuelo');
        sel.innerHTML = vuelos.map(v => '<option value="' + v.id_vuelo + '">' + v.numero_vuelo + ' - ' + v.aerolinea + ' (' + v.origen + ' -> ' + v.destino + ')</option>').join('');
      } catch (err) {
        console.error(err);
      }
    }

    async function cargarOperacionesParaDocs() {
      try {
        const res = await fetch(API_URL + '/reportes/operaciones');
        const ops = await res.json();
        const sel = document.getElementById('doc-operacion');
        sel.innerHTML = ops.map(o => '<option value="' + o.id_operacion + '">Operación #' + o.id_operacion + ' (' + o.numero_vuelo + ' - ' + o.origen + ' a ' + o.destino + ')</option>').join('');
      } catch (err) {
        console.error(err);
      }
    }

    // FORMULARIO: REGISTRAR PEDIDO
    document.getElementById('form-pedido').addEventListener('submit', async (e) => {
      e.preventDefault();
      const id_vuelo = document.getElementById('ped-vuelo').value;
      const etapa_flujo = document.getElementById('ped-etapa').value;
      const estado_general = document.getElementById('ped-estado').value;
      const detalle = document.getElementById('ped-detalle').value;
      const msg = document.getElementById('mensaje-pedido');
      const user = JSON.parse(localStorage.getItem('geocarga_user') || '{}');

      try {
        const res = await fetch(API_URL + '/operaciones', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id_vuelo, etapa_flujo, estado_general, detalle, id_usuario: user.id || 1 })
        });
        const data = await res.json();

        if (res.ok) {
          msg.className = "p-3 rounded text-sm bg-emerald-950 border border-emerald-700 text-emerald-300 block";
          msg.textContent = '¡Operación #' + data.operacion.id_operacion + ' creada con éxito!';
          document.getElementById('form-pedido').reset();
          cargarOperacionesParaDocs();
        } else {
          msg.className = "p-3 rounded text-sm bg-rose-950 border border-rose-700 text-rose-300 block";
          msg.textContent = data.mensaje || 'Error al crear la operación';
        }
      } catch (err) {
        msg.className = "p-3 rounded text-sm bg-rose-950 border border-rose-700 text-rose-300 block";
        msg.textContent = 'Error al contactar al servidor';
      }
    });

    // FORMULARIO: SUBIR DOCUMENTO
    document.getElementById('form-documento').addEventListener('submit', async (e) => {
      e.preventDefault();
      const id_operacion = document.getElementById('doc-operacion').value;
      const tipo_documento = document.getElementById('doc-tipo').value;
      const archivoInput = document.getElementById('doc-archivo');
      const msg = document.getElementById('mensaje-doc');
      const user = JSON.parse(localStorage.getItem('geocarga_user') || '{}');

      if (!archivoInput.files[0]) return;

      const formData = new FormData();
      formData.append('id_operacion', id_operacion);
      formData.append('tipo_documento', tipo_documento);
      formData.append('id_usuario', user.id || 1);
      formData.append('archivo', archivoInput.files[0]);

      try {
        const res = await fetch(API_URL + '/documentos', {
          method: 'POST',
          body: formData
        });
        const data = await res.json();

        if (res.ok) {
          msg.className = "p-3 rounded text-sm bg-emerald-950 border border-emerald-700 text-emerald-300 block";
          msg.textContent = '¡Documento cargado y vinculado a la Operación #' + id_operacion + '!';
          document.getElementById('form-documento').reset();
          cargarListaDocumentos();
        } else {
          msg.className = "p-3 rounded text-sm bg-rose-950 border border-rose-700 text-rose-300 block";
          msg.textContent = data.mensaje || 'Error al subir documento';
        }
      } catch (err) {
        msg.className = "p-3 rounded text-sm bg-rose-950 border border-rose-700 text-rose-300 block";
        msg.textContent = 'Error en el servidor al subir archivo';
      }
    });

    async function cargarListaDocumentos() {
      try {
        const res = await fetch(API_URL + '/documentos');
        const docs = await res.json();
        const tbody = document.getElementById('tabla-docs-body');

        if (docs.length === 0) {
          tbody.innerHTML = '<tr><td colspan="5" class="p-3 text-slate-500 text-center">No hay documentos cargados.</td></tr>';
          return;
        }

        tbody.innerHTML = docs.map(d => {
          return '<tr class="hover:bg-slate-800/50">' +
            '<td class="p-3 font-mono text-sky-400">#' + d.id_documento + '</td>' +
            '<td class="p-3 font-medium">Operación #' + d.id_operacion + '</td>' +
            '<td class="p-3"><span class="bg-slate-700 px-2 py-0.5 rounded text-xs">' + escaparTexto(d.tipo_documento) + '</span></td>' +
            '<td class="p-3 text-slate-400">' + new Date(d.fecha_carga).toLocaleString() + '</td>' +
            '<td class="p-3"><a href="' + d.url_almacenamiento + '" target="_blank" class="text-xs bg-sky-600 hover:bg-sky-500 px-2.5 py-1 rounded text-white font-medium">Ver Archivo</a></td>' +
          '</tr>';
        }).join('');
      } catch (err) {
        console.error(err);
      }
    }

    // RASTREO TRACER
    const limitesSudamerica = [[-83, -57], [-32, 14]];
    let mapaFlota;
    const marcadoresFlota = new Map();
    let avionesRadar = [];
    const recorridosRadar = new Map();
    let filtroRadar = '';
    let consultaRadar = false;
    let encuadrarRadar = true;
    let animacionRadar;
    const selectorRadar = document.getElementById('filtro-avion');

    function aplicarFiltroRadar() {
      filtroRadar = selectorRadar.value;
      encuadrarRadar = true;
      pintarFlotaRadar();
    }

    document.getElementById('form-filtro-avion').addEventListener('submit', evento => {
      evento.preventDefault();
      aplicarFiltroRadar();
    });
    document.getElementById('limpiar-filtro-avion').addEventListener('click', () => {
      selectorRadar.value = '';
      aplicarFiltroRadar();
    });

    setInterval(() => {
      if (!document.getElementById('sec-tracer').classList.contains('hidden')
          && !document.getElementById('flota-radar').classList.contains('hidden')) {
        cargarFlotaRadar();
      }
    }, 2000);

    let tramoRadar;
    let esperaEstiloRadar = false;

    function actualizarTramoRadar(tramo) {
      tramoRadar = tramo;
      const fuente = mapaFlota.getSource('tramo-radar');
      if (fuente) {
        fuente.setData(tramo);
      } else if (mapaFlota.isStyleLoaded()) {
        mapaFlota.addSource('tramo-radar', { type: 'geojson', data: tramo });
        mapaFlota.addLayer({
          id: 'tramo-radar', type: 'line', source: 'tramo-radar',
          filter: ['==', ['get', 'tipo'], 'pendiente'],
          paint: { 'line-color': ['get', 'color'], 'line-width': 2, 'line-dasharray': [3, 3] }
        });
        mapaFlota.addLayer({
          id: 'recorrido-radar', type: 'line', source: 'tramo-radar',
          filter: ['==', ['get', 'tipo'], 'recorrido'],
          paint: { 'line-color': ['get', 'color'], 'line-width': 4 }
        });
      } else if (!esperaEstiloRadar) {
        esperaEstiloRadar = true;
        mapaFlota.once('load', () => {
          esperaEstiloRadar = false;
          actualizarTramoRadar(tramoRadar);
        });
      }
    }

    function mostrarMapaFlota(aviones) {
      const estado = document.getElementById('estado-mapa');
      cancelAnimationFrame(animacionRadar);
      const ubicados = aviones.filter(avion => Number.isFinite(avion.lat) && Number.isFinite(avion.lon));
      try {
        if (!window.maplibregl) throw new Error('Mapa no disponible');
        if (!mapaFlota) {
          mapaFlota = new maplibregl.Map({
            container: 'mapa-flota',
            style: {
              version: 8,
              sources: {
                sudamerica: {
                  type: 'geojson',
                  data: 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_map_units.geojson',
                  attribution: 'Natural Earth'
                }
              },
              layers: [
                { id: 'oceano', type: 'background', paint: { 'background-color': '#0b2035' } },
                {
                  id: 'paises-sudamerica', type: 'fill', source: 'sudamerica',
                  filter: ['==', ['get', 'CONTINENT'], 'South America'],
                  paint: { 'fill-color': '#203950', 'fill-outline-color': '#69869e' }
                }
              ]
            },
            bounds: limitesSudamerica,
            renderWorldCopies: false
          });
          mapaFlota.addControl(new maplibregl.NavigationControl());
          mapaFlota.on('error', () => {
            document.getElementById('estado-flota').textContent = 'No se pudo cargar el mapa de Sudamérica.';
          });
        }
        estado.textContent = ubicados.length ? 'El avión indica el rumbo. Al filtrar, la línea continua muestra el recorrido y la punteada el tramo hacia el destino.' : 'Sin posiciones para mostrar.';
        const visibles = new Set(ubicados.map(avion => String(avion.id)));
        for (const [id, registro] of marcadoresFlota) {
          if (!visibles.has(id)) {
            registro.marcador.remove();
            marcadoresFlota.delete(id);
          }
        }
        const movimientos = [];
        const limites = new maplibregl.LngLatBounds();
        for (const avion of ubicados) {
          const id = String(avion.id);
          const coordenadas = [avion.lon, avion.lat];
          limites.extend(coordenadas);
          let registro = marcadoresFlota.get(id);
          if (!registro) {
            const boton = document.createElement('button');
            boton.type = 'button';
            boton.style.cssText = 'background: transparent; border: 0; cursor: pointer; padding: 4px;';
            const flecha = document.createElement('span');
            flecha.textContent = '✈︎';
            flecha.style.display = 'inline-block';
            flecha.style.fontSize = '32px';
            flecha.style.filter = 'drop-shadow(0 0 6px currentColor)';
            flecha.style.lineHeight = '1';
            flecha.setAttribute('aria-hidden', 'true');
            boton.append(flecha);
            boton.setAttribute('aria-label', 'Aeronave ' + id);
            const detalle = document.createElement('div');
            detalle.style.color = '#0f172a';
            const marcador = new maplibregl.Marker({ element: boton })
              .setLngLat(coordenadas)
              .setPopup(new maplibregl.Popup({ offset: 18 }).setDOMContent(detalle))
              .addTo(mapaFlota);
            registro = { marcador, detalle, flecha };
            marcadoresFlota.set(id, registro);
          }
          registro.flecha.style.color = avion.color || '#67e8f9';
          registro.flecha.style.transform = 'rotate(' + ((Number(avion.rumbo) || 0) - 90 - mapaFlota.getBearing()) + 'deg)';
          registro.detalle.textContent = 'Aeronave ' + id + ' · ' + avion.origen + ' → ' + avion.destino + ' · ' + (avion.fase || avion.estado) + (avion.carga ? ' · ' + avion.carga : '');
          const desde = registro.marcador.getLngLat();
          if (desde.lng !== avion.lon || desde.lat !== avion.lat) {
            movimientos.push({ marcador: registro.marcador, desde, lon: avion.lon, lat: avion.lat });
          }
        }
        const elegido = filtroRadar && ubicados[0];
        const destino = elegido && elegido.destino_coords;
        const tramo = {
          type: 'FeatureCollection',
          features: Array.isArray(destino) && destino.every(Number.isFinite) ? [{
            type: 'Feature', properties: { tipo: 'pendiente', color: elegido.color || '#67e8f9' },
            geometry: { type: 'LineString', coordinates: [[elegido.lon, elegido.lat], destino] }
          }] : []
        };
        if (tramo.features.length) limites.extend(destino);
        const recorrido = elegido && recorridosRadar.get(String(elegido.id));
        if (recorrido && recorrido.length > 1) {
          tramo.features.push({
            type: 'Feature', properties: { tipo: 'recorrido', color: elegido.color || '#67e8f9' },
            geometry: { type: 'LineString', coordinates: recorrido }
          });
        }
        actualizarTramoRadar(tramo);
        if (encuadrarRadar && (!filtroRadar || ubicados.length)) {
          mapaFlota.resize();
          mapaFlota.fitBounds(filtroRadar ? limites : limitesSudamerica, { padding: 45, maxZoom: filtroRadar ? 5 : 7, duration: 0 });
          encuadrarRadar = false;
        }
        if (movimientos.length) {
          const inicio = performance.now();
          function moverAviones(ahora) {
            const progreso = Math.min(1, (ahora - inicio) / 1800);
            for (const { marcador, desde, lon, lat } of movimientos) {
              marcador.setLngLat([desde.lng + (lon - desde.lng) * progreso, desde.lat + (lat - desde.lat) * progreso]);
            }
            if (progreso < 1) animacionRadar = requestAnimationFrame(moverAviones);
          }
          animacionRadar = requestAnimationFrame(moverAviones);
        }
      } catch {
        estado.textContent = 'Mapa no disponible. Puedes consultar las posiciones en la tabla.';
      }
    }

    function pintarFlotaRadar() {
      const estado = document.getElementById('estado-flota');
      const filas = document.getElementById('filas-flota');
      const aviones = avionesRadar.filter(avion => !filtroRadar || String(avion.id) === filtroRadar);
      filas.replaceChildren();
        estado.textContent = aviones.length
          ? aviones.length + ' aeronaves' + (aviones.every(avion => avion.simulacion) ? ' simuladas' : '')
          : 'El radar no reporta aeronaves.';
        mostrarMapaFlota(aviones);
        for (const avion of aviones) {
          const tienePosicion = Number.isFinite(avion.lat) && Number.isFinite(avion.lon);
          const fila = filas.insertRow();
          fila.className = 'border-b border-slate-700';
          for (const valor of [
            avion.id,
            avion.origen && avion.destino ? avion.origen + ' → ' + avion.destino : 'Sin ruta',
            avion.fase || avion.estado,
            tienePosicion ? avion.lat.toFixed(4) + ', ' + avion.lon.toFixed(4) : 'Sin posición',
            tienePosicion && Number.isFinite(avion.altitud) ? avion.altitud + ' m' : '—'
          ]) {
            const celda = fila.insertCell();
            celda.className = 'p-2';
            celda.textContent = valor;
          }
        }
    }

    async function cargarFlotaRadar() {
      if (consultaRadar) return;
      consultaRadar = true;
      const estado = document.getElementById('estado-flota');
      document.getElementById('flota-radar').classList.remove('hidden');
      if (!avionesRadar.length) estado.textContent = 'Consultando el radar…';
      try {
        const respuesta = await fetch(API_URL + '/radar/aviones', { cache: 'no-store' });
        if (!respuesta.ok) throw new Error('Radar no disponible');
        avionesRadar = await respuesta.json();
        for (const avion of avionesRadar) {
          if (!Number.isFinite(avion.lat) || !Number.isFinite(avion.lon)) continue;
          const id = String(avion.id);
          const recorrido = recorridosRadar.get(id) || [];
          const anterior = recorrido[recorrido.length - 1];
          if (!anterior || anterior[0] !== avion.lon || anterior[1] !== avion.lat) {
            recorridosRadar.set(id, [...recorrido.slice(-299), [avion.lon, avion.lat]]);
          }
        }
        const ids = avionesRadar.map(avion => String(avion.id));
        const opciones = Array.from(selectorRadar.options).slice(1).map(opcion => opcion.value);
        if (ids.join(',') !== opciones.join(',')) {
          const seleccionado = selectorRadar.value;
          selectorRadar.replaceChildren(new Option('Todos los aviones', ''));
          for (const id of ids) selectorRadar.add(new Option('Aeronave ' + id, id));
          selectorRadar.value = ids.includes(seleccionado) ? seleccionado : '';
          if (!ids.includes(filtroRadar)) filtroRadar = '';
        }
        pintarFlotaRadar();
      } catch {
        estado.textContent = 'Radar no disponible. Reintentando cada 2 segundos.';
      } finally {
        consultaRadar = false;
      }
    }

    const formIncidencia = document.getElementById('form-incidencia');
    const mensajeIncidencias = document.getElementById('mensaje-incidencias');

    async function guardarIncidencia(ruta, datos, idOperacion, boton) {
      boton.disabled = true;
      try {
        const respuesta = await fetch(API_URL + ruta, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(datos)
        });
        const resultado = await respuesta.json();
        if (!respuesta.ok) throw new Error(resultado.mensaje);
        if (document.getElementById('input-buscar-id').value === String(idOperacion)) {
          await buscarRastreo(idOperacion);
          mensajeIncidencias.textContent = resultado.mensaje;
        }
        return true;
      } catch (error) {
        mensajeIncidencias.textContent = error.message;
        return false;
      } finally {
        boton.disabled = false;
      }
    }

    formIncidencia.addEventListener('submit', async evento => {
      evento.preventDefault();
      const id = formIncidencia.dataset.operacion;
      const guardado = await guardarIncidencia('/operaciones/' + id + '/incidencias',
        Object.fromEntries(new FormData(formIncidencia)), id, evento.submitter);
      if (guardado) formIncidencia.reset();
    });

    function mostrarIncidencias(datos) {
      const panel = document.getElementById('panel-incidencias');
      panel.classList.toggle('hidden', !datos.incidencias);
      mensajeIncidencias.textContent = '';
      formIncidencia.classList.toggle('hidden', !datos.puedeReportar);
      formIncidencia.dataset.operacion = datos.operacion.id_operacion;
      const lista = document.getElementById('lista-incidencias');
      lista.replaceChildren();
      if (!datos.incidencias) return;
      if (!datos.incidencias.length) {
        const item = document.createElement('li');
        item.textContent = 'No hay incidencias registradas.';
        lista.append(item);
      }
      for (const incidencia of datos.incidencias) {
        const item = document.createElement('li');
        item.className = 'bg-slate-900 rounded p-3';
        item.textContent = incidencia.tipo + ' · ' + incidencia.descripcion + ' · '
          + (incidencia.validada_en ? 'Validada' : 'Pendiente de validación');
        if (datos.puedeValidar && !incidencia.validada_en) {
          const boton = document.createElement('button');
          boton.className = 'ml-3 bg-emerald-800 rounded px-3 py-1';
          boton.textContent = 'Validar';
          boton.addEventListener('click', () => guardarIncidencia('/incidencias/' + incidencia.id_novedad + '/validar',
            {}, datos.operacion.id_operacion, boton));
          item.append(boton);
        }
        lista.append(item);
      }
    }

    async function buscarRastreo(idDirecto) {
      const id = idDirecto || document.getElementById('input-buscar-id').value;
      cargarFlotaRadar();
      if (idDirecto) document.getElementById('input-buscar-id').value = id;

      const mensaje = document.getElementById('mensaje-rastreo');
      const telemetria = document.getElementById('telemetria');
      document.getElementById('resultado-tracer').classList.add('hidden');
      telemetria.textContent = '';
      mensaje.textContent = id ? 'Consultando operación y radar…' : '';
      if (!id) return;
      try {
        const res = await fetch(API_URL + '/operaciones/' + id + '/tracer');
        if (!res.ok) {
          mensaje.textContent = res.status === 404 ? 'Operación no encontrada.' : 'No se pudo consultar la operación.';
          return;
        }
        const data = await res.json();

        // gc-radar-seleccion
        const radarId = data.operacion && data.operacion.radar_id;

        const iframeRadar = document.querySelector(
          "#gc-traccar-contenedor iframe"
        );

        if (iframeRadar && radarId != null && radarId !== "") {
          const urlRadar = new URL(
            "http://127.0.0.1:8000/"
          );

          urlRadar.searchParams.set(
            "avion",
            String(radarId)
          );

          iframeRadar.src = urlRadar.toString();
        }
        document.getElementById('resultado-tracer').classList.remove('hidden');
        document.getElementById('tracer-id').textContent = '#' + data.operacion.id_operacion;
        document.getElementById('tracer-vuelo').textContent = data.operacion.numero_vuelo + ' (' + data.operacion.aerolinea + ')';
        document.getElementById('tracer-ruta').textContent = data.operacion.origen + ' ➔ ' + data.operacion.destino;
        
        mensaje.textContent = 'Etapa logística: ' + data.operacion.etapa_flujo.replaceAll('_', ' ');
        const avion = data.radar.avion;
        telemetria.textContent = 'Radar: ' + data.radar.mensaje;
        if (avion && avion.fase) {
          telemetria.textContent += ' · ' + avion.fase + (avion.simulacion ? ' (simulación)' : '');
        }
        if (avion && avion.lat != null && avion.lon != null) {
          telemetria.textContent += ' · Última posición: ' + avion.lat.toFixed(4) + ', ' + avion.lon.toFixed(4)
            + ' · Altitud: ' + avion.altitud + ' m · Velocidad: ' + avion.velocidad + ' km/h'
            + (avion.actualizado ? ' · Registro: ' + new Date(avion.actualizado).toLocaleString() : '');
        }
        mostrarIncidencias(data);
        const est = document.getElementById('tracer-estado');
        est.textContent = data.operacion.estado_general;
        est.className = "text-xs px-2.5 py-1 rounded font-bold " + (data.operacion.estado_general === 'EN_TRANSITO' ? 'bg-sky-950 text-sky-400 border border-sky-800' : 'bg-emerald-950 text-emerald-400 border border-emerald-800');

        const contenedor = document.getElementById('tracer-linea');
        contenedor.innerHTML = data.historial.map(h => {
          return '<div class="relative mb-3">' +
            '<div class="text-xs text-sky-400 font-mono">' + new Date(h.fecha).toLocaleString() + '</div>' +
            '<div class="text-sm font-semibold text-white">' + escaparTexto(h.accion) + ' - <span class="font-normal text-slate-300">' + escaparTexto(h.descripcion) + '</span></div>' +
            '<div class="text-xs text-slate-500">Registrado por: ' + escaparTexto((h.nombre_usuario || 'Sistema')) + '</div>' +
          '</div>';
        }).join('');
      } catch (err) {
        mensaje.textContent = 'No se pudo consultar el rastreo.';
      }
    }

    document.getElementById('filtro-vuelo').addEventListener('submit', (event) => {
      event.preventDefault();
      cargarReportes();
    });

    async function cargarReportes() {
      const mensaje = document.getElementById('mensaje-vuelos');
      const tbody = document.getElementById('tabla-reportes-body');
      tbody.replaceChildren();
      mensaje.textContent = 'Consultando…';
      try {
        const vuelo = document.getElementById('numero-vuelo').value.trim();
        const res = await fetch(API_URL + '/reportes/operaciones?' + new URLSearchParams({ vuelo }));
        if (!res.ok) throw new Error('Error consultando vuelos');
        const operaciones = await res.json();
        mensaje.textContent = operaciones.length ? '' : 'No hay operaciones para ese vuelo.';

        tbody.innerHTML = operaciones.map(function(op) {
          return '<tr class="hover:bg-slate-800/50">' +
            '<td class="p-3.5 font-mono text-sky-400 font-semibold">#' + op.id_operacion + '</td>' +
            '<td class="p-3.5 font-medium">' + op.numero_vuelo + '</td>' +
            '<td class="p-3.5 text-slate-400">' + op.aerolinea + '</td>' +
            '<td class="p-3.5">' + op.origen + ' → ' + op.destino + '</td>' +
            '<td class="p-3.5"><span class="bg-slate-700 px-2 py-0.5 rounded text-xs">' + escaparTexto(op.etapa_flujo) + '</span></td>' +
            '<td class="p-3.5"><span class="text-xs font-semibold px-2 py-0.5 rounded bg-sky-950 text-sky-400 border border-sky-800">' + escaparTexto(op.estado_general) + '</span></td>' +
            '<td class="p-3.5 font-semibold text-slate-300">' + op.total_documentos + '</td>' +
            '<td class="p-3.5 font-semibold ' + (op.total_novedades > 0 ? 'text-amber-400' : 'text-slate-500') + '">' + op.total_novedades + '</td>' +
            '<td class="p-3.5"><button onclick="descargarManifiestoPDF(' + op.id_operacion + ')" class="text-xs bg-cyan-700 hover:bg-cyan-600 px-2.5 py-1 rounded text-white font-medium mr-1">PDF</button><button onclick="irARastrear(' + op.id_operacion + ')" class="text-xs bg-sky-600 hover:bg-sky-500 px-2.5 py-1 rounded text-white font-medium">Rastrear</button></td>' +
          '</tr>';
        }).join('');
      } catch (err) {
        mensaje.textContent = 'No se pudieron consultar los vuelos.';
      }
    }

    async function descargarPDF(url, nombre) {
      try {
        const respuesta = await fetch(url);

        if (!respuesta.ok) {
          let mensaje = 'Error al generar el PDF (HTTP ' + respuesta.status + ').';

          try {
            const error = await respuesta.json();
            mensaje = error.mensaje || mensaje;
          } catch (_) {}

          throw new Error(mensaje);
        }

        const blob = await respuesta.blob();
        const enlace = document.createElement('a');
        const objetoURL = URL.createObjectURL(blob);

        enlace.href = objetoURL;
        enlace.download = nombre;
        document.body.appendChild(enlace);
        enlace.click();
        enlace.remove();

        setTimeout(() => URL.revokeObjectURL(objetoURL), 1000);
      } catch (error) {
        alert(error.message || 'No fue posible descargar el PDF.');
      }
    }

    function descargarPDFGeneral() {
      const vuelo = document.getElementById('numero-vuelo').value.trim();

      descargarPDF(
        API_URL + '/reportes/pdf/general?' + new URLSearchParams({ vuelo }),
        'GeoCarga_Reporte_Operaciones.pdf'
      );
    }

    function descargarManifiestoPDF(id) {
      descargarPDF(
        API_URL + '/reportes/pdf/manifiesto/' + encodeURIComponent(id),
        'GeoCarga_Manifiesto_' + id + '.pdf'
      );
    }
    function irARastrear(id) {
      cambiarSeccion('tracer');
      buscarRastreo(id);
    }

    fetch(API_URL + '/auth/sesion').then(async respuesta => {
      if (!respuesta.ok) {
        localStorage.removeItem('geocarga_user');
        return;
      }
      const usuario = await respuesta.json();
      localStorage.setItem('geocarga_user', JSON.stringify(usuario));
      mostrarAplicacion(usuario);
    }).catch(() => {});
  </script>
<script id="geocarga-metal-v3-script">
(function () {
  function sincronizar() {
    const pares = [
      ['kpi-transito','gc-transito'],
      ['kpi-aduana','gc-aduana'],
      ['kpi-entregados','gc-entregados']
    ];

    pares.forEach(function (par) {
      const origen = document.getElementById(par[0]);
      const destino = document.getElementById(par[1]);
      if (origen && destino) destino.textContent = origen.textContent;
    });
  }

  const observer = new MutationObserver(sincronizar);

  window.addEventListener('DOMContentLoaded', function () {
    sincronizar();

    ['kpi-transito','kpi-aduana','kpi-entregados'].forEach(function (id) {
      const elemento = document.getElementById(id);
      if (elemento) observer.observe(elemento, {
        childList: true,
        characterData: true,
        subtree: true
      });
    });
  });
})();
</script>
<style id="gc-traccar-integrado">
#gc-traccar-contenedor {
  width: 100%;
  height: calc(100vh - 150px);
  min-height: 650px;
  background: #080d14;
  border: 1px solid #168bff;
  border-radius: 12px;
  overflow: hidden;
}
.gc-traccar-iframe {
  display: block;
  width: 100%;
  height: 100%;
  border: none;
}
#gc-radar-preview {
  padding: 0 !important;
  display: block !important;
}
#gc-radar-preview .gc-traccar-iframe {
  min-height: 450px;
}
</style>

<script id="gc-traccar-integracion">
document.addEventListener('DOMContentLoaded', function () {
  var radarUrl = 'http://127.0.0.1:8000/';

  function crearRadar() {
    var iframe = document.createElement('iframe');
    iframe.className = 'gc-traccar-iframe';
    iframe.src = radarUrl;
    iframe.title = 'GeoCarga - Radar Traccar';
    iframe.setAttribute('allowfullscreen', '');
    return iframe;
  }

  var tracer = document.getElementById('sec-tracer');

  if (tracer && !document.getElementById('gc-traccar-contenedor')) {
    var elementos = Array.from(tracer.children);

    elementos.forEach(function (elemento) {
      elemento.style.display = '';
    });

    var contenedor = document.createElement('div');
    contenedor.id = 'gc-traccar-contenedor';
    contenedor.appendChild(crearRadar());
    tracer.prepend(contenedor);
  }

  var preview = document.getElementById('gc-radar-preview');

  if (preview) {
    preview.replaceChildren(crearRadar());
  }
});
</script>
</body>
</html>
`;

// RUTA PRINCIPAL
app.get('/', (req, res) => {
  res.send(htmlPrincipal);
});

// AUTH LOGIN
app.post('/api/auth/login', async (req, res) => {
  const { correo, contrasena } = req.body || {};
  if (typeof correo !== 'string' || typeof contrasena !== 'string') {
    return res.status(400).json({ mensaje: 'Escribe tu correo y contraseña.' });
  }
  try {
    const userQuery = await pool.query(
      'SELECT u.id_usuario, u.nombre_usuario, u.correo, u.contrasena, u.id_rol, r.nombre_rol, r.matriz_permisos FROM usuarios u JOIN roles r ON u.id_rol = r.id_rol WHERE lower(u.correo) = $1',
      [correo.trim().toLowerCase()]
    );

    if (userQuery.rows.length === 0) return res.status(401).json({ mensaje: 'Credenciales inválidas' });
    const usuario = userQuery.rows[0];
    const passwordMatch = await bcrypt.compare(contrasena, usuario.contrasena);
    if (!passwordMatch) return res.status(401).json({ mensaje: 'Credenciales inválidas' });

    await pool.query('INSERT INTO trazabilidad (id_usuario, accion, descripcion) VALUES ($1, $2, $3)', [usuario.id_usuario, 'LOGIN', 'Inicio de sesión exitoso']);

    const token = jwt.sign(
      { id_usuario: usuario.id_usuario, nombre: usuario.nombre_usuario, rol: usuario.nombre_rol },
      secretoSesion,
      { expiresIn: '8h' }
    );
    res.cookie('geocarga_sesion', token, { ...cookieSesion, maxAge: 8 * 60 * 60 * 1000 });
    res.json({ usuario: { id: usuario.id_usuario, nombre: usuario.nombre_usuario, correo: usuario.correo, rol: usuario.nombre_rol } });
  } catch (error) {
    res.status(500).json({ mensaje: 'Error interno en el servidor' });
  }
});

app.get('/api/auth/sesion', (req, res) => {
  const usuario = leerSesion(req);
  if (!usuario) return res.sendStatus(401);
  res.json({ id: usuario.id_usuario, nombre: usuario.nombre, rol: usuario.rol });
});

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('geocarga_sesion', cookieSesion).sendStatus(204);
});

app.get('/api/usuarios', exigirAdmin, async (req, res) => {
  const { rows } = await pool.query(
    'SELECT u.id_usuario AS id, u.nombre_usuario AS nombre, u.correo, r.nombre_rol AS rol FROM usuarios u JOIN roles r ON u.id_rol = r.id_rol ORDER BY u.nombre_usuario'
  );
  res.json({ roles, usuarios: rows });
});

app.post('/api/usuarios', exigirAdmin, async (req, res) => {
  const { nombre, correo, contrasena, rol } = req.body || {};
  const email = typeof correo === 'string' ? correo.trim().toLowerCase() : '';
  if (typeof nombre !== 'string' || !nombre.trim() || nombre.trim().length > 120
      || email.length > 254 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)
      || typeof contrasena !== 'string' || contrasena.length < 12 || Buffer.byteLength(contrasena) > 72
      || !roles.includes(rol)) {
    return res.status(400).json({ mensaje: 'Revisa el nombre, correo, rol y contraseña de 12 a 72 bytes.' });
  }
  const hash = await bcrypt.hash(contrasena, 12);
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    await db.query('INSERT INTO roles (nombre_rol) VALUES ($1) ON CONFLICT (nombre_rol) DO NOTHING', [rol]);
    await db.query(
      'INSERT INTO usuarios (id_rol, nombre_usuario, correo, contrasena) SELECT id_rol, $2, $3, $4 FROM roles WHERE nombre_rol = $1',
      [rol, nombre.trim(), email, hash]
    );
    await db.query(
      "INSERT INTO trazabilidad (id_usuario, accion, descripcion) VALUES ($1, 'CREACION_USUARIO', $2)",
      [req.usuario.id_usuario, email + ' · ' + rol]
    );
    await db.query('COMMIT');
    res.status(201).json({ mensaje: 'Usuario creado.' });
  } catch (error) {
    await db.query('ROLLBACK');
    if (error.code === '23505') return res.status(409).json({ mensaje: 'Ya existe un usuario con ese correo.' });
    throw error;
  } finally {
    db.release();
  }
});

app.post('/api/asignaciones', exigirAdmin, async (req, res) => {
  const { operacion, usuario } = req.body || {};
  if (!/^[1-9][0-9]{0,8}$/.test(operacion) || !/^[1-9][0-9]{0,8}$/.test(usuario)) {
    return res.status(400).json({ mensaje: 'Selecciona una operación y una cuenta.' });
  }
  const resultado = await pool.query(
    'INSERT INTO operacion_usuarios (id_operacion, id_usuario) SELECT o.id_operacion, u.id_usuario FROM operaciones o CROSS JOIN usuarios u JOIN roles r ON r.id_rol = u.id_rol WHERE o.id_operacion = $1 AND u.id_usuario = $2 AND r.nombre_rol = ANY($3) ON CONFLICT DO NOTHING',
    [operacion, usuario, rolesAsignados]
  );
  if (!resultado.rowCount) {
    const existente = await pool.query('SELECT 1 FROM operacion_usuarios WHERE id_operacion = $1 AND id_usuario = $2', [operacion, usuario]);
    if (!existente.rowCount) return res.status(404).json({ mensaje: 'La operación o la cuenta no se puede asignar.' });
  }
  res.json({ mensaje: 'Envío asignado.' });
});

app.get('/api/mis-envios', exigirRoles(rolesAsignados), async (req, res) => {
  const { rows } = await pool.query(
    'SELECT o.id_operacion, v.numero_vuelo, o.estado_general FROM operacion_usuarios a JOIN operaciones o USING (id_operacion) JOIN vuelos v USING (id_vuelo) WHERE a.id_usuario = $1 ORDER BY o.id_operacion DESC',
    [req.usuario.id_usuario]
  );
  res.json(rows);
});

// DASHBOARD
app.get('/api/dashboard', exigirLectura, async (req, res) => {
  try {
    const kpis = await pool.query(`
      SELECT 
        COUNT(*) FILTER (WHERE estado_general = 'EN_TRANSITO') AS en_transito,
        COUNT(*) FILTER (WHERE estado_general = 'ENTREGADO') AS entregados,
        COUNT(*) FILTER (WHERE etapa_flujo LIKE '%ADUANA%') AS en_aduana
      FROM operaciones;
    `);

    const novedades = await pool.query(`
      SELECT n.id_novedad, n.tipo, n.descripcion, n.fecha, n.validada_en, o.id_operacion, v.numero_vuelo
      FROM novedades n
      JOIN operaciones o ON n.id_operacion = o.id_operacion
      JOIN vuelos v ON o.id_vuelo = v.id_vuelo
      ORDER BY (n.validada_en IS NOT NULL), n.fecha DESC LIMIT 5;
    `);
    res.json({ resumen: kpis.rows[0], novedadesRecientes: novedades.rows });
  } catch (error) {
    res.status(500).json({ mensaje: 'Error al consultar el dashboard' });
  }
});

// VUELOS
app.get('/api/vuelos', exigirLectura, async (req, res) => {
  try {
    const vuelos = await pool.query('SELECT id_vuelo, numero_vuelo, aerolinea, origen, destino FROM vuelos ORDER BY id_vuelo ASC');
    res.json(vuelos.rows);
  } catch (error) {
    res.status(500).json({ mensaje: 'Error al obtener vuelos' });
  }
});

// CREAR OPERACIÓN
app.post('/api/operaciones', exigirEscritura, async (req, res) => {
  const { id_vuelo, etapa_flujo, estado_general, detalle } = req.body;
  try {
    const nuevaOp = await pool.query(
      'INSERT INTO operaciones (id_vuelo, etapa_flujo, estado_general, fecha_embarque) VALUES ($1, $2, $3, NOW()) RETURNING *',
      [id_vuelo, etapa_flujo, estado_general]
    );

    const opCreada = nuevaOp.rows[0];

    await pool.query(
      'INSERT INTO trazabilidad (id_usuario, id_operacion, accion, descripcion) VALUES ($1, $2, $3, $4)',
      [req.usuario.id_usuario, opCreada.id_operacion, 'CREACION_PEDIDO', detalle || `Pedido creado en etapa: ${etapa_flujo}`]
    );

    res.status(201).json({ mensaje: 'Operación creada', operacion: opCreada });
  } catch (error) {
    res.status(500).json({ mensaje: 'Error al registrar pedido' });
  }
});

// SUBIR DOCUMENTO (LOCAL CON MULTER -> REGISTRO EN PostgreSQL)
app.post('/api/documentos', exigirEscritura, upload.single('archivo'), async (req, res) => {
  const { id_operacion, tipo_documento } = req.body;
  const archivo = req.file;

  if (!archivo) {
    return res.status(400).json({ mensaje: 'Selecciona un archivo PDF, PNG o JPG.' });
  }

  try {
    const urlAlmacenamiento = `/uploads/${archivo.filename}`;

    const docResult = await pool.query(`
      INSERT INTO documentacion (id_operacion, tipo_documento, url_almacenamiento, fecha_carga, contenido)
      VALUES ($1, $2, $3, NOW(), $4)
      RETURNING id_documento, id_operacion, tipo_documento, url_almacenamiento, fecha_carga;
    `, [id_operacion, tipo_documento, urlAlmacenamiento, await fs.promises.readFile(archivo.path)]);

    // Registrar en trazabilidad la subida del documento
    await pool.query(`
      INSERT INTO trazabilidad (id_usuario, id_operacion, accion, descripcion)
      VALUES ($1, $2, 'SUBIDA_DOCUMENTO', $3);
    `, [req.usuario.id_usuario, id_operacion, `Se adjuntó ${tipo_documento}: ${archivo.originalname}`]);

    res.status(201).json({ mensaje: 'Documento registrado con éxito', documento: docResult.rows[0] });
  } catch (error) {
    console.error(error);
    res.status(500).json({ mensaje: 'Error al registrar el documento' });
  }
});

// LISTAR TODOS LOS DOCUMENTOS
app.get('/api/documentos', exigirSesion, async (req, res) => {
  try {
    const docs = await pool.query(`
      SELECT d.id_documento, d.id_operacion, d.tipo_documento, d.url_almacenamiento, d.fecha_carga
      FROM documentacion d
      WHERE $1::int IS NULL OR EXISTS (SELECT 1 FROM operacion_usuarios a WHERE a.id_operacion = d.id_operacion AND a.id_usuario = $1)
      ORDER BY d.fecha_carga DESC;
    `, [usuarioRestringido(req.usuario)]);
    res.json(docs.rows);
  } catch (error) {
    res.status(500).json({ mensaje: 'Error al consultar documentos' });
  }
});

async function obtenerAvionesRadar() {
  const url = new URL('/api/aviones', process.env.RADAR_URL || 'http://127.0.0.1:8001');
  const respuesta = await fetch(url, { signal: AbortSignal.timeout(3500) });
  if (!respuesta.ok) throw new Error('Radar no disponible');
  const aviones = await respuesta.json();
  if (!Array.isArray(aviones)) throw new Error('Respuesta de radar inválida');
  return aviones;
}

app.get('/api/radar/aviones', async (req, res) => {
  const usuario = leerSesion(req);
  if (!usuario) return res.json([]);
  try {
    const aviones = await obtenerAvionesRadar();
    if (!rolesAsignados.includes(usuario.rol)) return res.json(aviones);
    const { rows } = await pool.query(
      'SELECT DISTINCT v.radar_id FROM operacion_usuarios a JOIN operaciones o USING (id_operacion) JOIN vuelos v USING (id_vuelo) WHERE a.id_usuario = $1',
      [usuario.id_usuario]
    );
    const ids = new Set(rows.map(fila => fila.radar_id));
    res.json(aviones.filter(avion => ids.has(String(avion.id))));
  } catch {
    res.status(503).json({ mensaje: 'Radar no disponible.' });
  }
});

async function consultarRadar(id) {
  if (!id) return { mensaje: 'Vuelo sin aeronave vinculada.' };
  try {
    const aviones = await obtenerAvionesRadar();
    const avion = aviones.find((registro) => String(registro.id) === id);
    if (!avion) return { mensaje: 'Aeronave no encontrada en el radar.' };
    const estados = { online: 'Conectado', offline: 'Desconectado', unknown: 'Conexión desconocida' };
    const estado = estados[avion.estado] || avion.estado;
    return { avion, mensaje: avion.lat == null ? estado + ' · Sin posición GPS' : estado };
  } catch {
    return { mensaje: 'Radar no disponible. El estado logístico sigue visible.' };
  }
}

// TRACER
app.post('/api/operaciones/:id/incidencias', exigirRoles(rolesReportarNovedad), async (req, res) => {
  const { tipo, descripcion } = req.body || {};
  if (!/^[1-9][0-9]{0,8}$/.test(req.params.id) || !tiposNovedad.includes(tipo)
      || typeof descripcion !== 'string' || !descripcion.trim() || descripcion.trim().length > 500) {
    return res.status(400).json({ mensaje: 'Selecciona un tipo y escribe una descripción de hasta 500 caracteres.' });
  }
  const { rowCount } = await pool.query(
    `WITH registrada AS (
      INSERT INTO novedades (id_operacion, tipo, descripcion)
      SELECT o.id_operacion, $3, $4 FROM operaciones o
      WHERE o.id_operacion = $1 AND ($5::int IS NULL OR EXISTS (
        SELECT 1 FROM operacion_usuarios a WHERE a.id_operacion = o.id_operacion AND a.id_usuario = $5
      ))
      RETURNING id_operacion, id_novedad
    )
    INSERT INTO trazabilidad (id_usuario, id_operacion, accion, descripcion)
    SELECT $2, id_operacion, 'REPORTE_INCIDENCIA', 'Incidencia #' || id_novedad FROM registrada`,
    [req.params.id, req.usuario.id_usuario, tipo, descripcion.trim(), usuarioRestringido(req.usuario)]
  );
  if (!rowCount) return res.status(404).json({ mensaje: 'No se encontró un envío asignado a tu cuenta.' });
  res.status(201).json({ mensaje: 'Novedad registrada y pendiente de validación.' });
});

app.post('/api/incidencias/:id/validar', exigirRoles(rolesValidarNovedad), async (req, res) => {
  if (!/^[1-9][0-9]{0,8}$/.test(req.params.id)) return res.status(400).json({ mensaje: 'Incidencia inválida.' });
  const { rowCount } = await pool.query(
    `WITH validada AS (
      UPDATE novedades SET validada_en = now(), validada_por = $2
      WHERE id_novedad = $1 AND validada_en IS NULL
      RETURNING id_operacion, id_novedad
    )
    INSERT INTO trazabilidad (id_usuario, id_operacion, accion, descripcion)
    SELECT $2, id_operacion, 'VALIDACION_INCIDENCIA', 'Incidencia #' || id_novedad FROM validada`,
    [req.params.id, req.usuario.id_usuario]
  );
  if (!rowCount) return res.status(409).json({ mensaje: 'La incidencia ya fue validada o no existe.' });
  res.json({ mensaje: 'Incidencia validada.' });
});

app.get('/api/operaciones/:id/tracer', exigirSesion, async (req, res) => {
  const { id } = req.params;
  try {
    const opQuery = await pool.query(`
      SELECT o.id_operacion, o.etapa_flujo, o.estado_general, o.fecha_embarque, v.radar_id, v.numero_vuelo, v.aerolinea, v.origen, v.destino
      FROM operaciones o
      JOIN vuelos v ON o.id_vuelo = v.id_vuelo
      WHERE o.id_operacion = $1 AND ($2::int IS NULL OR EXISTS (SELECT 1 FROM operacion_usuarios a WHERE a.id_operacion = o.id_operacion AND a.id_usuario = $2));
    `, [id, usuarioRestringido(req.usuario)]);

    if (opQuery.rows.length === 0) return res.status(404).json({ mensaje: 'Operación no encontrada' });

    const puedeAuditar = ['Administrador', 'Supervisor', 'Auditor'].includes(req.usuario.rol);
    const trazabilidadQuery = puedeAuditar ? await pool.query(`
      SELECT t.id_trazabilidad, t.accion, t.descripcion, t.fecha, u.nombre_usuario
      FROM trazabilidad t
      LEFT JOIN usuarios u ON t.id_usuario = u.id_usuario
      WHERE t.id_operacion = $1
      ORDER BY t.fecha DESC;
    `, [id]) : { rows: [] };

    const incidencias = req.usuario.rol === 'Cliente' ? null : (await pool.query(
      'SELECT id_novedad, tipo, descripcion, validada_en FROM novedades WHERE id_operacion = $1 ORDER BY fecha DESC, id_novedad DESC',
      [id]
    )).rows;

    res.json({
      operacion: opQuery.rows[0],
      incidencias,
      puedeReportar: rolesReportarNovedad.includes(req.usuario.rol),
      puedeValidar: rolesValidarNovedad.includes(req.usuario.rol),
      radar: await consultarRadar(opQuery.rows[0].radar_id),
      historial: trazabilidadQuery.rows
    });
  } catch (error) {
    res.status(500).json({ mensaje: 'Error al consultar tracer' });
  }
});


// GEOCARGA_PDF_INTEGRACION_V1
const { jsPDF } = require('jspdf');
const { autoTable } = require('jspdf-autotable');

function generarPDFGeoCarga(operaciones, manifiesto = false) {
  const doc = new jsPDF({
    orientation: manifiesto ? 'portrait' : 'landscape',
    unit: 'mm',
    format: 'a4'
  });

  const ancho = doc.internal.pageSize.getWidth();

  doc.setFillColor(9, 25, 48);
  doc.rect(0, 0, ancho, 48, 'F');
  doc.setFillColor(0, 174, 239);
  doc.rect(0, 48, ancho, 2, 'F');

  doc.setTextColor(100, 220, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('GEOCARGA  |  AIR OPERATIONS', 14, 15);

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(19);
  doc.text(
    manifiesto ? 'AIR CARGO MANIFEST' : 'REPORTE DE OPERACIONES',
    14,
    29
  );

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(185, 205, 225);
  doc.text(
    manifiesto ? 'Manifiesto de operacion aerea' : 'Control logistico de carga aerea',
    14,
    39
  );

  doc.setTextColor(25, 48, 75);
  doc.setFontSize(10);
  doc.text('Fecha de emision: ' + new Date().toLocaleString('es-CO'), 14, 61);

  if (manifiesto) {
    const op = operaciones[0];

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.text('OPERACION GC-' + String(op.id_operacion).padStart(6, '0'), 14, 72);

    autoTable(doc, {
      startY: 82,
      head: [['CAMPO', 'INFORMACION']],
      body: [
        ['Numero de vuelo', String(op.numero_vuelo ?? '')],
        ['Aerolinea', String(op.aerolinea ?? '')],
        ['Origen', String(op.origen ?? '')],
        ['Destino', String(op.destino ?? '')],
        ['Etapa', String(op.etapa_flujo ?? '')],
        ['Estado', String(op.estado_general ?? '')],
        ['Documentos', String(op.total_documentos ?? 0)],
        ['Novedades', String(op.total_novedades ?? 0)]
      ],
      theme: 'striped',
      headStyles: { fillColor: [13, 43, 75] }
    });
  } else {
    doc.text('Total de operaciones: ' + operaciones.length, 14, 70);

    autoTable(doc, {
      startY: 80,
      head: [['ID', 'Vuelo', 'Aerolinea', 'Ruta', 'Etapa', 'Estado', 'Docs', 'Novedades']],
      body: operaciones.map(op => [
        String(op.id_operacion ?? ''),
        String(op.numero_vuelo ?? ''),
        String(op.aerolinea ?? ''),
        String(op.origen ?? '') + ' - ' + String(op.destino ?? ''),
        String(op.etapa_flujo ?? ''),
        String(op.estado_general ?? ''),
        String(op.total_documentos ?? 0),
        String(op.total_novedades ?? 0)
      ]),
      theme: 'striped',
      headStyles: { fillColor: [13, 43, 75] },
      styles: { fontSize: 8 }
    });
  }

  const paginas = doc.internal.getNumberOfPages();

  for (let i = 1; i <= paginas; i++) {
    doc.setPage(i);

    const alto = doc.internal.pageSize.getHeight();

    doc.setDrawColor(200, 215, 230);
    doc.line(14, alto - 18, ancho - 14, alto - 18);

    doc.setTextColor(85, 105, 125);
    doc.setFontSize(8);
    doc.text('GEOCARGA | Sistema de operaciones aereas', 14, alto - 12);
    doc.text('Pagina ' + i + ' de ' + paginas, ancho - 14, alto - 12, {
      align: 'right'
    });
  }

  return Buffer.from(doc.output('arraybuffer'));
}

app.get('/api/reportes/pdf/general', exigirLectura, async (req, res) => {
  try {
    const vuelo = typeof req.query.vuelo === 'string' ? req.query.vuelo.trim() : '';

    const resultado = await pool.query(`
      SELECT
        o.id_operacion,
        v.numero_vuelo,
        v.aerolinea,
        v.origen,
        v.destino,
        o.etapa_flujo,
        o.estado_general,
        COUNT(DISTINCT n.id_novedad) AS total_novedades,
        COUNT(DISTINCT d.id_documento) AS total_documentos
      FROM operaciones o
      JOIN vuelos v ON o.id_vuelo = v.id_vuelo
      LEFT JOIN novedades n ON o.id_operacion = n.id_operacion
      LEFT JOIN documentacion d ON o.id_operacion = d.id_operacion
      WHERE strpos(lower(v.numero_vuelo), lower($1)) > 0 OR $1 = ''
      GROUP BY o.id_operacion, v.numero_vuelo, v.aerolinea,
               v.origen, v.destino, o.etapa_flujo, o.estado_general
      ORDER BY o.id_operacion DESC
    `, [vuelo]);

    if (!resultado.rows.length) {
      return res.status(404).json({ mensaje: 'No hay operaciones para exportar.' });
    }

    const pdf = generarPDFGeoCarga(resultado.rows);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="GeoCarga_Reporte_Operaciones.pdf"');
    res.send(pdf);
  } catch (error) {
    console.error('Error PDF general:', error);
    res.status(500).json({ mensaje: 'No fue posible generar el PDF.' });
  }
});

app.get('/api/reportes/pdf/manifiesto/:id', exigirLectura, async (req, res) => {
  try {
    const id = Number(req.params.id);

    if (!Number.isSafeInteger(id) || id <= 0) {
      return res.status(400).json({ mensaje: 'ID de operacion invalido.' });
    }

    const resultado = await pool.query(`
      SELECT
        o.id_operacion,
        v.numero_vuelo,
        v.aerolinea,
        v.origen,
        v.destino,
        o.etapa_flujo,
        o.estado_general,
        COUNT(DISTINCT n.id_novedad) AS total_novedades,
        COUNT(DISTINCT d.id_documento) AS total_documentos
      FROM operaciones o
      JOIN vuelos v ON o.id_vuelo = v.id_vuelo
      LEFT JOIN novedades n ON o.id_operacion = n.id_operacion
      LEFT JOIN documentacion d ON o.id_operacion = d.id_operacion
      WHERE o.id_operacion = $1
      GROUP BY o.id_operacion, v.numero_vuelo, v.aerolinea,
               v.origen, v.destino, o.etapa_flujo, o.estado_general
    `, [id]);

    if (!resultado.rows.length) {
      return res.status(404).json({ mensaje: 'Operacion no encontrada.' });
    }

    const pdf = generarPDFGeoCarga(resultado.rows, true);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="GeoCarga_Manifiesto_' + id + '.pdf"'
    );
    res.send(pdf);
  } catch (error) {
    console.error('Error manifiesto:', error);
    res.status(500).json({ mensaje: 'No fue posible generar el manifiesto.' });
  }
});
// REPORTES COMPLETOS (CON NOVEDADES Y DOCUMENTOS)
app.get('/api/reportes/operaciones', exigirLectura, async (req, res) => {
  const vuelo = typeof req.query.vuelo === 'string' ? req.query.vuelo.trim() : '';
  try {
    const resultado = await pool.query(`
      SELECT 
        o.id_operacion, 
        v.numero_vuelo, 
        v.aerolinea, 
        v.origen, 
        v.destino, 
        o.etapa_flujo, 
        o.estado_general, 
        COUNT(DISTINCT n.id_novedad) AS total_novedades,
        COUNT(DISTINCT d.id_documento) AS total_documentos
      FROM operaciones o
      JOIN vuelos v ON o.id_vuelo = v.id_vuelo
      LEFT JOIN novedades n ON o.id_operacion = n.id_operacion
      LEFT JOIN documentacion d ON o.id_operacion = d.id_operacion
      WHERE strpos(lower(v.numero_vuelo), lower($1)) > 0 OR $1 = ''
      GROUP BY o.id_operacion, v.numero_vuelo, v.aerolinea, v.origen, v.destino, o.etapa_flujo, o.estado_general
      ORDER BY o.id_operacion DESC;
    `, [vuelo]);
    res.json(resultado.rows);
  } catch (error) {
    res.status(500).json({ mensaje: 'Error al generar el reporte' });
  }
});

app.use((error, req, res, next) => {
  if (!(error instanceof multer.MulterError)) return next(error);
  const demasiadoGrande = error.code === 'LIMIT_FILE_SIZE';
  res.status(demasiadoGrande ? 413 : 400).json({
    mensaje: demasiadoGrande ? 'El archivo supera el límite de 10 MB.' : 'No se pudo recibir el archivo.'
  });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, process.env.HOST || '127.0.0.1', () => {
  console.log(`Servidor GeoCarga corriendo localmente en el puerto ${PORT}`);
});