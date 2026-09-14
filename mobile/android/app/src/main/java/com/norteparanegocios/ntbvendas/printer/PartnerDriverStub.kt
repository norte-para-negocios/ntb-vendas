package com.norteparanegocios.ntbvendas.printer

// Existe pra NUNCA deixar `driverAtivo()` sem retorno. Sempre reporta
// indisponível, com o nome do fabricante real no motivo — é isso que
// aparece pro lojista quando o aparelho é uma maquininha de operadora
// (Stone/PagBank/Cielo/Getnet) cujo SDK ainda não foi integrado (exige
// cadastro de parceiro, ver docs/mobile-printer-drivers.md).
class PartnerDriverStub(private val fabricante: String) : PrinterDriver {
    override val nome = "unsupported"
    override fun isAvailable() = false
    override fun printText(texto: String): Result<Unit> =
        Result.failure(Exception("Impressora deste aparelho ($fabricante) ainda não tem driver configurado. Ver docs/mobile-printer-drivers.md."))
}
