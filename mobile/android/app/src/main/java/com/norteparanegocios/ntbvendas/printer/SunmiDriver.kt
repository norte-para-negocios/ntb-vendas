package com.norteparanegocios.ntbvendas.printer

import android.content.Context

// STUB mínimo — existe só pra `NtbPrinterPlugin` (Task 4) compilar e rotear
// corretamente ANTES da implementação de verdade do SDK Sunmi (Task 5).
// `isAvailable()` fixo em `false` faz `driverAtivo()` sempre cair no
// próximo candidato da lista (Bluetooth, também stub agora) e por fim no
// `PartnerDriverStub` — que é exatamente o comportamento esperado no
// emulador (fabricante "Google") no teste da Task 4. A Task 5 vai
// SUBSTITUIR o conteúdo inteiro deste arquivo pela integração real com o
// SDK da Sunmi (AIDL/Print Service), não só ajustar `isAvailable()`.
class SunmiDriver(private val context: Context) : PrinterDriver {
    override val nome = "sunmi"
    override fun isAvailable() = false
    override fun printText(texto: String): Result<Unit> =
        Result.failure(Exception("Driver Sunmi ainda não implementado (chega na Task 5)."))
}
