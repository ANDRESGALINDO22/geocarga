// =====================================================
// GEOCARGA RADAR - 30 AERONAVES
// =====================================================

const mapa = new maplibregl.Map({
    container: "map",
    style: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
    center: [-63, -19],
    zoom: 3,
    maxBounds: [[-84, -57], [-32, 14]]
});

mapa.addControl(new maplibregl.NavigationControl());

const marcadores = {};
const tarjetas = {};
const animaciones = {};
const recorridos = {};
const ultimasPosiciones = {};

const INTERVALO = 1000;

let avionSeleccionado = null;
let actualizando = false;


// =====================================================
// FUNCIONES GENERALES
// =====================================================

function numero(valor, defecto = 0) {
    if (valor === null || valor === undefined || valor === "") {
        return defecto;
    }

    const n = Number(valor);
    return Number.isFinite(n) ? n : defecto;
}

function coordenadasValidas(avion) {
    return avion.lat !== null &&
        avion.lon !== null &&
        avion.lat !== undefined &&
        avion.lon !== undefined &&
        Number.isFinite(Number(avion.lat)) &&
        Number.isFinite(Number(avion.lon)) &&
        Number(avion.lat) >= -57 &&
        Number(avion.lat) <= 14 &&
        Number(avion.lon) >= -84 &&
        Number(avion.lon) <= -32;
}

function distanciaKm(a, b) {
    const rad = n => n * Math.PI / 180;

    const dLat = rad(b[1] - a[1]);
    const dLon = rad(b[0] - a[0]);

    const h =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(rad(a[1])) *
        Math.cos(rad(b[1])) *
        Math.sin(dLon / 2) ** 2;

    return 6371 * 2 * Math.asin(
        Math.min(1, Math.sqrt(h))
    );
}

function origenDe(avion) {
    return avion.origen_coords;
}

function destinoDe(avion) {
    return avion.destino_coords;
}


// =====================================================
// PROGRESO DE LOS VUELOS
// =====================================================

function progresoVuelo(avion) {
    if (!coordenadasValidas(avion)) {
        return 0;
    }

    const origen = origenDe(avion);
    const destino = destinoDe(avion);

    if (!Array.isArray(origen) || !Array.isArray(destino)) {
        return 0;
    }

    const total = distanciaKm(origen, destino);

    if (total === 0) {
        return 0;
    }

    const actual = [
        Number(avion.lon),
        Number(avion.lat)
    ];

    const restante = distanciaKm(actual, destino);

    return Math.max(
        0,
        Math.min(
            100,
            Math.round((1 - restante / total) * 100)
        )
    );
}

function vueloFinalizado(avion) {
    if (!coordenadasValidas(avion)) {
        return false;
    }

    const destino = destinoDe(avion);

    if (!Array.isArray(destino)) {
        return false;
    }

    const actual = [
        Number(avion.lon),
        Number(avion.lat)
    ];

    return (
        distanciaKm(actual, destino) < 15 &&
        numero(avion.velocidad) < 50
    );
}


// =====================================================
// ESTADÍSTICAS
// =====================================================

function actualizarEstadisticas(aviones) {
    const finalizados = aviones.filter(vueloFinalizado).length;

    const activos = aviones.filter(avion =>
        coordenadasValidas(avion) &&
        !vueloFinalizado(avion) &&
        numero(avion.velocidad) > 0
    ).length;

    document.getElementById("total-aviones").textContent =
        aviones.length;

    document.getElementById("vuelos-activos").textContent =
        activos;

    document.getElementById("vuelos-finalizados").textContent =
        finalizados;
}


// =====================================================
// TARJETAS LATERALES
// =====================================================

function actualizarTarjeta(avion) {
    const elementos = tarjetas[avion.id];

    if (!elementos) {
        return;
    }

    const { detalle, barra, porcentaje } = elementos;

    const avance = progresoVuelo(avion);

    const estado = vueloFinalizado(avion)
        ? "FINALIZADO"
        : (avion.estado || "Desconocido");

    detalle.textContent =
        `📦 ${avion.carga}
📍 ${avion.origen} → ${avion.destino}
🚀 Velocidad: ${Math.round(numero(avion.velocidad))} km/h
📏 Altitud: ${Math.round(numero(avion.altitud))} m
🧭 Rumbo: ${Math.round(numero(avion.rumbo))}°
📡 Estado: ${estado}`;

    barra.style.width = `${avance}%`;
    porcentaje.textContent = `${avance}%`;
}


// =====================================================
// POPUP PROFESIONAL GEOCARGA
// =====================================================

function actualizarPopup(avion) {
    const marcador = marcadores[avion.id];

    if (!marcador) {
        return;
    }

    const finalizado = vueloFinalizado(avion);

    const estado = finalizado
        ? "VUELO FINALIZADO"
        : numero(avion.velocidad) > 0
            ? "EN VUELO"
            : "EN ESPERA";

    const avance = progresoVuelo(avion);

    const latitud = numero(avion.lat).toFixed(4);
    const longitud = numero(avion.lon).toFixed(4);

    const popup = document.createElement("div");
    popup.className = "popup-geocarga";

    popup.innerHTML = `
        <div class="popup-header">
            <div class="popup-marca">
                ✈ GEOCARGA RADAR
            </div>

            <div class="popup-nombre"></div>

            <div class="popup-estado ${finalizado ? "finalizado" : ""}">
                ● ${estado}
            </div>
        </div>

        <div class="popup-body">
            <div class="popup-carga"></div>

            <div class="popup-ruta">
                <div class="popup-dato">
                    <span>🛫 ORIGEN</span>
                    <strong class="dato-origen"></strong>
                </div>

                <div class="popup-dato">
                    <span>🛬 DESTINO</span>
                    <strong class="dato-destino"></strong>
                </div>

                <div class="popup-dato">
                    <span>🚀 VELOCIDAD</span>
                    <strong class="dato-velocidad"></strong>
                </div>

                <div class="popup-dato">
                    <span>📏 ALTITUD</span>
                    <strong class="dato-altitud"></strong>
                </div>

                <div class="popup-dato">
                    <span>🧭 RUMBO</span>
                    <strong class="dato-rumbo"></strong>
                </div>

                <div class="popup-dato">
                    <span>📡 ESTADO</span>
                    <strong class="dato-estado"></strong>
                </div>
            </div>

            <div class="popup-progreso-titulo">
                <span>PROGRESO DEL VUELO</span>
                <strong class="dato-progreso"></strong>
            </div>

            <div class="popup-progreso-fondo">
                <div class="popup-progreso-barra"></div>
            </div>

            <div class="popup-gps">
                📍 POSICIÓN GPS<br>
                <span class="dato-latitud"></span><br>
                <span class="dato-longitud"></span>
            </div>
        </div>
    `;

    popup.querySelector(".popup-nombre").textContent =
        avion.nombre;

    popup.querySelector(".popup-carga").textContent =
        `📦 ${avion.carga}`;

    popup.querySelector(".dato-origen").textContent =
        avion.origen;

    popup.querySelector(".dato-destino").textContent =
        avion.destino;

    popup.querySelector(".dato-velocidad").textContent =
        `${Math.round(numero(avion.velocidad))} km/h`;

    popup.querySelector(".dato-altitud").textContent =
        `${Math.round(numero(avion.altitud))} m`;

    popup.querySelector(".dato-rumbo").textContent =
        `${Math.round(numero(avion.rumbo))}°`;

    popup.querySelector(".dato-estado").textContent =
        estado;

    popup.querySelector(".dato-progreso").textContent =
        `${avance}%`;

    popup.querySelector(".dato-latitud").textContent =
        `Latitud: ${latitud}`;

    popup.querySelector(".dato-longitud").textContent =
        `Longitud: ${longitud}`;

    const barra = popup.querySelector(".popup-progreso-barra");

    barra.style.width = `${avance}%`;
    barra.style.background = avion.color;

    // Actualizar el popup sin cerrarlo.
    marcador.getPopup().setDOMContent(popup);
}


// =====================================================
// SELECCIONAR AERONAVE
// =====================================================

function seleccionarAvion(id) {
    avionSeleccionado = String(id);

    Object.keys(marcadores).forEach(avionId => {
        const visibilidad =
            avionId === avionSeleccionado
                ? "visible"
                : "none";

        const capaRecorrido = `recorrido-${avionId}`;
        const capaRuta = `ruta-${avionId}`;

        if (mapa.getLayer(capaRecorrido)) {
            mapa.setLayoutProperty(
                capaRecorrido,
                "visibility",
                visibilidad
            );
        }

        if (mapa.getLayer(capaRuta)) {
            mapa.setLayoutProperty(
                capaRuta,
                "visibility",
                visibilidad
            );
        }
    });

    Object.keys(tarjetas).forEach(avionId => {
        const tarjeta = tarjetas[avionId].elemento;

        if (tarjeta) {
            tarjeta.style.background =
                avionId === avionSeleccionado
                    ? "#243653"
                    : "#172338";
        }
    });
}


// =====================================================
// ANIMACIÓN SUAVE
// =====================================================

function animarAvion(id, destino, rumbo) {
    const marcador = marcadores[id];

    if (!marcador) {
        return;
    }

    if (animaciones[id]) {
        cancelAnimationFrame(animaciones[id]);
        delete animaciones[id];
    }

    const origen = marcador.getLngLat();

    if (
        distanciaKm(
            [origen.lng, origen.lat],
            destino
        ) > 250
    ) {
        marcador.setLngLat(destino);
        marcador.setRotation(numero(rumbo) - 90);
        return;
    }

    const inicio = performance.now();

    function animar(tiempo) {
        const p = Math.min(
            (tiempo - inicio) / INTERVALO,
            1
        );

        const suave = p * p * (3 - 2 * p);

        marcador.setLngLat([
            origen.lng +
                (destino[0] - origen.lng) * suave,

            origen.lat +
                (destino[1] - origen.lat) * suave
        ]);

        if (p < 1) {
            animaciones[id] = requestAnimationFrame(animar);
        } else {
            delete animaciones[id];
        }
    }

    marcador.setRotation(numero(rumbo) - 90);

    animaciones[id] = requestAnimationFrame(animar);
}


// =====================================================
// CREAR AERONAVES
// =====================================================

function crearAvion(avion) {
    if (
        !coordenadasValidas(avion) ||
        marcadores[avion.id]
    ) {
        return;
    }

    const tarjeta = document.createElement("div");

    tarjeta.className = "avion";
    tarjeta.style.borderColor = avion.color;

    const titulo = document.createElement("strong");
    titulo.textContent = avion.nombre;

    const detalle = document.createElement("small");

    detalle.className = "telemetria";
    detalle.style.whiteSpace = "pre-line";

    const cabecera = document.createElement("div");
    cabecera.className = "progreso-texto";

    const etiqueta = document.createElement("span");
    etiqueta.textContent = "Progreso estimado";

    const porcentaje = document.createElement("span");
    porcentaje.textContent = "0%";

    cabecera.append(etiqueta, porcentaje);

    const fondo = document.createElement("div");
    fondo.className = "barra-progreso";

    const barra = document.createElement("div");

    barra.className = "barra-progreso-relleno";
    barra.style.background = avion.color;

    fondo.append(barra);

    tarjeta.append(
        titulo,
        detalle,
        cabecera,
        fondo
    );

    document.getElementById("lista-aviones").appendChild(tarjeta);

    tarjetas[avion.id] = {
        elemento: tarjeta,
        detalle,
        barra,
        porcentaje
    };

    // MARCADOR DEL AVIÓN

    const icono = document.createElement("div");

    icono.className = "marcador-avion";
    icono.textContent = "✈";
    icono.style.color = avion.color;

    const actual = [
        Number(avion.lon),
        Number(avion.lat)
    ];

    const marcador = new maplibregl.Marker({
        element: icono,
        rotationAlignment: "map"
    })
        .setLngLat(actual)
        .setPopup(
            new maplibregl.Popup({
                offset: 25,
                maxWidth: "340px",
                closeOnClick: false
            })
        )
        .addTo(mapa);

    marcadores[avion.id] = marcador;

    // GEOCARGA_SELECCION_DESDE_REPORTE_V1
    const avionSolicitado = new URLSearchParams(window.location.search).get("avion");

    if (avionSolicitado && String(avion.id) === String(avionSolicitado)) {
        setTimeout(() => {
            seleccionarAvion(avion.id);
            actualizarPopup(avion);

            mapa.flyTo({
                center: marcador.getLngLat(),
                zoom: 6,
                essential: true
            });

            const popup = marcador.getPopup();

            if (popup && !popup.isOpen()) {
                marcador.togglePopup();
            }
        }, 800);
    }

    marcador.setRotation(
        numero(avion.rumbo) - 90
    );

    // SELECCIÓN DESDE TARJETA

    tarjeta.onclick = () => {
        seleccionarAvion(avion.id);

        mapa.flyTo({
            center: marcador.getLngLat(),
            zoom: 5,
            essential: true
        });

        if (!marcador.getPopup().isOpen()) {
            marcador.togglePopup();
        }
    };

    // SELECCIÓN DESDE EL AVIÓN

    icono.addEventListener("click", (evento) => {
        evento.stopPropagation();

        seleccionarAvion(avion.id);

        actualizarPopup(avion);

        const popup = marcador.getPopup();

        if (popup && !popup.isOpen()) {
            marcador.togglePopup();
        }
    });

    // RECORRIDO REALIZADO

    recorridos[avion.id] = [actual, actual];
    ultimasPosiciones[avion.id] = actual;

    mapa.addSource(`recorrido-${avion.id}`, {
        type: "geojson",
        data: {
            type: "Feature",
            geometry: {
                type: "LineString",
                coordinates: recorridos[avion.id]
            },
            properties: {}
        }
    });

    mapa.addLayer({
        id: `recorrido-${avion.id}`,
        type: "line",
        source: `recorrido-${avion.id}`,
        layout: {
            visibility: "none"
        },
        paint: {
            "line-color": avion.color,
            "line-width": 3,
            "line-opacity": 0.9
        }
    });

    // RUTA PENDIENTE

    mapa.addSource(`ruta-${avion.id}`, {
        type: "geojson",
        data: {
            type: "Feature",
            geometry: {
                type: "LineString",
                coordinates: [
                    actual,
                    destinoDe(avion)
                ]
            },
            properties: {}
        }
    });

    mapa.addLayer({
        id: `ruta-${avion.id}`,
        type: "line",
        source: `ruta-${avion.id}`,
        layout: {
            visibility: "none"
        },
        paint: {
            "line-color": avion.color,
            "line-width": 1.8,
            "line-opacity": 0.55,
            "line-dasharray": [3, 3]
        }
    });

    actualizarTarjeta(avion);
    actualizarPopup(avion);

    if (avionSeleccionado === String(avion.id)) {
        seleccionarAvion(avion.id);
    }
}


// =====================================================
// ACTUALIZAR RECORRIDO
// =====================================================

function actualizarRecorrido(avion) {
    const id = avion.id;

    const nueva = [
        Number(avion.lon),
        Number(avion.lat)
    ];

    const anterior = ultimasPosiciones[id];

    if (!anterior) {
        return;
    }

    const salto = distanciaKm(anterior, nueva);

    if (salto > 250) {
        recorridos[id] = [nueva, nueva];

    } else if (salto > 0.01) {
        recorridos[id].push(nueva);
    }

    ultimasPosiciones[id] = nueva;

    const fuente = mapa.getSource(`recorrido-${id}`);

    if (fuente) {
        fuente.setData({
            type: "Feature",
            geometry: {
                type: "LineString",
                coordinates: recorridos[id]
            },
            properties: {}
        });
    }

    const pendiente = mapa.getSource(`ruta-${id}`);

    if (pendiente) {
        pendiente.setData({
            type: "Feature",
            geometry: {
                type: "LineString",
                coordinates: [
                    nueva,
                    destinoDe(avion)
                ]
            },
            properties: {}
        });
    }
}


// =====================================================
// CONSULTAR FASTAPI
// =====================================================

async function consultarAviones() {
    const respuesta = await fetch(
        "/api/aviones",
        {
            cache: "no-store"
        }
    );

    if (!respuesta.ok) {
        throw new Error(
            `Error API: ${respuesta.status}`
        );
    }

    const datos = await respuesta.json();

    if (!Array.isArray(datos)) {
        throw new Error(
            "La API no devolvió una lista"
        );
    }

    return datos;
}


// =====================================================
// ACTUALIZACIÓN EN TIEMPO REAL
// =====================================================

async function actualizarAviones() {
    if (actualizando) {
        return;
    }

    actualizando = true;

    try {
        const aviones = await consultarAviones();

        aviones.forEach(avion => {
            if (!coordenadasValidas(avion)) {
                return;
            }

            if (!marcadores[avion.id]) {
                crearAvion(avion);
                return;
            }

            animarAvion(
                avion.id,
                [
                    Number(avion.lon),
                    Number(avion.lat)
                ],
                avion.rumbo
            );

            actualizarRecorrido(avion);
            actualizarTarjeta(avion);
            actualizarPopup(avion);
        });

        actualizarEstadisticas(aviones);

    } catch (error) {
        console.error(
            "Error GeoCarga:",
            error
        );

    } finally {
        actualizando = false;
    }
}


// =====================================================
// INICIAR GEOCARGA RADAR
// =====================================================

mapa.on("load", async () => {
    try {
        const aviones = await consultarAviones();

        document.getElementById(
            "lista-aviones"
        ).innerHTML = "";

        aviones.forEach(crearAvion);

        actualizarEstadisticas(aviones);

        setInterval(
            actualizarAviones,
            INTERVALO
        );

        console.log(
            "GeoCarga Radar | 30 aeronaves activadas"
        );

    } catch (error) {
        console.error(error);

        document.getElementById(
            "lista-aviones"
        ).textContent =
            "Error cargando aeronaves";
    }
});