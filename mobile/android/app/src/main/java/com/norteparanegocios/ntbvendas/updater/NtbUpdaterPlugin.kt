package com.norteparanegocios.ntbvendas.updater

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import kotlin.concurrent.thread

// Atualização automática do APK (o Android não tem updater embutido fora da
// Play Store): o app lê um latest.json publicado no servidor de atualizações,
// compara o versionCode com o instalado, baixa o APK e abre o instalador do
// sistema. O Android SEMPRE pede uma confirmação do usuário pra instalar —
// não existe instalação 100% silenciosa sem ser o app de administração do
// aparelho. A atualização só entra se o APK novo estiver assinado com a MESMA
// chave do instalado.
@CapacitorPlugin(name = "NtbUpdater")
class NtbUpdaterPlugin : Plugin() {

    private fun versionCodeInstalado(): Long {
        val info = context.packageManager.getPackageInfo(context.packageName, 0)
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) info.longVersionCode else @Suppress("DEPRECATION") info.versionCode.toLong()
    }

    @PluginMethod
    fun getVersion(call: PluginCall) {
        val info = context.packageManager.getPackageInfo(context.packageName, 0)
        val r = JSObject()
        r.put("versionCode", versionCodeInstalado())
        r.put("versionName", info.versionName ?: "")
        call.resolve(r)
    }

    // Consulta o latest.json. Falha de rede NÃO é erro pro usuário: resolve
    // com available=false e o motivo em `erro`, o app tenta de novo depois.
    @PluginMethod
    fun checkForUpdate(call: PluginCall) {
        val manifestUrl = call.getString("manifestUrl")
        if (manifestUrl.isNullOrBlank()) { call.reject("manifestUrl ausente."); return }
        thread {
            val r = JSObject()
            try {
                val c = URL(manifestUrl).openConnection() as HttpURLConnection
                c.connectTimeout = 10000; c.readTimeout = 10000
                c.setRequestProperty("Cache-Control", "no-cache")
                val corpo = c.inputStream.bufferedReader().use { it.readText() }
                c.disconnect()
                val j = JSONObject(corpo)
                val remoto = j.getLong("versionCode")
                r.put("available", remoto > versionCodeInstalado())
                r.put("versionCode", remoto)
                r.put("versionName", j.optString("versionName", ""))
                r.put("url", j.getString("url"))
            } catch (e: Exception) {
                r.put("available", false)
                r.put("erro", e.message ?: "falha ao consultar atualização")
            }
            call.resolve(r)
        }
    }

    @PluginMethod
    fun downloadAndInstall(call: PluginCall) {
        val apkUrl = call.getString("url")
        if (apkUrl.isNullOrBlank()) { call.reject("url ausente."); return }

        // Android 8+: instalar APK de fora da loja exige liberar "instalar apps
        // desconhecidos" pra ESTE app (uma vez). Abre a tela certa e avisa.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !context.packageManager.canRequestPackageInstalls()) {
            val i = Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${context.packageName}"))
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            context.startActivity(i)
            val r = JSObject(); r.put("status", "permissao"); call.resolve(r)
            return
        }

        thread {
            try {
                val pasta = File(context.cacheDir, "updates").apply { mkdirs() }
                pasta.listFiles()?.forEach { it.delete() }
                val destino = File(pasta, "norte-vendas.apk")
                val c = URL(apkUrl).openConnection() as HttpURLConnection
                c.connectTimeout = 15000; c.readTimeout = 30000
                if (c.responseCode != 200) throw Exception("servidor respondeu ${c.responseCode}")
                c.inputStream.use { entrada -> destino.outputStream().use { saida -> entrada.copyTo(saida) } }
                c.disconnect()
                if (destino.length() < 1_000_000) throw Exception("arquivo baixado incompleto")

                val uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", destino)
                val instalar = Intent(Intent.ACTION_VIEW).apply {
                    setDataAndType(uri, "application/vnd.android.package-archive")
                    addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
                }
                context.startActivity(instalar)
                val r = JSObject(); r.put("status", "instalador-aberto"); call.resolve(r)
            } catch (e: Exception) {
                call.reject(e.message ?: "falha ao baixar a atualização")
            }
        }
    }
}
