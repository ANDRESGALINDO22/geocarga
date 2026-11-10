package com.example.geocarga_app_movil

import retrofit2.http.Field
import retrofit2.http.FormUrlEncoded
import retrofit2.http.GET
import retrofit2.http.POST
import retrofit2.http.Query
import java.text.ParseException
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

data class TraccarUser(
    val id: Long,
    val name: String?,
    val email: String?,
    val administrator: Boolean?
)

data class TraccarDevice(
    val id: Long,
    val name: String?,
    val uniqueId: String?,
    val status: String?,        // "online", "offline" o "unknown"
    val lastUpdate: String?
)

data class TraccarPosition(
    val id: Long,
    val deviceId: Long,
    val fixTime: String?,
    val latitude: Double,
    val longitude: Double,
    val altitude: Double?,      // metros
    val speed: Double?,         // NUDOS
    val course: Double?
)

data class TraccarEvent(
    val id: Long,
    val type: String?,
    val deviceId: Long,
    val eventTime: String?
)

/** Mensaje que llega por el WebSocket. Cada lista puede venir vacía o ausente. */
data class SocketMessage(
    val devices: List<TraccarDevice>?,
    val positions: List<TraccarPosition>?,
    val events: List<TraccarEvent>?
)

interface TraccarApi {
    @FormUrlEncoded
    @POST("session")
    suspend fun login(
        @Field("email") email: String,
        @Field("password") password: String
    ): TraccarUser

    @GET("devices")
    suspend fun devices(): List<TraccarDevice>

    /** Última posición conocida de cada dispositivo. */
    @GET("positions")
    suspend fun positions(): List<TraccarPosition>

    /** Recorrido de un dispositivo entre dos fechas (ISO 8601 en UTC). */
    @GET("reports/route")
    suspend fun route(
        @Query("deviceId") deviceId: Long,
        @Query("from") from: String,
        @Query("to") to: String
    ): List<TraccarPosition>
}

object TimeUtils {
    private val parsers = listOf("yyyy-MM-dd'T'HH:mm:ss.SSSXXX", "yyyy-MM-dd'T'HH:mm:ssXXX")

    fun parse(s: String?): Date? {
        if (s.isNullOrBlank()) return null
        for (pattern in parsers) {
            try {
                return SimpleDateFormat(pattern, Locale.US).parse(s)
            } catch (e: ParseException) {
                // prueba con el siguiente formato
            }
        }
        return null
    }

    /** Fecha de Traccar (UTC) -> hora local del teléfono. */
    fun local(s: String?): String {
        val d = parse(s) ?: return "--"
        return SimpleDateFormat("dd/MM/yyyy HH:mm:ss", Locale.forLanguageTag("es-CO")).format(d)
    }

    fun isoUtc(d: Date): String =
        SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US)
            .apply { timeZone = TimeZone.getTimeZone("UTC") }
            .format(d)
}