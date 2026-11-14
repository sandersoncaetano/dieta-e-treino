package app.dietaetreino.sync

import android.content.Context
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.TimeUnit

/** Sincroniza sozinho a cada hora, quando houver internet. */
class SyncWorker(ctx: Context, params: WorkerParameters) : CoroutineWorker(ctx, params) {
    override suspend fun doWork(): Result {
        val cfg = Config(applicationContext)
        if (!cfg.configurado) return Result.success()
        val hora = SimpleDateFormat("dd/MM HH:mm", Locale("pt", "BR")).format(Date())
        return try {
            val msg = Sincronizador.sincroniza(applicationContext)
            cfg.ultimoStatus = "$hora (automático): $msg"
            Result.success()
        } catch (e: Exception) {
            cfg.ultimoStatus = "$hora (automático): falhou. ${e.message ?: e.javaClass.simpleName}"
            if (runAttemptCount < 2) Result.retry() else Result.failure()
        }
    }

    companion object {
        fun agenda(ctx: Context) {
            val req = PeriodicWorkRequestBuilder<SyncWorker>(1, TimeUnit.HOURS)
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .build()
            WorkManager.getInstance(ctx).enqueueUniquePeriodicWork("sync", ExistingPeriodicWorkPolicy.KEEP, req)
        }
    }
}
