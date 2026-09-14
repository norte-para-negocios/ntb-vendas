package com.norteparanegocios.ntbvendas.printer

// Todo driver de impressora (Sunmi, Bluetooth genérico, ou o SDK de uma
// operadora quando o cadastro de parceiro sair — ver PartnerDriverStub)
// implementa isto. `isAvailable()` nunca deve lançar exceção — sempre
// `false` em caso de dúvida, porque é chamado no boot do app pra decidir
// qual driver mostrar como "impressora deste aparelho".
interface PrinterDriver {
    val nome: String
    fun isAvailable(): Boolean
    fun printText(texto: String): Result<Unit>
}
