import json
import os
from pathlib import Path

import requests
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

app = FastAPI(title="GeoCarga Radar")

BASE_DIR = Path(__file__).resolve().parent
TRACCAR_URL = "http://127.0.0.1:8082"

COLORES = {
    "Medicamentos": "#2563EB",
    "Perecederos": "#22C55E",
    "Electrónicos": "#F97316",
    "Carga general": "#A855F7"
}

with open(
    BASE_DIR / "rutas.json",
    encoding="utf-8"
) as archivo:
    RUTAS = json.load(archivo)

AERONAVES = {}

for indice, ruta in enumerate(RUTAS, start=1):
    AERONAVES[ruta["id"]] = {
        "nombre": f"Aeronave {indice:03d}",
        "carga": ruta["carga"],
        "color": COLORES[ruta["carga"]],
        "origen": ruta["origen"],
        "destino": ruta["destino"],
        "origen_coords": [
            ruta["inicio"][1],
            ruta["inicio"][0]
        ],
        "destino_coords": [
            ruta["fin"][1],
            ruta["fin"][0]
        ]
    }

app.mount(
    "/static",
    StaticFiles(directory=BASE_DIR / "static"),
    name="static"
)


@app.get("/")
def inicio():
    return FileResponse(
        BASE_DIR / "static" / "index.html"
    )


@app.get("/api/aviones")
def aviones():
    correo = os.getenv("TRACCAR_EMAIL")
    password = os.getenv("TRACCAR_PASSWORD")

    if not correo or not password:
        raise HTTPException(
            status_code=503,
            detail="Faltan credenciales de Traccar"
        )

    try:
        with requests.Session() as sesion:
            sesion.auth = (correo, password)

            respuesta_dispositivos = sesion.get(
                f"{TRACCAR_URL}/api/devices",
                timeout=10
            )
            respuesta_dispositivos.raise_for_status()

            respuesta_posiciones = sesion.get(
                f"{TRACCAR_URL}/api/positions",
                timeout=10
            )
            respuesta_posiciones.raise_for_status()

            dispositivos = respuesta_dispositivos.json()
            posiciones = respuesta_posiciones.json()

    except requests.RequestException as error:
        raise HTTPException(
            status_code=502,
            detail=f"Error consultando Traccar: {error}"
        )

    dispositivos_por_uid = {
        str(dispositivo["uniqueId"]): dispositivo
        for dispositivo in dispositivos
    }

    posiciones_por_dispositivo = {
        posicion["deviceId"]: posicion
        for posicion in posiciones
    }

    resultado = []

    # Incluir las 30 aeronaves aunque alguna
    # todavía no tenga posición GPS.
    for identificador, configuracion in AERONAVES.items():

        dispositivo = dispositivos_por_uid.get(identificador)

        posicion = None

        if dispositivo:
            posicion = posiciones_por_dispositivo.get(
                dispositivo["id"]
            )

        avion = {
            "id": identificador,
            **configuracion,

            "lat": (
                posicion["latitude"]
                if posicion else None
            ),

            "lon": (
                posicion["longitude"]
                if posicion else None
            ),

            "velocidad": (
                round(
                    posicion.get("speed", 0) * 1.852,
                    1
                )
                if posicion else 0
            ),

            "altitud": (
                posicion.get("altitude", 0)
                if posicion else 0
            ),

            "rumbo": (
                posicion.get("course", 0)
                if posicion else 0
            ),

            "estado": (
                dispositivo.get("status", "unknown")
                if dispositivo else "no registrado"
            ),

            "actualizado": (
                posicion.get("fixTime")
                if posicion else None
            )
        }

        resultado.append(avion)

    return resultado