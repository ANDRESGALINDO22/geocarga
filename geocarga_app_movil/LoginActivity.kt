package com.example.geocarga_app_movil

import android.content.Intent
import android.os.Bundle
import android.text.InputType
import android.util.Patterns
import android.view.View
import android.widget.EditText
import android.widget.TextView
import android.widget.Toast
import androidx.activity.enableEdgeToEdge
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.app.AppCompatDelegate
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.updatePadding
import androidx.lifecycle.lifecycleScope
import com.google.android.material.button.MaterialButton
import com.google.android.material.textfield.TextInputEditText
import com.google.android.material.textfield.TextInputLayout
import com.google.gson.JsonParseException
import kotlinx.coroutines.launch
import retrofit2.HttpException
import java.io.IOException

class LoginActivity : AppCompatActivity() {

    private lateinit var btnIngresar: MaterialButton
    private lateinit var tvServidor: TextView

    override fun onCreate(savedInstanceState: Bundle?) {
        AppCompatDelegate.setDefaultNightMode(AppCompatDelegate.MODE_NIGHT_NO)
        super.onCreate(savedInstanceState)

        if (SessionManager.isLoggedIn(this)) {
            irAlMenu()
            return
        }

        enableEdgeToEdge()
        setContentView(R.layout.activity_login)
        WindowCompat.getInsetsController(window, window.decorView).isAppearanceLightStatusBars = false

        val root = findViewById<View>(R.id.root)
        val header = findViewById<View>(R.id.header)
        val headerTop = header.paddingTop
        ViewCompat.setOnApplyWindowInsetsListener(root) { v, insets ->
            val bars = insets.getInsets(
                WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.ime()
            )
            header.updatePadding(top = headerTop + bars.top)
            v.updatePadding(bottom = bars.bottom)
            insets
        }

        val tilCorreo = findViewById<TextInputLayout>(R.id.tilCorreo)
        val tilClave = findViewById<TextInputLayout>(R.id.tilClave)
        val etCorreo = findViewById<TextInputEditText>(R.id.etCorreo)
        val etClave = findViewById<TextInputEditText>(R.id.etClave)
        btnIngresar = findViewById(R.id.btnIngresar)
        tvServidor = findViewById(R.id.tvServidor)

        tvServidor.text = textoServidor()
        tvServidor.setOnClickListener { pedirServidor() }

        btnIngresar.setOnClickListener {
            val correo = etCorreo.text.toString().trim()
            val clave = etClave.text.toString()

            tilCorreo.error = null
            tilClave.error = null

            if (!Patterns.EMAIL_ADDRESS.matcher(correo).matches()) {
                tilCorreo.error = "Ingresa un correo válido"
                return@setOnClickListener
            }
            if (clave.isEmpty()) {
                tilClave.error = "Ingresa tu contraseña"
                return@setOnClickListener
            }

            setCargando(true)
            lifecycleScope.launch {
                try {
                    val u = ApiClient.backend.login(LoginRequest(correo, clave)).usuario
                    if (u == null) {
                        tilClave.error = "Respuesta inesperada del servidor"
                        return@launch
                    }
                    SessionManager.saveSession(
                        this@LoginActivity,
                        u.nombre ?: nombreDesdeCorreo(correo),
                        u.correo ?: correo,
                        u.rol ?: ""
                    )
                    irAlMenu()
                } catch (e: HttpException) {
                    tilClave.error = if (e.code() == 401) {
                        "Correo o contraseña incorrectos"
                    } else {
                        "Error del servidor (${e.code()})"
                    }
                } catch (e: IOException) {
                    tilClave.error = "No se pudo conectar. Toca \"Servidor\" para revisar la dirección."
                } catch (e: JsonParseException) {
                    tilClave.error = "Respuesta inesperada. Revisa la dirección del servidor."
                } finally {
                    setCargando(false)
                }
            }
        }
    }

    private fun textoServidor() = "Servidor: ${ServerConfig.get(this)}  ·  toca para cambiar"

    private fun pedirServidor() {
        val campo = EditText(this).apply {
            setText(ServerConfig.get(this@LoginActivity))
            isSingleLine = true
            inputType = InputType.TYPE_TEXT_VARIATION_URI
            setPadding(48, 32, 48, 32)
        }
        AlertDialog.Builder(this)
            .setTitle("Dirección del servidor")
            .setMessage("Ejemplos: https://algo.trycloudflare.com o http://192.168.1.50:4000")
            .setView(campo)
            .setPositiveButton("Guardar") { _, _ ->
                if (ServerConfig.save(this, campo.text.toString())) {
                    ApiClient.clearSession()
                    tvServidor.text = textoServidor()
                } else {
                    Toast.makeText(this, "Dirección no válida", Toast.LENGTH_LONG).show()
                }
            }
            .setNegativeButton("Cancelar", null)
            .show()
    }

    private fun setCargando(cargando: Boolean) {
        btnIngresar.isEnabled = !cargando
        btnIngresar.text = if (cargando) "Ingresando…" else "Iniciar sesión"
    }

    // "juan.perez@empresa.com" -> "Juan Perez"
    private fun nombreDesdeCorreo(correo: String): String =
        correo.substringBefore("@")
            .split(".", "_", "-")
            .filter { it.isNotBlank() }
            .joinToString(" ") { it.replaceFirstChar { c -> c.uppercase() } }

    private fun irAlMenu() {
        startActivity(Intent(this, MainActivity::class.java))
        finish()
    }
}