; 30/09/2026: a atualização pela 1.2.71 falhava sem aviso. O app fechava, o Windows pedia
; permissão e alguém reabria o app nesse meio-tempo. O instalador silencioso achava o
; app aberto e desistia. Agora fecha à força qualquer Norte Vendas aberto antes de instalar.
!macro customCheckAppRunning
  nsExec::Exec 'taskkill /F /T /IM "Norte Vendas.exe"'
  Pop $0
  Sleep 2000
!macroend
