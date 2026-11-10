package com.example.geocarga_app_movil

import com.google.gson.annotations.SerializedName
import java.text.ParseException
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import kotlin.math.asin
import kotlin.math.cos
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.roundToInt
import kotlin.math.sin
import kotlin.math.sqrt

/** Una aeronave tal como la entrega GET /api/aviones. */
data class Avion(
    val id: String,
    val nombre: String?,
    val carga: String?,
    val color: String?,
    val origen: String?,
    val destino: String?,
    @SerializedName("origen_coords") val origenCoords: List<Double>?,   // [longitud, latitud]
    @SerializedName("destino_coords") val destinoCoords: List<Double>?, // [longitud, latitud]
    val lat: Double?,
    val lon: Double?,
    val velocidad: Double?,   // km/h (la API ya convierte los nudos de Traccar)
    val altitud: Double?,     // metros
    val rumbo: Double?,       // grados
    val estado: String?,
    val actualizado: String?, // fecha del último GPS (UTC)
    val fase: String?         // texto de fase de vuelo (solo en el radar de demo)
)

fun distanciaKm(lat1: Double, lon1: Double, lat2: Double, lon2: Double): Double {
    val dLat = Math.toRadians(lat2 - lat1)
    val dLon = Math.toRadians(lon2 - lon1)
    val h = sin(dLat / 2).pow(2) +
            cos(Math.toRadians(lat1)) * cos(Math.toRadians(lat2)) * sin(dLon / 2).pow(2)
    return 6371.0 * 2 * asin(min(1.0, sqrt(h)))
}

fun Avion.progreso(): Int {
    val la = lat ?: return 0
    val lo = lon ?: return 0
    val o = origenCoords?.takeIf { it.size >= 2 } ?: return 0
    val d = destinoCoords?.takeIf { it.size >= 2 } ?: return 0
    val total = distanciaKm(o[1], o[0], d[1], d[0])
    if (total == 0.0) return 0
    val restante = distanciaKm(la, lo, d[1], d[0])
    return ((1 - restante / total) * 100).roundToInt().coerceIn(0, 100)
}

fun Avion.finalizado(): Boolean {
    val la = lat ?: return false
    val lo = lon ?: return false
    val d = destinoCoords?.takeIf { it.size >= 2 } ?: return false
    return distanciaKm(la, lo, d[1], d[0]) < 15 && (velocidad ?: 0.0) < 50
}

/** Minutos desde el último GPS. Depende de que la hora del teléfono sea correcta. */
fun Avion.minutosSinSenal(): Long? {
    val fecha = Fechas.parse(actualizado) ?: return null
    return (System.currentTimeMillis() - fecha.time) / 60_000
}

fun Avion.estadoTexto(): String {
    if (lat == null || lon == null) return "SIN POSICIÓN"
    if (finalizado()) return "FINALIZADO"
    val sin = minutosSinSenal()
    if (sin != null && sin >= 3) return "SIN SEÑAL"
    return if ((velocidad ?: 0.0) > 0) "EN VUELO" else "EN ESPERA"
}

object Fechas {
    private val formatos = listOf(
        "yyyy-MM-dd'T'HH:mm:ss.SSSXXX",
        "yyyy-MM-dd'T'HH:mm:ssXXX"
    )

    fun parse(s: String?): Date? {
        if (s.isNullOrBlank()) return null
        for (f in formatos) {
            try {
                return SimpleDateFormat(f, Locale.US).parse(s)
            } catch (e: ParseException) {
                // prueba el siguiente formato
            }
        }
        return null
    }

    fun local(s: String?): String {
        val d = parse(s) ?: return "--"
        return SimpleDateFormat("dd/MM/yyyy HH:mm:ss", Locale.forLanguageTag("es-CO")).format(d)
    }
}

