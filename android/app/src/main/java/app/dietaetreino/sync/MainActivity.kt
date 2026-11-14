package app.dietaetreino.sync

import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.net.Uri
import android.os.Bundle
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.activity.result.ActivityResultLauncher
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.PermissionController
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class MainActivity : ComponentActivity() {

    private lateinit var cfg: Config
    private lateinit var status: TextView
    private lateinit var permTxt: TextView
    private lateinit var urlIn: EditText
    private lateinit var chaveIn: EditText
    private lateinit var pedePerm: ActivityResultLauncher<Set<String>>

    private val azul = Color.parseColor("#1A5FD0")
    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        cfg = Config(this)
        pedePerm = registerForActivityResult(PermissionController.createRequestPermissionResultContract()) { atualiza() }
        montaTela()
        leLink(intent)
        atualiza()
        if (cfg.configurado) SyncWorker.agenda(this)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        leLink(intent)
        atualiza()
    }

    override fun onResume() {
        super.onResume()
        atualiza()
        // Abriu o app: aproveita para sincronizar (a leitura em primeiro plano sempre é permitida).
        if (cfg.configurado && System.currentTimeMillis() - cfg.ultimaOk > 10 * 60 * 1000) sincronizaAgora(silencioso = true)
    }

    /** Link "dietaetreino://config?url=...&chave=..." aberto a partir do app web. */
    private fun leLink(i: Intent?) {
        val u: Uri = i?.data ?: return
        if (u.scheme != "dietaetreino") return
        val url = u.getQueryParameter("url"); val chave = u.getQueryParameter("chave")
        if (!url.isNullOrBlank() && !chave.isNullOrBlank()) {
            cfg.url = url; cfg.chave = chave
            urlIn.setText(url); chaveIn.setText(chave)
            cfg.ultimoStatus = "Configurado pelo link do app."
            SyncWorker.agenda(this)
        }
    }

    private fun titulo(t: String, tam: Float = 22f) = TextView(this).apply {
        text = t; textSize = tam; setTypeface(typeface, Typeface.BOLD); setTextColor(Color.parseColor("#142338"))
        setPadding(0, dp(18), 0, dp(6))
    }
    private fun texto(t: String) = TextView(this).apply { text = t; textSize = 16f; setTextColor(Color.parseColor("#33445C")); setPadding(0, dp(4), 0, dp(4)) }
    private fun botao(t: String, principal: Boolean, acao: () -> Unit) = Button(this).apply {
        text = t; isAllCaps = false; textSize = 17f; minHeight = dp(52)
        setTextColor(if (principal) Color.WHITE else azul)
        setBackgroundColor(if (principal) azul else Color.parseColor("#E8EFFB"))
        setOnClickListener { acao() }
        layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(10) }
    }

    private fun montaTela() {
        val col = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(20), dp(28), dp(20), dp(40)) }
        col.addView(titulo("Dieta e Treino Sync", 26f))
        col.addView(texto("Leva peso, composição corporal, sono, frequência cardíaca de repouso e passos do Health Connect (Zepp) para o app Dieta e Treino, a cada hora."))

        col.addView(titulo("1. Ligar ao app"))
        col.addView(texto("No Dieta e Treino, abra Conta › Health Connect e toque em \"Configurar app Android\". Ou cole os dados abaixo."))
        urlIn = EditText(this).apply { hint = "Endereço"; inputType = InputType.TYPE_TEXT_VARIATION_URI; setText(cfg.url) }
        chaveIn = EditText(this).apply { hint = "Chave"; inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD; setText(cfg.chave) }
        col.addView(urlIn); col.addView(chaveIn)
        col.addView(botao("Salvar", false) {
            cfg.url = urlIn.text.toString(); cfg.chave = chaveIn.text.toString()
            cfg.ultimoStatus = if (cfg.configurado) "Configuração salva." else "Endereço precisa começar com https:// e a chave não pode ficar vazia."
            if (cfg.configurado) SyncWorker.agenda(this)
            atualiza()
        })

        col.addView(titulo("2. Permitir acesso"))
        permTxt = texto("")
        col.addView(permTxt)
        col.addView(botao("Permitir leitura no Health Connect", false) { pedePermissoes() })

        col.addView(titulo("3. Sincronizar"))
        status = texto("")
        col.addView(status)
        col.addView(botao("Sincronizar agora", true) { sincronizaAgora(false) })
        col.addView(botao("Abrir o Dieta e Treino", false) {
            val base = cfg.url.substringBefore("/api/").ifBlank { "https://dieta-e-treino-lovat.vercel.app" }
            startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(base)))
        })
        setContentView(ScrollView(this).apply { setBackgroundColor(Color.WHITE); addView(col) })
    }

    private fun pedePermissoes() {
        when (HealthConnectClient.getSdkStatus(this)) {
            HealthConnectClient.SDK_AVAILABLE -> pedePerm.launch(Sincronizador.PERMISSOES)
            HealthConnectClient.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED -> startActivity(Intent(Intent.ACTION_VIEW,
                Uri.parse("market://details?id=com.google.android.apps.healthdata&url=healthconnect%3A%2F%2Fonboarding")))
            else -> { permTxt.text = "O Health Connect não está disponível neste celular." }
        }
    }

    private fun sincronizaAgora(silencioso: Boolean) {
        if (!cfg.configurado) { if (!silencioso) { cfg.ultimoStatus = "Configure o endereço e a chave primeiro."; atualiza() }; return }
        status.text = "Sincronizando..."
        lifecycleScope.launch {
            val hora = SimpleDateFormat("dd/MM HH:mm", Locale("pt", "BR")).format(Date())
            cfg.ultimoStatus = try { "$hora: " + Sincronizador.sincroniza(this@MainActivity) }
            catch (e: Exception) { "$hora: falhou. ${e.message ?: e.javaClass.simpleName}" }
            atualiza()
        }
    }

    private fun atualiza() {
        if (!::status.isInitialized) return
        status.text = buildString {
            append(if (cfg.configurado) "Ligado a: " + cfg.url.substringBefore("/api/") else "Ainda não configurado.")
            if (cfg.ultimoStatus.isNotEmpty()) append("\nÚltimo: ").append(cfg.ultimoStatus)
        }
        if (HealthConnectClient.getSdkStatus(this) != HealthConnectClient.SDK_AVAILABLE) {
            permTxt.text = "Health Connect não encontrado ou precisa de atualização."
            return
        }
        lifecycleScope.launch {
            val dadas = runCatching { HealthConnectClient.getOrCreate(this@MainActivity).permissionController.getGrantedPermissions() }.getOrDefault(emptySet())
            val dados = Sincronizador.PERMISSOES - Sincronizador.PERM_FUNDO - Sincronizador.PERM_HISTORICO
            val ok = dados.count { it in dadas }
            val fundo = Sincronizador.PERM_FUNDO in dadas
            permTxt.text = "Liberados: $ok de ${dados.size} tipos de dado." +
                (if (fundo) " Leitura em segundo plano: liberada." else " Leitura em segundo plano: não liberada (sincroniza só quando você abre este app).")
        }
    }
}
