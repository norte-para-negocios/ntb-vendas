@echo off
REM Faz o ntb-print-agent.exe abrir sozinho toda vez que o Windows ligar
REM (ou o usuario der login), sem precisar de ninguem lembrar de abrir na mao.
REM Achado ao vivo (2026-08-28/29): computador reinicia (falta de luz,
REM Windows Update) e a impressao para de funcionar ate alguem notar e
REM abrir o agente de novo manualmente. Este script cria uma tarefa
REM agendada do Windows que resolve isso.
setlocal
set SCRIPT_DIR=%~dp0
schtasks /create /tn "NTB Print Agent" /tr "\"%SCRIPT_DIR%ntb-print-agent.exe\"" /sc onlogon /rl highest /f
if %errorlevel% equ 0 (
  echo.
  echo Pronto! O agente agora abre sozinho sempre que o Windows ligar.
  echo Para desativar isso no futuro: pesquise "Agendador de Tarefas" no
  echo Windows e apague a tarefa "NTB Print Agent".
) else (
  echo.
  echo Deu erro. Tente clicar com o botao direito neste arquivo e
  echo escolher "Executar como administrador".
)
pause
