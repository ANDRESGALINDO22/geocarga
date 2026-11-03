import json
import math
import random
import time
import urllib.parse
import urllib.request
from pathlib import Path

# =====================================================
# CONFIGURACIÓN GENERAL
# =====================================================

URL = "http://127.0.0.1:5055/"

RUTAS = Path(
    r"C:\GeoCarga\radar\radar\rutas.json"
)

INTERVALO = 3

# Duración acelerada de cada vuelo, en minutos.
DURACION_MIN = 6
DURACION_MAX = 12

# Número de intentos de envío GPS por ciclo.
REINTENTOS = 2

# =====================================================
# FUNCIONES GEOGRÁFICAS
# =====================================================

def rad(valor):
    return math.radians(valor)


def distancia(a, b):
    lat1, lon1 = a
    lat2, lon2 = b

    dlat = rad(lat2 - lat1)
    dlon = rad(lon2 - lon1)

    h = (
        math.sin(dlat / 2) ** 2
        + math.cos(rad(lat1))
        * math.cos(rad(lat2))
        * math.sin(dlon / 2) ** 2
    )

    return 6371 * 2 * math.asin(
        min(1, math.sqrt(h))
    )


def rumbo(a, b):
    lat1, lon1 = map(rad, a)
    lat2, lon2 = map(rad, b)

    dlon = lon2 - lon1

    y = math.sin(dlon) * math.cos(lat2)

    x = (
        math.cos(lat1) * math.sin(lat2)
        - math.sin(lat1)
        * math.cos(lat2)
        * math.cos(dlon)
    )

    return (
        math.degrees(math.atan2(y, x)) + 360
    ) % 360


def interpolar(a, b, progreso):
    """
    Interpolación sobre la superficie terrestre.
    """

    progreso = max(0, min(1, progreso))

    lat1, lon1 = map(rad, a)
    lat2, lon2 = map(rad, b)

    x1 = math.cos(lat1) * math.cos(lon1)
    y1 = math.cos(lat1) * math.sin(lon1)
    z1 = math.sin(lat1)

    x2 = math.cos(lat2) * math.cos(lon2)
    y2 = math.cos(lat2) * math.sin(lon2)
    z2 = math.sin(lat2)

    producto = max(
        -1,
        min(1, x1*x2 + y1*y2 + z1*z2)
    )

    angulo = math.acos(producto)

    if angulo < 0.000001:
        return a

    factor1 = (
        math.sin((1-progreso)*angulo)
        / math.sin(angulo)
    )

    factor2 = (
        math.sin(progreso*angulo)
        / math.sin(angulo)
    )

    x = factor1*x1 + factor2*x2
    y = factor1*y1 + factor2*y2
    z = factor1*z1 + factor2*z2

    lat = math.degrees(
        math.atan2(z, math.hypot(x, y))
    )

    lon = math.degrees(
        math.atan2(y, x)
    )

    return lat, lon


# =====================================================
# COMUNICACIÓN CON TRACCAR
# =====================================================

def enviar(avion, lat, lon, velocidad, altitud, curso):

    parametros = urllib.parse.urlencode({
        "id": avion["id"],
        "lat": f"{lat:.6f}",
        "lon": f"{lon:.6f}",
        "speed": f"{velocidad / 1.852:.2f}",
        "altitude": round(altitud),
        "bearing": round(curso),
        "valid": "true"
    })

    for intento in range(REINTENTOS):

        try:
            with urllib.request.urlopen(
                URL + "?" + parametros,
                timeout=5
            ) as respuesta:

                respuesta.read()

            return True

        except Exception as error:

            if intento == REINTENTOS - 1:
                print(
                    f"ERROR GPS {avion['id']}: {error}"
                )

            else:
                time.sleep(0.3)

    return False


# =====================================================
# DISTRIBUCIÓN DE LOS AVIONES
# =====================================================

def preparar_vuelos(aviones):

    rng = random.Random(2026)

    # Empezar en distintos momentos del recorrido.
    # Los vuelos no estarán todos en la misma fase.
    progresos = [
        0.03 + (0.77 * i / max(1, len(aviones) - 1))
        for i in range(len(aviones))
    ]

    rng.shuffle(progresos)

    for indice, avion in enumerate(aviones):

        avion["progreso"] = progresos[indice]

        avion["duracion"] = rng.randint(
            DURACION_MIN * 60,
            DURACION_MAX * 60
        )

        avion["crucero"] = rng.randint(
            720,
            890
        )

        avion["techo"] = rng.randint(
            9500,
            12000
        )

        avion["variacion"] = rng.uniform(
            0,
            2 * math.pi
        )

        avion["finalizado"] = False

        avion["ultimo_envio_ok"] = False


# =====================================================
# DATOS DEL VUELO
# =====================================================

def datos_vuelo(avion, tiempo):

    progreso = avion["progreso"]

    origen = avion["inicio"]
    destino = avion["fin"]

    posicion = interpolar(
        origen,
        destino,
        progreso
    )

    siguiente = interpolar(
        origen,
        destino,
        min(1, progreso + 0.0005)
    )

    curso = (
        rumbo(posicion, siguiente)
        if progreso < 1
        else 0
    )

    factor = min(
        1,
        progreso / 0.12,
        (1 - progreso) / 0.15
    )

    factor = max(0, factor)

    altitud_base = 2000

    altitud = (
        altitud_base
        + (avion["techo"] - altitud_base)
        * factor
    )

    altitud += (
        math.sin(
            tiempo / 25 + avion["variacion"]
        )
        * 35
        * factor
    )

    velocidad = (
        avion["crucero"]
        * (0.42 + 0.58 * factor)
        + math.sin(
            tiempo / 18 + avion["variacion"]
        )
        * 12
        * factor
    )

    if progreso >= 1:
        velocidad = 0
        altitud = altitud_base
        curso = 0

    return (
        posicion[0],
        posicion[1],
        max(0, velocidad),
        max(0, altitud),
        curso
    )


# =====================================================
# SIMULADOR PRINCIPAL
# =====================================================

def ejecutar():

    with open(
        RUTAS,
        encoding="utf-8"
    ) as archivo:

        aviones = json.load(archivo)

    if len(aviones) != 30:
        raise ValueError(
            "El archivo rutas.json debe contener 30 vuelos"
        )

    preparar_vuelos(aviones)

    print("=" * 65)
    print("       GEOCARGA RADAR - 30 AERONAVES")
    print("=" * 65)
    print("Cobertura: Sudamerica")
    print("Actualizacion: 3 segundos")
    print("Los vuelos terminan al llegar al 100%")
    print("Presiona CTRL + C para detener")
    print("=" * 65)

    inicio = time.monotonic()
    ciclo = 0

    try:

        while True:

            tiempo = time.monotonic() - inicio

            activos = 0
            finalizados = 0
            pendientes_gps = 0

            for avion in aviones:

                # Si el avión ya terminó y su posición
                # final fue recibida, no volver a moverlo.
                if (
                    avion["finalizado"]
                    and avion["ultimo_envio_ok"]
                ):
                    finalizados += 1
                    continue

                if not avion["finalizado"]:

                    avion["progreso"] = min(
                        1,
                        avion["progreso"]
                        + INTERVALO / avion["duracion"]
                    )

                    if avion["progreso"] >= 1:
                        avion["progreso"] = 1
                        avion["finalizado"] = True

                lat, lon, vel, alt, curso = datos_vuelo(
                    avion,
                    tiempo
                )

                enviado = enviar(
                    avion,
                    lat,
                    lon,
                    vel,
                    alt,
                    curso
                )

                avion["ultimo_envio_ok"] = enviado

                if avion["finalizado"]:

                    if enviado:
                        finalizados += 1

                        print(
                            f"🛬 {avion['id']} | "
                            f"{avion['origen']} -> "
                            f"{avion['destino']} | "
                            f"100% | FINALIZADO"
                        )

                    else:
                        pendientes_gps += 1

                else:

                    activos += 1

                    print(
                        f"{avion['id']} | "
                        f"{avion['origen']} -> "
                        f"{avion['destino']} | "
                        f"{avion['progreso']:.0%} | "
                        f"{vel:.0f} km/h | "
                        f"{alt:.0f} m"
                    )

            ciclo += 1

            print("\n" + "-" * 65)

            print(
                f"CICLO {ciclo} | "
                f"En vuelo: {activos} | "
                f"Finalizados: {finalizados} | "
                f"Pendientes GPS: {pendientes_gps}"
            )

            print("-" * 65 + "\n")

            # Terminar únicamente cuando todos
            # hayan llegado y Traccar haya recibido
            # su última posición.
            if finalizados == len(aviones):

                print("=" * 65)
                print("       GEOCARGA - SIMULACION FINALIZADA")
                print("=" * 65)

                print(
                    f"Aeronaves monitoreadas: {len(aviones)}"
                )

                print(
                    f"Vuelos finalizados: {finalizados}"
                )

                print("Vuelos activos: 0")
                print("Todos llegaron a su destino.")

                print("=" * 65)

                break

            time.sleep(INTERVALO)

    except KeyboardInterrupt:

        print(
            "\nSimulacion detenida por el usuario."
        )


if __name__ == "__main__":
    ejecutar()