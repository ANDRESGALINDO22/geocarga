package com.example.geocarga_app_movil

import android.content.Context

object SessionManager {
    private const val PREFS = "geocarga_session"
    private const val KEY_LOGGED = "logged"
    private const val KEY_NAME = "name"
    private const val KEY_EMAIL = "email"
    private const val KEY_ROLE = "role"
    private const val KEY_LAST_LOGIN = "last_login"

    private fun prefs(context: Context) =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun saveSession(context: Context, name: String, email: String, role: String) {
        prefs(context).edit()
            .putBoolean(KEY_LOGGED, true)
            .putString(KEY_NAME, name)
            .putString(KEY_EMAIL, email)
            .putString(KEY_ROLE, role)
            .putLong(KEY_LAST_LOGIN, System.currentTimeMillis())
            .apply()
    }

    fun isLoggedIn(context: Context) = prefs(context).getBoolean(KEY_LOGGED, false)
    fun name(context: Context) = prefs(context).getString(KEY_NAME, "") ?: ""
    fun email(context: Context) = prefs(context).getString(KEY_EMAIL, "") ?: ""
    fun role(context: Context) = prefs(context).getString(KEY_ROLE, "") ?: ""
    fun lastLogin(context: Context) = prefs(context).getLong(KEY_LAST_LOGIN, System.currentTimeMillis())
    fun clear(context: Context) = prefs(context).edit().clear().apply()
}