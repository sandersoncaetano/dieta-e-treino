package app.dietaetreino.sync

import android.content.Context
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.BasalMetabolicRateRecord
import androidx.health.connect.client.records.BodyFatRecord
import androidx.health.connect.client.records.BodyWaterMassRecord
import androidx.health.connect.client.records.BoneMassRecord
import androidx.health.connect.client.records.LeanBodyMassRecord
import androidx.health.connect.client.records.Record
import androidx.health.connect.client.records.RestingHeartRateRecord
import androidx.health.connect.client.records.SleepSessionRecord
import androidx.health.connect.client.records.StepsRecord
import androidx.health.connect.client.records.WeightRecord
import androidx.health.connect.client.request.AggregateGroupByPeriodRequest
import androidx.health.connect.client.request.ReadRecordsRequest
import androidx.health.connect.client.time.TimeRangeFilter
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.time.Duration
import java.time.Instant
import java.time.LocalDate
import java.time.Period
import java.time.ZoneId
import java.time.ZoneOffset
import kotlin.reflect.KClass

/**
 * Lê do Health Connect e envia para /api/saude no mesmo formato JSON do app
 * "Health Connect Webhook" (weight, body_fat, sleep, steps...), que o servidor já entende.
 */
object Sincronizador {

    val TIPOS: List<KClass<out Record>> = listOf(
        WeightRecord::class, BodyFatRecord::class, LeanBodyMassRecord::class, BoneMassRecord::class,
        BodyWaterMassRecord::class, BasalMetabolicRateRecord::class, RestingHeartRateRecord::class,
        SleepSessionRecord::class, StepsRecord::class
    )
    const val PERM_FUNDO = "android.permission.health.READ_HEALTH_DATA_IN_BACKGROUND"
    const val PERM_HISTORICO = "android.permission.health.READ_HEALTH_DATA_HISTORY"
    val PERMISSOES: Set<String> = TIPOS.map { HealthPermission.getReadPermission(it) }.toSet() + PERM_FUNDO + PERM_HISTORICO

    private val fuso: ZoneId get() = ZoneId.systemDefault()
    private fun iso(i: Instant, off: ZoneOffset?): String =
        i.atOffset(off ?: fuso.rules.getOffset(i)).toString()

    private fun meta(r: Record): JSONObject = JSONObject()
        .put("id", r.metadata.id)
        .put("data_origin", r.metadata.dataOrigin.packageName)

    private suspend fun <T : Record> le(hc: HealthConnectClient, tipo: KClass<T>, ini: Instant, fim: Instant): List<T> {
        val todos = mutableListOf<T>()
        var token: String? = null
        do {
            val resp = hc.readRecords(ReadRecordsRequest(tipo, TimeRangeFilter.between(ini, fim), pageSize = 1000, pageToken = token))
            todos += resp.records
            token = resp.pageToken
        } while (!token.isNullOrEmpty())
        return todos
    }

    private fun estagio(s: Int): String = when (s) {
        SleepSessionRecord.STAGE_TYPE_AWAKE -> "AWAKE"
        SleepSessionRecord.STAGE_TYPE_SLEEPING -> "SLEEPING"
        SleepSessionRecord.STAGE_TYPE_OUT_OF_BED -> "OUT_OF_BED"
        SleepSessionRecord.STAGE_TYPE_LIGHT -> "LIGHT"
        SleepSessionRecord.STAGE_TYPE_DEEP -> "DEEP"
        SleepSessionRecord.STAGE_TYPE_REM -> "REM"
        SleepSessionRecord.STAGE_TYPE_AWAKE_IN_BED -> "AWAKE_IN_BED"
        else -> "UNKNOWN"
    }

    /** Monta o pacote. Na primeira vez lê 30 dias; depois, desde a última vez menos 3 dias (pega registros atrasados). */
    suspend fun montaPacote(ctx: Context, cfg: Config): JSONObject {
        val hc = HealthConnectClient.getOrCreate(ctx)
        val concedidas = hc.permissionController.getGrantedPermissions()
        val pode = { t: KClass<out Record> -> HealthPermission.getReadPermission(t) in concedidas }
        val fim = Instant.now()
        val ini = if (cfg.ultimaOk == 0L) fim.minus(Duration.ofDays(30)) else Instant.ofEpochMilli(cfg.ultimaOk).minus(Duration.ofDays(3))

        val p = JSONObject()
            .put("timestamp", iso(fim, null))
            .put("app_version", "dieta-e-treino-sync")
            .put("timezone", fuso.id)

        fun addArr(nome: String, arr: JSONArray) { if (arr.length() > 0) p.put(nome, arr) }

        if (pode(WeightRecord::class)) addArr("weight", JSONArray().apply {
            le(hc, WeightRecord::class, ini, fim).forEach { put(JSONObject().put("kilograms", it.weight.inKilograms).put("time", iso(it.time, it.zoneOffset)).put("metadata", meta(it))) }
        })
        if (pode(BodyFatRecord::class)) addArr("body_fat", JSONArray().apply {
            le(hc, BodyFatRecord::class, ini, fim).forEach { put(JSONObject().put("percentage", it.percentage.value).put("time", iso(it.time, it.zoneOffset)).put("metadata", meta(it))) }
        })
        if (pode(LeanBodyMassRecord::class)) addArr("lean_body_mass", JSONArray().apply {
            le(hc, LeanBodyMassRecord::class, ini, fim).forEach { put(JSONObject().put("kilograms", it.mass.inKilograms).put("time", iso(it.time, it.zoneOffset)).put("metadata", meta(it))) }
        })
        if (pode(BoneMassRecord::class)) addArr("bone_mass", JSONArray().apply {
            le(hc, BoneMassRecord::class, ini, fim).forEach { put(JSONObject().put("kilograms", it.mass.inKilograms).put("time", iso(it.time, it.zoneOffset)).put("metadata", meta(it))) }
        })
        if (pode(BodyWaterMassRecord::class)) addArr("body_water_mass", JSONArray().apply {
            le(hc, BodyWaterMassRecord::class, ini, fim).forEach { put(JSONObject().put("kilograms", it.mass.inKilograms).put("time", iso(it.time, it.zoneOffset)).put("metadata", meta(it))) }
        })
        if (pode(BasalMetabolicRateRecord::class)) addArr("basal_metabolic_rate", JSONArray().apply {
            le(hc, BasalMetabolicRateRecord::class, ini, fim).forEach { put(JSONObject().put("watts", it.basalMetabolicRate.inWatts).put("time", iso(it.time, it.zoneOffset)).put("metadata", meta(it))) }
        })
        if (pode(RestingHeartRateRecord::class)) addArr("resting_heart_rate", JSONArray().apply {
            le(hc, RestingHeartRateRecord::class, ini, fim).forEach { put(JSONObject().put("bpm", it.beatsPerMinute).put("time", iso(it.time, it.zoneOffset)).put("metadata", meta(it))) }
        })
        if (pode(SleepSessionRecord::class)) addArr("sleep", JSONArray().apply {
            le(hc, SleepSessionRecord::class, ini.minus(Duration.ofDays(1)), fim).forEach { s ->
                val st = JSONArray()
                s.stages.forEach { e -> st.put(JSONObject().put("stage", estagio(e.stage)).put("start_time", iso(e.startTime, s.startZoneOffset)).put("end_time", iso(e.endTime, s.endZoneOffset))) }
                put(JSONObject()
                    .put("session_end_time", iso(s.endTime, s.endZoneOffset))
                    .put("start_time", iso(s.startTime, s.startZoneOffset))
                    .put("duration_seconds", Duration.between(s.startTime, s.endTime).seconds)
                    .put("stages", st)
                    .put("metadata", meta(s)))
            }
        })
        // Passos: total por dia calculado pelo próprio Health Connect, sem contar em dobro celular + relógio.
        if (pode(StepsRecord::class)) {
            val diaIni = ini.atZone(fuso).toLocalDate()
            val diaFim = LocalDate.now(fuso).plusDays(1)
            val grupos = hc.aggregateGroupByPeriod(AggregateGroupByPeriodRequest(
                metrics = setOf(StepsRecord.COUNT_TOTAL),
                timeRangeFilter = TimeRangeFilter.between(diaIni.atStartOfDay(), diaFim.atStartOfDay()),
                timeRangeSlicer = Period.ofDays(1)
            ))
            addArr("steps", JSONArray().apply {
                grupos.forEach { g ->
                    val n = g.result[StepsRecord.COUNT_TOTAL] ?: return@forEach
                    val a = g.startTime.atZone(fuso).toInstant(); val b = g.endTime.atZone(fuso).toInstant()
                    put(JSONObject().put("count", n).put("start_time", iso(a, null)).put("end_time", iso(b, null)))
                }
            })
        }
        return p
    }

    private fun envia(cfg: Config, corpo: JSONObject): Pair<Int, String> {
        val c = URL(cfg.url).openConnection() as HttpURLConnection
        c.requestMethod = "POST"
        c.connectTimeout = 20000; c.readTimeout = 60000
        c.doOutput = true
        c.setRequestProperty("Content-Type", "application/json; charset=utf-8")
        c.setRequestProperty("x-api-key", cfg.chave)
        c.outputStream.use { it.write(corpo.toString().toByteArray(Charsets.UTF_8)) }
        val cod = c.responseCode
        val txt = (if (cod in 200..299) c.inputStream else c.errorStream)?.bufferedReader()?.use { it.readText() } ?: ""
        c.disconnect()
        return cod to txt
    }

    /** Faz tudo. Devolve uma frase para mostrar na tela. Lança exceção se falhar. */
    suspend fun sincroniza(ctx: Context): String = withContext(Dispatchers.IO) {
        val cfg = Config(ctx)
        if (!cfg.configurado) throw IllegalStateException("Falta configurar o endereço e a chave.")
        val inicio = System.currentTimeMillis()
        val pacote = montaPacote(ctx, cfg)
        val (cod, txt) = envia(cfg, pacote)
        if (cod !in 200..299) throw IllegalStateException("O app respondeu $cod: ${txt.take(200)}")
        cfg.ultimaOk = inicio
        val j = runCatching { JSONObject(txt) }.getOrNull()
        val n = j?.optInt("registros") ?: 0
        "Enviado: $n registro(s)."
    }
}
