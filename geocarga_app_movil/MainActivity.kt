package com.example.geocarga_app_movil

import android.content.Intent
import android.os.Bundle
import android.view.View
import android.widget.TextView
import android.widget.Toast
import androidx.activity.enableEdgeToEdge
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.updatePadding
import androidx.lifecycle.lifecycleScope
import com.google.android.material.button.MaterialButton
import com.google.gson.JsonParseException
import kotlinx.coroutines.launch
import retrofit2.HttpException
import java.io.IOException
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class MainActivity : AppCompatActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        if (!SessionManager.isLoggedIn(this)) {
            volverAlLogin()
            finish()
            return
        }

        enableEdgeToEdge()
        setContentView(R.layout.activity_main)
        WindowCompat.getInsetsController(window, window.decorView).isAppearanceLightStatusBars = false

        val root = findViewById<View>(R.id.root)
        val header = findViewById<View>(R.id.header)
        val headerTop = header.paddingTop
        ViewCompat.setOnApplyWindowInsetsListener(root) { v, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
            header.updatePadding(top = headerTop + bars.top)
            v.updatePadding(bottom = bars.bottom)
            insets
        }

        val nombre = SessionManager.name(this).ifBlank { "Usuario" }
        findViewById<TextView>(R.id.tvNombre).text = nombre
        findViewById<TextView>(R.id.tvCorreo).text = SessionManager.email(this)
        findViewById<TextView>(R.id.tvRol).text = SessionManager.role(this)
        findViewById<TextView>(R.id.tvIniciales).text = iniciales(nombre)

        val formato = SimpleDateFormat("dd/MM/yyyy HH:mm", Locale.forLanguageTag("es-CO"))
        findViewById<TextView>(R.id.tvSesion).text =
            formato.format(Date(SessionManager.lastLogin(this)))

        findViewById<MaterialButton>(R.id.btnSeguimiento).setOnClickListener {
            startActivity(Intent(this, TrackingActivity::class.java))
        }

        findViewById<MaterialButton>(R.id.btnCerrarSesion).setOnClickListener {
            lifecycleScope.launch {
                try {
                    ApiClient.backend.logout()
                } catch (e: IOException) {
                    // sin conexión: igual se cierra la sesión en el teléfono
                }
                volverAlLogin()
                finish()
            }
        }

        cargarResumen(SessionManager.role(this))
    }

    private fun cargarResumen(rol: String) {
        lifecycleScope.launch {
            try {
                if (rol == "Cliente" || rol == "Conductor") {
                    val envios = ApiClient.backend.misEnvios()
                    poner(1, envios.size, "Mis envíos")
                    poner(2, envios.count { it.estadoGeneral == "EN_TRANSITO" }, "En tránsito")
                    poner(3, envios.count { it.estadoGeneral == "ENTREGADO" }, "Entregados")
                } else {
                    val d = ApiClient.backend.dashboard()
                    poner(1, d.resumen?.enTransito ?: 0, "En tránsito")
                    poner(2, d.resumen?.enAduana ?: 0, "En aduana")
                    poner(3, d.novedadesRecientes.orEmpty().count { it.validadaEn == null }, "Novedades por validar")
                }
            } catch (e: HttpException) {
                if (e.code() == 401) {
                    volverAlLogin()
                    finish()
                } else {
                    avisar("No se pudo cargar el resumen (${e.code()})")
                }
            } catch (e: IOException) {
                avisar("No se pudo conectar con el servidor")
            } catch (e: JsonParseException) {
                avisar("Respuesta inesperada del servidor")
            }
        }
    }

    private fun poner(posicion: Int, valor: Int, etiqueta: String) {
        val numeros = listOf(R.id.tvKpi1, R.id.tvKpi2, R.id.tvKpi3)
        val etiquetas = listOf(R.id.tvKpi1Label, R.id.tvKpi2Label, R.id.tvKpi3Label)
        findViewById<TextView>(numeros[posicion - 1]).text = valor.toString()
        findViewById<TextView>(etiquetas[posicion - 1]).text = etiqueta
    }

    private fun avisar(mensaje: String) =
        Toast.makeText(this, mensaje, Toast.LENGTH_LONG).show()

    private fun iniciales(nombre: String): String =
        nombre.split(" ")
            .filter { it.isNotBlank() }
            .take(2)
            .joinToString("") { it.first().uppercase() }
            .ifEmpty { "G" }
}