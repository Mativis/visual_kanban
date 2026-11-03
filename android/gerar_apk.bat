@echo off
rem Atalho para gerar o APK. Aceita os mesmos parametros de gerar_apk.ps1.
rem Duplo clique: compila, assina e publica em ..\dist\
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0gerar_apk.ps1" %*
set "CODIGO=%ERRORLEVEL%"
if "%~1"=="" pause
exit /b %CODIGO%
