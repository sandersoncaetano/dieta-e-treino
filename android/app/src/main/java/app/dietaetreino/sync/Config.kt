package app.dietaetreino.sync

import android.content.Context

/** Endereço do app, chave de envio e estado da última sincronização. */
class Config(ctx: Context) {
    private val p = ctx.getSharedPreferences("config", Context.MODE_PRIVATE)

    var url: String
        get() = p.getString("url", "") ?: ""
        set(v) = p.edit().putString("url", v.trim()).apply()
    var chave: String
        get() = p.getString("chave", "") ?: ""
        set(v) = p.edit().putString("chave", v.trim()).apply()
    /** Instante (ms) da última sincronização que deu certo. 0 = nunca. */
    var ultimaOk: Long
        get() = p.getLong("ultimaOk", 0L)
        set(v) = p.edit().putLong("ultimaOk", v).apply()
    var ultimoStatus: String
        get() = p.getString("ultimoStatus", "") ?: ""
        set(v) = p.edit().putString("ultimoStatus", v).apply()

    val configurado get() = url.startsWith("https://") && chave.isNotEmpty()
}
