package com.norteparanegocios.ntbvendas.printer

import android.content.Context
import android.os.Build
import com.sunmi.peripheral.printer.InnerPrinterCallback
import com.sunmi.peripheral.printer.InnerPrinterManager
import com.sunmi.peripheral.printer.SunmiPrinterService

// SDK público (Maven Central, sem cadastro/parceria — ver pesquisa de
// 2026-09-14 em docs/mobile-printer-drivers.md).
//
// Revisão 2026-09-14: existem modelos Sunmi SEM impressora térmica
// embutida (tablets, M2 Max, V2s) — checar só Build.MANUFACTURER fazia
// esses aparelhos "escolherem" o driver Sunmi e falharem silenciosamente
// na hora de imprimir (nenhum outro driver era tentado depois). Decompilei
// o .aar de com.sunmi:printerlibrary:1.0.18 (o mesmo declarado em
// build.gradle, cache local em
// ~/.gradle/caches/modules-2/files-2.1/com.sunmi/printerlibrary/1.0.18/)
// e confirmei via javap que a interface SunmiPrinterService expõe
// `updatePrinterState(): Int`. Pela documentação oficial da Sunmi
// (Inbuilt Printer Developer Documentation), o código de retorno 505
// significa "Printer not detected" — ou seja, dá pra distinguir "tem
// impressora mas com erro" de "aparelho não tem impressora nenhuma".
// Não tenho como confirmar esse código contra hardware real nesta sessão
// (nenhum Sunmi físico disponível), então mantenho essa checagem como
// melhor esforço documentado — qualquer divergência observada em campo
// deve ser registrada em docs/mobile-printer-drivers.md.
class SunmiDriver(private val context: Context) : PrinterDriver {
    override val nome = "sunmi"

    // Código de retorno de updatePrinterState() que a doc oficial da Sunmi
    // define como "impressora não detectada" (aparelho sem impressora
    // embutida, ex: tablets Sunmi, M2 Max, V2s).
    private val PRINTER_NOT_DETECTED = 505

    override fun isAvailable(): Boolean {
        // Filtro rápido: sem ser um aparelho Sunmi, nem tenta bindar o
        // serviço (evita esperar timeout de bind em toda maquininha
        // não-Sunmi que rodar o app).
        if (!Build.MANUFACTURER.equals("SUNMI", ignoreCase = true)) return false

        // Bind síncrono (com timeout curto) só para checar presença real
        // da impressora via updatePrinterState(). É o mesmo padrão usado em
        // printText(), mas com timeout mais curto (1.5s) porque isAvailable()
        // roda na escolha do driver, não queremos travar a inicialização.
        var printerService: SunmiPrinterService? = null
        val latch = java.util.concurrent.CountDownLatch(1)
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
            if (!conectou) return false
            if (!latch.await(1500, java.util.concurrent.TimeUnit.MILLISECONDS)) return false
            val servico = printerService ?: return false
            // Qualquer código diferente de "não detectada" é tratado como
            // "tem impressora" (mesmo estados de erro como "sem papel" ou
            // "tampa aberta" indicam que existe hardware de impressão —
            // só 505 indica ausência do hardware em si).
            servico.updatePrinterState() != PRINTER_NOT_DETECTED
        } catch (e: Exception) {
            // Falha ao consultar o estado: não temos garantia de que há
            // impressora, então não afirmamos disponibilidade (fail-safe —
            // deixa outro driver candidato assumir em vez de imprimir "no
            // vazio").
            false
        } finally {
            try { InnerPrinterManager.getInstance().unBindService(context, callback) } catch (_: Exception) {}
        }
    }

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
