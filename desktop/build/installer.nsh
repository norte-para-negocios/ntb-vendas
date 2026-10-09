; 30/09/2026: a atualização pela 1.2.71 falhava sem aviso porque o instalador silencioso achava o app aberto e desistia.
; Por isso o instalador fecha à força qualquer Norte Vendas aberto antes de instalar.
; 05/10/2026: SEM o /T. O electron-updater lança este instalador como FILHO do app e só depois manda o app fechar; com /T o
; taskkill matava a árvore inteira, inclusive este próprio instalador, quando o app ainda não tinha terminado de fechar
; (PC lento, motor de impressão). Resultado: app fechado, nada instalado, nada reabre, versão antiga ao abrir de novo.
; Sem /T matamos só os "Norte Vendas.exe" (principal e renderers); o instalador (outro nome de arquivo) sobrevive.
; 08/10/2026: rede local entre os computadores da loja (lan-peer.js, portas 47610-47615 TCP e 47611 UDP). Libera no
; firewall do Windows já na instalação; sem permissão de administrador o comando falha calado e o Windows pergunta na
; primeira vez ("Permitir acesso").
!macro customInstall
  nsExec::Exec 'netsh advfirewall firewall delete rule name="Norte Vendas - rede local"'
  Pop $0
  nsExec::Exec 'netsh advfirewall firewall add rule name="Norte Vendas - rede local" dir=in action=allow program="$INSTDIR\Norte Vendas.exe" enable=yes profile=any'
  Pop $0
!macroend

!macro customCheckAppRunning
  nsExec::Exec 'taskkill /F /IM "Norte Vendas.exe"'
  Pop $0
  Sleep 2000
!macroend
