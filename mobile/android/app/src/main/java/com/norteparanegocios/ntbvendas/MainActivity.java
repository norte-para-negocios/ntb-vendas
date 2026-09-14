package com.norteparanegocios.ntbvendas;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
import com.norteparanegocios.ntbvendas.printer.NtbPrinterPlugin;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // registerPlugin precisa rodar antes de super.onCreate — é lá que
        // a Bridge do Capacitor termina de inicializar e carrega a webview.
        registerPlugin(NtbPrinterPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
