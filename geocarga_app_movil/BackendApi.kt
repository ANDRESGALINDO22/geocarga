package com.example.geocarga_app_movil

import android.content.Context
import android.content.Intent
import com.google.gson.annotations.SerializedName
import retrofit2.Response
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.POST

data class LoginRequest(val correo: String, val contrasena: String)
data class UsuarioDto(val id: Long, val nombre: String?, val correo: String?, val rol: String?)
data class LoginResponse(val usuario: UsuarioDto?)

data class ResumenDto(
    @SerializedName("en_transito") val enTransito: Int?,
    val entregados: Int?,
    @SerializedName("en_aduana") val enAduana: Int?
)

data class NovedadDto(
    @SerializedName("id_novedad") val id: Long,
    val tipo: String?,
    val descripcion: String?,
    val fecha: String?,
    @SerializedName("validada_en") val validadaEn: String?,
    @SerializedName("numero_vuelo") val numeroVuelo: String?
)

data class DashboardResponse(
    val resumen: ResumenDto?,
    val novedadesRecientes: List<NovedadDto>?
)

data class MiEnvioDto(
    @SerializedName("id_operacion") val idOperacion: Long,
    @SerializedName("numero_vuelo") val numeroVuelo: String?,
    @SerializedName("estado_general") val estadoGeneral: String?
)

interface BackendApi {
    @POST("api/auth/login")
    suspend fun login(@Body body: LoginRequest): LoginResponse

    @POST("api/auth/logout")
    suspend fun logout(): Response<Unit>

    /** 200 si la sesión sigue vigente, 401 si no. */
    @GET("api/auth/sesion")
    suspend fun sesion(): Response<Unit>

    /** Solo roles internos (Administrador, Operador, Supervisor, Auditor). */
    @GET("api/dashboard")
    suspend fun dashboard(): DashboardResponse

    /** Solo Cliente y Conductor. */
    @GET("api/mis-envios")
    suspend fun misEnvios(): List<MiEnvioDto>

    @GET("api/radar/aviones")
    suspend fun radarAviones(): List<Avion>
}

/** Cierra la sesión local y manda al login (se usa cuando el backend responde 401). */
fun Context.volverAlLogin() {
    SessionManager.clear(this)
    ApiClient.clearSession()
    startActivity(
        Intent(this, LoginActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)
    )
}