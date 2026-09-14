package com.norteparanegocios.ntbvendas.printer

import android.content.Context
import android.os.Build
import com.sunmi.peripheral.printer.InnerPrinterCallback
import com.sunmi.peripheral.printer.InnerPrinterManager
import com.sunmi.peripheral.printer.SunmiPrinterService

// SDK público (Maven Central, sem cadastro/parceria — ver pesquisa de
// 2026-09-14 em docs/mobile-printer-drivers.md). `isAvailable()` só
// confirma o FABRICANTE via Build.MANUFACTURER: o bind de verdade com o
// serviço da impressora (via AIDL, InnerPrinterManager) é assíncrono e só
// é tentado dentro de printText — não faz sentido manter uma conexão
// aberta o tempo todo só pra responder "disponível?" no boot do app.
class SunmiDriver(private val context: Context) : PrinterDriver {
    override val nome = "sunmi"

    override fun isAvailable(): Boolean = Build.MANUFACTURER.equals("SUNMI", ignoreCase = true)

    override fun printText(texto: String): Result<Unit> {
        var printerService: SunmiPrinterService? = null
        val latch = java.util.concurrent.CountDownLatch(1)
        var erro: Exception? = null

        val callback = object : InnerPrinterCallback() {
            override fun onConnected(service: SunmiPrinterService) {
                printerService = service
                latch.countDown()
            }
            override fun onDisconnected() {
                latch.countDown()
            }
        }

        return try {
            val conectou = InnerPrinterManager.getInstance().bindService(context, callback)
            if (!conectou) return Result.failure(Exception("Nao foi possivel iniciar a conexao com o servico de impressao Sunmi."))
            // Timeout de 3s: o bind AIDL costuma resolver em milissegundos
            // num Sunmi de verdade; 3s é folga generosa sem travar a UI
            // pra sempre se o serviço do sistema estiver quebrado.
            if (!latch.await(3, java.util.concurrent.TimeUnit.SECONDS)) {
                return Result.failure(Exception("Timeout esperando o servico de impressao Sunmi responder."))
            }
            val servico = printerService ?: return Result.failure(Exception("Servico de impressao Sunmi nao conectou."))
            servico.printText(texto + "\n\n\n", null)
            servico.cutPaper(null)
            Result.success(Unit)
        } catch (e: Exception) {
            erro = e
            Result.failure(e)
        } finally {
            try { InnerPrinterManager.getInstance().unBindService(context, callback) } catch (_: Exception) {}
        }
    }
}
