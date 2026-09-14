package com.norteparanegocios.ntbvendas.printer

import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothSocket
import android.content.Context
import android.content.pm.PackageManager
import androidx.core.content.ContextCompat
import java.io.OutputStream
import java.util.UUID

// Fallback universal: QUALQUER impressora térmica Bluetooth (não-Sunmi,
// não integrada a operadora nenhuma) fala ESC/POS por uma porta serial
// (SPP) — este UUID é o padrão fixo do perfil SPP, não específico de
// marca nenhuma.
private val SPP_UUID: UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB")

// Substitui o STUB da Task 4 (que fixava isAvailable() em false pra
// NtbPrinterPlugin compilar/rotear antes desta implementação existir).
// Este driver reaproveita o mesmo `context: Context` já recebido no
// construtor desde a Task 4 — nenhum caminho novo de injeção de
// dependência foi criado.
class BluetoothEscPosDriver(private val context: Context) : PrinterDriver {
    override val nome = "bluetooth"

    private fun temPermissao(): Boolean =
        ContextCompat.checkSelfPermission(context, "android.permission.BLUETOOTH_CONNECT") == PackageManager.PERMISSION_GRANTED

    private fun dispositivoParaeado(): BluetoothDevice? {
        if (!temPermissao()) return null
        val adapter = BluetoothAdapter.getDefaultAdapter() ?: return null
        if (!adapter.isEnabled) return null
        // Heurística simples: primeira impressora pareada cujo nome
        // contenha "print" (a maioria dos fabricantes genéricos nomeia
        // assim — ex. "BlueTooth Printer", "POS-58"). Sem uma tela de
        // "escolher impressora pareada" ainda (fora de escopo desta
        // task), é o melhor palpite automático; a Task 8 registra a
        // limitação de UX disso.
        return adapter.bondedDevices?.firstOrNull {
            it.name?.contains("print", ignoreCase = true) == true
        }
    }

    // "Disponível" aqui significa "existe candidato pareado" — não abre
    // conexão de verdade só pra checar (isso é lento e pode falhar por
    // motivo transitório); a tentativa de conexão de fato acontece em
    // printText.
    override fun isAvailable(): Boolean = dispositivoParaeado() != null

    override fun printText(texto: String): Result<Unit> {
        val device = dispositivoParaeado()
            ?: return Result.failure(Exception("Nenhuma impressora Bluetooth pareada encontrada (nome precisa conter 'print')."))
        var socket: BluetoothSocket? = null
        return try {
            socket = device.createRfcommSocketToServiceRecord(SPP_UUID)
            BluetoothAdapter.getDefaultAdapter()?.cancelDiscovery()
            socket.connect()
            val bytes = buildEscPosBytesKotlin(texto)
            socket.outputStream.write(bytes)
            socket.outputStream.flush()
            Result.success(Unit)
        } catch (e: Exception) {
            Result.failure(e)
        } finally {
            try { socket?.close() } catch (_: Exception) {}
        }
    }
}

// Mesma lógica de lib/escpos.ts (Task 3), reimplementada em Kotlin porque
// este driver roda no processo nativo, sem acesso ao runtime JS. Manter
// as duas em sincronia manualmente é aceito aqui — são ~10 linhas cada.
private fun buildEscPosBytesKotlin(texto: String): ByteArray {
    val init = byteArrayOf(0x1b, 0x40)
    val corte = byteArrayOf(0x1d, 0x56, 0x01)
    val corpo = (texto + "\n\n\n").toByteArray(Charsets.UTF_8)
    return init + corpo + corte
}
