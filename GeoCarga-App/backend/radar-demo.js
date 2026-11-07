const http = require('node:http');
const rutas = require('../radar/rutas.json');
const inicio = Date.now();
const colores = {
  Medicamentos: '#60a5fa',
  Perecederos: '#4ade80',
  'Electrónicos': '#fb923c',
  'Carga general': '#c084fc'
};

http.createServer((req, res) => {
  if (req.url !== '/api/aviones') {
    res.writeHead(404).end();
    return;
  }
  const ahora = Date.now();
  const minutos = (ahora - inicio) / 60000;
  const aviones = rutas.map((ruta, indice) => {
    const progreso = Math.min(1, (minutos + 1 + (indice % 6) / 2) / 8);
    const [lat, lon] = ruta.inicio.map((valor, eje) => valor + (ruta.fin[eje] - valor) * progreso);
    const rumbo = (Math.atan2(ruta.fin[1] - ruta.inicio[1], ruta.fin[0] - ruta.inicio[0]) * 180 / Math.PI + 360) % 360;
    return {
      id: ruta.id, carga: ruta.carga, color: colores[ruta.carga], origen: ruta.origen, destino: ruta.destino, destino_coords: [ruta.fin[1], ruta.fin[0]], rumbo, lat, lon, estado: 'online',
      fase: progreso === 1 ? 'Aterrizado en ' + ruta.destino : progreso > 0.85 ? 'En aproximacion a ' + ruta.destino : 'En vuelo hacia ' + ruta.destino,
      velocidad: progreso === 1 ? 0 : 780,
      altitud: Math.round(10500 * Math.sin(Math.PI * progreso)),
      actualizado: new Date(ahora).toISOString(), simulacion: true
    };
  });
  res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(aviones));
}).listen(Number(process.env.DEMO_RADAR_PORT || 8000), '127.0.0.1');
