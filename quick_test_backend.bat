@echo off
REM Script para ejecutar una prueba rápida del backend
SETLOCAL ENABLEDELAYEDEXPANSION

REM Moverse al directorio del backend
pushd "%~dp0backend"
IF ERRORLEVEL 1 (
    echo No se pudo acceder al directorio backend.
    exit /b 1
)

REM Instalar dependencias (solo la primera vez tardará unos segundos)
echo Instalando dependencias...
call npm install
IF ERRORLEVEL 1 (
    echo Error al instalar dependencias.
    popd
    exit /b 1
)

REM Ejecutar el script de pruebas por defecto
echo Ejecutando pruebas...
call npm test
IF ERRORLEVEL 1 (
    echo Las pruebas devolvieron un error.
    popd
    exit /b 1
)

REM Volver al directorio original
popd

echo Prueba rapida finalizada correctamente.
EXIT /B 0
