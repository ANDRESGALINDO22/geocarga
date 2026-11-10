package com.example.geocarga_app_movil

import android.app.Application
import android.content.Context
import okhttp3.Cookie
import okhttp3.CookieJar
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.Interceptor
import okhttp3.OkHttpClient
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory
import java.util.concurrent.TimeUnit

/** Dirección del servidor GeoCarga. Se cambia desde el login (toca "Servidor"). */
object ServerConfig {
    // Valor inicial: emulador con el backend en tu PC (puerto 4000 por defecto)
    const val DEFAULT_URL = "http://10.0.2.2:4000/"
    private const val PREFS = "geocarga_config"
    private const val KEY = "base_url"

    fun get(context: Context): String =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY, DEFAULT_URL) ?: DEFAULT_URL

    /** Devuelve true si la dirección es válida y quedó guardada. */
    fun save(context: Context, texto: String): Boolean {
        var url = texto.trim()
        if (url.isEmpty()) return false
        if (!url.startsWith("http://") && !url.startsWith("https://")) url = "https://$url"
        if (url.toHttpUrlOrNull() == null) return false
        if (!url.endsWith("/")) url += "/"
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY, url).apply()
        return true
    }
}

/** Guarda la cookie de sesión "geocarga_sesion" que entrega el backend. */
class SessionCookieJar(context: Context) : CookieJar {
    private val prefs = context.getSharedPreferences("geocarga_cookie", Context.MODE_PRIVATE)

    override fun saveFromResponse(url: HttpUrl, cookies: List<Cookie>) {
        cookies.firstOrNull { it.name == COOKIE }?.let { c ->
            if (c.expiresAt < System.currentTimeMillis()) {
                prefs.edit().clear().apply() // el backend cerró la sesión
            } else {
                prefs.edit().putString("valor", c.value).putLong("vence", c.expiresAt).apply()
            }
        }
    }

    override fun loadForRequest(url: HttpUrl): List<Cookie> {
        val valor = prefs.getString("valor", null) ?: return emptyList()
        if (prefs.getLong("vence", 0L) < System.currentTimeMillis()) return emptyList()
        return listOf(
            Cookie.Builder().name(COOKIE).value(valor).hostOnlyDomain(url.host).path("/").build()
        )
    }

    fun clear() = prefs.edit().clear().apply()

    companion object {
        private const val COOKIE = "geocarga_sesion"
    }
}

object ApiClient {
    private lateinit var appContext: Context
    private lateinit var cookieJar: SessionCookieJar

    val backend: BackendApi by lazy {
        val http = OkHttpClient.Builder()
            .cookieJar(cookieJar)
            .addInterceptor(Interceptor { chain ->
                // Redirige cada petición al servidor que el usuario configuró
                var request = chain.request()
                val base = ServerConfig.get(appContext).toHttpUrlOrNull()
                if (base != null) {
                    val nueva = request.url.newBuilder()
                        .scheme(base.scheme).host(base.host).port(base.port).build()
                    request = request.newBuilder().url(nueva).build()
                }
                chain.proceed(request)
            })
            .connectTimeout(10, TimeUnit.SECONDS)
            .readTimeout(20, TimeUnit.SECONDS)
            .build()

        Retrofit.Builder()
            .baseUrl("http://servidor.invalido/") // se reemplaza en el interceptor
            .client(http)
            .addConverterFactory(GsonConverterFactory.create())
            .build()
            .create(BackendApi::class.java)
    }

    fun init(context: Context) {
        appContext = context.applicationContext
        cookieJar = SessionCookieJar(appContext)
    }

    fun clearSession() = cookieJar.clear()
}

class GeocargaApp : Application() {
    override fun onCreate() {
        super.onCreate()
        ApiClient.init(this)
    }
}