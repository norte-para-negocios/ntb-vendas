package com.norteparanegocios.ntbvendas.printer

import android.os.Build
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

// Ponto único de decisão "qual impressora este aparelho tem": olha
// Build.MANUFACTURER (Sunmi sempre reporta "SUNMI" aqui, confirmado na
// documentação pública do SDK) e cai pro Bluetooth genérico como
// fallback universal — nunca falha em silêncio: se nenhum driver está
// disponível, `getStatus()` diz isso explicitamente ("unsupported"), a
// tela de configuração de impressora mostra essa string pro lojista em
// vez de simplesmente não imprimir sem explicação nenhuma.
@CapacitorPlugin(name = "NtbPrinter")
class NtbPrinterPlugin : Plugin() {

    private fun driverAtivo(): PrinterDriver {
        val fabricante = Build.MANUFACTURER.uppercase()
        val candidatos: List<PrinterDriver> = listOf(
            SunmiDriver(context),
            // Bluetooth genérico é sempre candidato, mas só "disponível"
            // se existir um dispositivo pareado — ver Task 6.
            BluetoothEscPosDriver(context),
        )
        // Primeiro que responder isAvailable()=true vence. Sunmi primeiro
        // na lista de propósito: um Sunmi também pode ter impressora
        // Bluetooth pareada por engano/teste, e a impressora EMBUTIDA é
        // sempre a certa nesse aparelho.
        return candidatos.firstOrNull { it.isAvailable() }
            ?: PartnerDriverStub(fabricante)
    }

    @PluginMethod
    fun getStatus(call: PluginCall) {
        val driver = driverAtivo()
        val result = JSObject()
        result.put("driver", driver.nome)
        result.put("manufacturer", Build.MANUFACTURER)
        result.put("available", driver.isAvailable())
        call.resolve(result)
    }

    @PluginMethod
    fun printText(call: PluginCall) {
        val texto = call.getString("text")
        if (texto == null) {
            call.reject("Parametro 'text' ausente.")
            return
        }
        val driver = driverAtivo()
        val resultado = driver.printText(texto)
        val json = JSObject()
        if (resultado.isSuccess) {
            json.put("success", true)
        } else {
            json.put("success", false)
            json.put("message", resultado.exceptionOrNull()?.message ?: "Falha desconhecida no driver ${driver.nome}.")
        }
        call.resolve(json)
    }
}
