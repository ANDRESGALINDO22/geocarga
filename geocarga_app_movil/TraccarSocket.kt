package com.example.geocarga_app_movil

import android.os.Handler
import android.os.Looper
import com.google.gson.Gson
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener

class TraccarSocket(
    private val client: OkHttpClient,
    private val onData: (SocketMessage) -> Unit,
    private val onConnected: (Boolean) -> Unit
) {
    private val gson = Gson()
    private val handler = Handler(Looper.getMainLooper())
    private var ws: WebSocket? = null
    private var closed = false

    fun connect() {
        closed = false
        val request = Request.Builder().url(AppConfig.TRACCAR_WS).build()
        ws = client.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                handler.post { onConnected(true) }
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                val msg = try {
                    gson.fromJson(text, SocketMessage::class.java)
                } catch (e: Exception) {
                    null
                }
                if (msg != null) handler.post { onData(msg) }
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                handler.post { onConnected(false) }
                scheduleReconnect()
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                handler.post { onConnected(false) }
                scheduleReconnect()
            }
        })
    }

    private fun scheduleReconnect() {
        if (closed) return
        handler.removeCallbacksAndMessages(null)
        handler.postDelayed({ if (!closed) connect() }, 5000)
    }

    fun close() {
        closed = true
        handler.removeCallbacksAndMessages(null)
        ws?.close(1000, null)
        ws = null
    }
}