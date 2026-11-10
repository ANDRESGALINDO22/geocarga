package com.example.geocarga_app_movil

import android.graphics.DashPathEffect
import android.os.Bundle
import android.view.View
import android.widget.ImageButton
import android.widget.ProgressBar
import android.widget.TextView
import android.widget.Toast
import androidx.activity.enableEdgeToEdge
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.updatePadding
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import com.google.android.material.button.MaterialButton
import com.google.gson.JsonParseException
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import org.osmdroid.config.Configuration
import org.osmdroid.tileprovider.tilesource.TileSourceFactory
import org.osmdroid.util.BoundingBox
import org.osmdroid.util.GeoPoint
import org.osmdroid.views.MapView
import org.osmdroid.views.overlay.Marker
import org.osmdroid.views.overlay.Polyline
import retrofit2.HttpException
import java.io.File
import java.io.IOException
import kotlin.math.roundToInt

class TrackingActivity : AppCompatActivity() {

    private lateinit var map: MapView
    private lateinit var tvConexion: TextView
    private lateinit var progress: ProgressBar
    private lateinit var card: View
    private lateinit var tvNombre: TextView
    private lateinit var tvEstadoDisp: TextView
    private lateinit var tvActualizacion: TextView
    private lateinit var tvDatos: TextView
    private lateinit var btnRuta: MaterialButton

    private val aviones = mutableMapOf<String, Avion>()
    private val markers = mutableMapOf<String, Marker>()
    private val recorridos = mutableMapOf<String, MutableList<GeoPoint>>()
    private var selectedId: String? = null
    private var mostrarRuta = true
    private var lineaRecorrido: Polyline? = null
    private var lineaPendiente: Polyline? = null
    private var vistaAjustada = false
    private var primeraCarga = true

    companion object {
        private const val INTERVALO_MS = 3000L
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        // Configuración de osmdroid: debe ir antes de crear el mapa
        val cfg = Configuration.getInstance()
        cfg.load(applicationContext, getSharedPreferences("osmdroid", MODE_PRIVATE))
        cfg.userAgentValue = packageName
        cfg.osmdroidBasePath = File(cacheDir, "osmdroid")
        cfg.osmdroidTileCache = File(cacheDir, "osmdroid/tiles")

        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContentView(R.layout.activity_tracking)
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

        map = findViewById(R.id.map)
        tvConexion = findViewById(R.id.tvConexion)
        progress = findViewById(R.id.progress)
        card = findViewById(R.id.cardDetalle)
        tvNombre = findViewById(R.id.tvNombre)
        tvEstadoDisp = findViewById(R.id.tvEstadoDisp)
        tvActualizacion = findViewById(R.id.tvActualizacion)
        tvDatos = findViewById(R.id.tvDatos)
        btnRuta = findViewById(R.id.btnTrayecto)

        map.setTileSource(TileSourceFactory.MAPNIK)
        map.setMultiTouchControls(true)
        map.controller.setZoom(4.0)
        map.controller.setCenter(GeoPoint(-15.0, -63.0)) // Sudamérica, mientras llegan los datos

        findViewById<ImageButton>(R.id.btnAtras).setOnClickListener { finish() }
        btnRuta.setOnClickListener { alternarRuta() }

        // Consulta la API cada 3 s mientras la pantalla está visible
        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) {
                while (isActive) {
                    consultar()
                    delay(INTERVALO_MS)
                }
            }
        }
    }

    override fun onResume() {
        super.onResume()
        map.onResume()
    }

    override fun onPause() {
        super.onPause()
        map.onPause()
    }

    override fun onDestroy() {
        map.onDetach()
        super.onDestroy()
    }

    // ---------- Consulta a la API ----------

    private suspend fun consultar() {
        if (primeraCarga) progress.visibility = View.VISIBLE
        try {
            val lista = ApiClient.backend.radarAviones()

            // Con la cookie vencida el backend responde 200 con lista vacía: se confirma con /sesion
            if (lista.isEmpty() && ApiClient.backend.sesion().code() == 401) {
                volverAlLogin()
                finish()
                return
            }

            val conPosicion = lista.count { it.lat != null && it.lon != null }
            procesar(lista)
            setConexion(if (conPosicion > 0) "● En vivo · $conPosicion" else "Sin datos GPS")
            if (primeraCarga && conPosicion == 0) {
                toast("No hay aeronaves para mostrar: no tienes envíos asignados o el radar no tiene posiciones.")
            }
        } catch (e: HttpException) {
            if (e.code() == 401) {
                volverAlLogin()
                finish()
                return
            }
            setConexion("Error del servidor (${e.code()})")
            if (primeraCarga) toast(mensajeHttp(e.code()))
        } catch (e: IOException) {
            setConexion("Sin conexión · reintentando…")
            if (primeraCarga) toast("No se pudo conectar. Revisa la dirección del servidor en el login.")
        } catch (e: JsonParseException) {
            setConexion("Respuesta inesperada del servidor")
        } finally {
            progress.visibility = View.GONE
            primeraCarga = false
        }
    }

    private fun mensajeHttp(codigo: Int): String = when (codigo) {
        503 -> "El radar no está disponible en el servidor."
        else -> "Error del servidor ($codigo)."
    }

    private fun procesar(lista: List<Avion>) {
        for (a in lista) {
            aviones[a.id] = a
            val la = a.lat
            val lo = a.lon
            if (la == null || lo == null) continue
            val punto = GeoPoint(la, lo)

            // Guarda por dónde ha pasado mientras la pantalla está abierta
            val trayecto = recorridos.getOrPut(a.id) { mutableListOf() }
            val ultimo = trayecto.lastOrNull()
            if (ultimo == null || distanciaKm(ultimo.latitude, ultimo.longitude, la, lo) > 0.01) {
                trayecto.add(punto)
                if (trayecto.size > 600) trayecto.removeAt(0)
            }

            val marker = markers.getOrPut(a.id) { crearMarcador(a.id) }
            marker.position = punto
            // Si los aviones apuntan al lado contrario de su dirección, quita "360.0 - "
            marker.setRotation((360.0 - (a.rumbo ?: 0.0)).toFloat())
        }

        ajustarVistaInicial()
        selectedId?.let { mostrarDetalle(it) }
        dibujarRuta()
        map.invalidate()
    }

    // ---------- Mapa ----------

    private fun crearMarcador(id: String): Marker =
        Marker(map).apply {
            icon = ContextCompat.getDrawable(this@TrackingActivity, R.drawable.ic_plane_marker)
            setAnchor(Marker.ANCHOR_CENTER, Marker.ANCHOR_CENTER)
            setOnMarkerClickListener { _, _ ->
                seleccionar(id)
                true
            }
            map.overlays.add(this)
        }

    private fun seleccionar(id: String) {
        selectedId = id
        mostrarDetalle(id)
        dibujarRuta()
        recorridos[id]?.lastOrNull()?.let { map.controller.animateTo(it) }
    }

    private fun ajustarVistaInicial() {
        if (vistaAjustada) return
        val puntos = recorridos.values.mapNotNull { it.lastOrNull() }
        if (puntos.isEmpty()) return
        vistaAjustada = true
        if (puntos.distinct().size < 2) {
            map.controller.setZoom(9.0)
            map.controller.setCenter(puntos.first())
        } else {
            map.post { map.zoomToBoundingBox(BoundingBox.fromGeoPoints(puntos), true, 120) }
        }
    }

    // ---------- Ruta del avión seleccionado ----------

    private fun dibujarRuta() {
        quitarLineas()
        val id = selectedId ?: return
        if (!mostrarRuta) {
            map.invalidate()
            return
        }
        val avion = aviones[id] ?: return
        val hecho = recorridos[id].orEmpty()
        val actual = hecho.lastOrNull() ?: return

        // Línea punteada: de la posición actual al destino
        val destino = avion.destinoCoords?.takeIf { it.size >= 2 }?.let { GeoPoint(it[1], it[0]) }
        if (destino != null) {
            val pendiente = Polyline(map).apply {
                setPoints(listOf(actual, destino))
                outlinePaint.color = ContextCompat.getColor(this@TrackingActivity, R.color.geo_gray)
                outlinePaint.strokeWidth = 5f
                outlinePaint.pathEffect = DashPathEffect(floatArrayOf(24f, 18f), 0f)
            }
            map.overlays.add(0, pendiente) // debajo de los aviones
            lineaPendiente = pendiente
        }

        // Línea sólida: por dónde ha pasado desde que abriste la pantalla
        if (hecho.size >= 2) {
            val linea = Polyline(map).apply {
                setPoints(hecho.toList())
                outlinePaint.color = ContextCompat.getColor(this@TrackingActivity, R.color.geo_navy)
                outlinePaint.strokeWidth = 8f
            }
            map.overlays.add(0, linea)
            lineaRecorrido = linea
        }
        map.invalidate()
    }

    private fun quitarLineas() {
        lineaRecorrido?.let { map.overlays.remove(it) }
        lineaPendiente?.let { map.overlays.remove(it) }
        lineaRecorrido = null
        lineaPendiente = null
    }

    private fun alternarRuta() {
        mostrarRuta = !mostrarRuta
        btnRuta.text = if (mostrarRuta) "Ocultar ruta" else "Ver ruta"
        dibujarRuta()
    }

    // ---------- Tarjeta de detalle ----------

    private fun mostrarDetalle(id: String) {
        val a = aviones[id] ?: return
        tvNombre.text = a.nombre ?: "Aeronave $id"
        tvEstadoDisp.text = a.estadoTexto()
        tvActualizacion.text = "${a.origen ?: "?"} → ${a.destino ?: "?"}  ·  ${a.carga ?: "Carga"}"
        tvDatos.text =
            "Velocidad: ${(a.velocidad ?: 0.0).roundToInt()} km/h  ·  Altitud: ${(a.altitud ?: 0.0).roundToInt()} m\n" +
                    "Progreso: ${if (a.origenCoords != null) a.progreso().toString() + "%" else "—"}  ·  Actualizado: ${Fechas.local(a.actualizado)}"
        btnRuta.text = if (mostrarRuta) "Ocultar ruta" else "Ver ruta"
        card.visibility = View.VISIBLE
    }

    // ---------- Utilidades ----------

    private fun setConexion(texto: String) {
        tvConexion.text = texto
    }

    private fun toast(mensaje: String) {
        Toast.makeText(this, mensaje, Toast.LENGTH_LONG).show()
    }
}