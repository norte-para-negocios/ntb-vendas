package com.norteparanegocios.ntbvendas.printer

import android.content.Context

// STUB mínimo — mesmo motivo do SunmiDriver.kt: existe só pra
// `NtbPrinterPlugin` (Task 4) compilar e rotear corretamente ANTES da
// implementação de verdade do Bluetooth ESC/POS genérico (Task 6, que usa
// o codificador puro já existente em `lib/escpos.ts` do lado web/desktop
// como referência de protocolo). `isAvailable()` fixo em `false` aqui faz
// `driverAtivo()` cair no `PartnerDriverStub` — comportamento esperado no
// emulador, que não tem nenhum dispositivo Bluetooth pareado de verdade.
// A Task 6 vai SUBSTITUIR o conteúdo inteiro deste arquivo pela descoberta
// de dispositivo pareado + conexão RFCOMM + envio dos comandos ESC/POS.
class BluetoothEscPosDriver(private val context: Context) : PrinterDriver {
    override val nome = "bluetooth"
    override fun isAvailable() = false
    override fun printText(texto: String): Result<Unit> =
        Result.failure(Exception("Driver Bluetooth ainda não implementado (chega na Task 6)."))
}
