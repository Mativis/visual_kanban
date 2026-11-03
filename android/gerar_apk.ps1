<#
.SYNOPSIS
    Gera o APK assinado do Visual Kanban e publica em dist/.

.DESCRIPTION
    Le a versao de static/js/config.js, valida os assets (?v=), confere a
    chave de assinatura, executa o Gradle (assembleRelease), valida a
    assinatura e a versao do APK, copia para dist/VisualKanban-<versao>.apk
    e grava o .sha256 correspondente.

    Opcionalmente gera tambem o pacote OTA com tools/gerar_ota.py.

.PARAMETER Clean
    Executa "clean" antes do build (mais lento, garante saida do zero).

.PARAMETER Ota
    Gera tambem o pacote OTA (ota/www-<versao>.zip + ota/manifest.json).

.PARAMETER Notas
    Texto de novidades gravado no manifesto OTA (usado com -Ota).

.PARAMETER PermitirNaoAssinado
    Permite terminar mesmo sem keystore.properties/assinatura. O APK gerado
    NAO instala nem atualiza um app ja instalado.

.EXAMPLE
    .\gerar_apk.ps1

.EXAMPLE
    .\gerar_apk.ps1 -Clean

.EXAMPLE
    .\gerar_apk.ps1 -Ota -Notas "Correcoes no quadro e novo filtro"
#>
[CmdletBinding()]
param(
    [switch]$Clean,
    [switch]$Ota,
    [string]$Notas = "",
    [switch]$PermitirNaoAssinado
)

$ErrorActionPreference = "Stop"

$AndroidDir = $PSScriptRoot
$VisualKanbanDir = Split-Path $AndroidDir -Parent
$StaticDir = Join-Path $VisualKanbanDir "static"
$DistDir = Join-Path $VisualKanbanDir "dist"
$ConfigPath = Join-Path $StaticDir "js\config.js"
$KeystorePropsPath = Join-Path $AndroidDir "keystore.properties"
$Gradlew = Join-Path $AndroidDir "gradlew.bat"
$OtaManifestPath = Join-Path $VisualKanbanDir "ota\manifest.json"

function Write-Etapa([string]$Texto) {
    Write-Host ""
    Write-Host "==> $Texto" -ForegroundColor Cyan
}

function Write-Ok([string]$Texto) {
    Write-Host "    OK  $Texto" -ForegroundColor Green
}

function Write-Aviso([string]$Texto) {
    Write-Host "    !   $Texto" -ForegroundColor Yellow
}

function Fail([string]$Texto) {
    Write-Host ""
    Write-Host "ERRO: $Texto" -ForegroundColor Red
    exit 1
}

function Read-Properties([string]$Caminho) {
    $mapa = @{}
    foreach ($linha in [IO.File]::ReadAllLines($Caminho)) {
        $linha = $linha.Trim()
        if (-not $linha -or $linha.StartsWith("#") -or $linha.StartsWith("!")) { continue }
        $pos = $linha.IndexOf("=")
        if ($pos -lt 1) { continue }
        $chave = $linha.Substring(0, $pos).Trim()
        $valor = $linha.Substring($pos + 1).Trim()
        $valor = $valor -replace '\\\\', '\'
        $valor = $valor -replace '\\:', ':'
        $valor = $valor -replace '\\=', '='
        $valor = $valor -replace '\\#', '#'
        $valor = $valor -replace '\\!', '!'
        $mapa[$chave] = $valor
    }
    return $mapa
}

if (-not (Test-Path -LiteralPath $Gradlew)) {
    Fail "gradlew.bat nao encontrado em $AndroidDir"
}

# ---------------------------------------------------------------- ambiente
Write-Etapa "Verificando o ambiente de build"

$propriedades = @{}
$localProps = Join-Path $AndroidDir "local.properties"
if (Test-Path -LiteralPath $localProps) {
    $propriedades = Read-Properties $localProps
}

$candidatosJdk = @()
if ($propriedades.ContainsKey("jdk.dir")) { $candidatosJdk += $propriedades["jdk.dir"] }
if ($env:JAVA_HOME) { $candidatosJdk += $env:JAVA_HOME }

$jdkDir = $null
foreach ($candidato in $candidatosJdk) {
    $caminho = [Environment]::ExpandEnvironmentVariables($candidato)
    if (Test-Path -LiteralPath (Join-Path $caminho "bin\java.exe")) {
        $jdkDir = $caminho
        break
    }
}
if (-not $jdkDir) {
    Fail "JDK 17 nao encontrado. Defina jdk.dir em android/local.properties ou a variavel JAVA_HOME."
}

$candidatosSdk = @()
if ($propriedades.ContainsKey("sdk.dir")) { $candidatosSdk += $propriedades["sdk.dir"] }
if ($env:ANDROID_HOME) { $candidatosSdk += $env:ANDROID_HOME }
if ($env:ANDROID_SDK_ROOT) { $candidatosSdk += $env:ANDROID_SDK_ROOT }

$sdkDir = $null
foreach ($candidato in $candidatosSdk) {
    $caminho = [Environment]::ExpandEnvironmentVariables($candidato)
    if ((Test-Path -LiteralPath (Join-Path $caminho "build-tools")) -and
        (Test-Path -LiteralPath (Join-Path $caminho "platforms"))) {
        $sdkDir = $caminho
        break
    }
}
if (-not $sdkDir) {
    Fail "Android SDK nao encontrado. Defina sdk.dir em android/local.properties ou ANDROID_HOME."
}

$buildTools = Get-ChildItem -LiteralPath (Join-Path $sdkDir "build-tools") -Directory -ErrorAction SilentlyContinue |
    Sort-Object { try { [version]$_.Name } catch { [version]"0.0" } } -Descending |
    Select-Object -First 1
if (-not $buildTools) {
    Fail "Nenhuma versao de build-tools encontrada em $sdkDir\build-tools"
}

Write-Ok "JDK: $jdkDir"
Write-Ok "SDK: $sdkDir (build-tools $($buildTools.Name))"

# Deixa o JDK disponivel tambem para apksigner/aapt2 e para o Gradle.
$env:JAVA_HOME = $jdkDir
$env:ANDROID_HOME = $sdkDir
$env:ANDROID_SDK_ROOT = $sdkDir
$env:PATH = (Join-Path $jdkDir "bin") + ";" + $env:PATH

# ----------------------------------------------------------------- versao
Write-Etapa "Lendo a versao do painel"

if (-not (Test-Path -LiteralPath $ConfigPath)) {
    Fail "Arquivo nao encontrado: $ConfigPath"
}

$configTexto = [IO.File]::ReadAllText($ConfigPath, [Text.Encoding]::UTF8)
$achadoVersao = [regex]::Match($configTexto, 'versao\s*:\s*"([^"]+)"')
if (-not $achadoVersao.Success) {
    Fail "Nao encontrei 'versao' em static/js/config.js"
}
$versao = $achadoVersao.Groups[1].Value.Trim()
if ($versao -notmatch '^[0-9A-Za-z][0-9A-Za-z._-]{0,31}$') {
    Fail "Versao invalida em static/js/config.js: '$versao'"
}

$partes = @($versao -split '\.')
$numeros = @()
for ($i = 0; $i -lt 3; $i++) {
    $digitos = ""
    if ($i -lt $partes.Count) { $digitos = ($partes[$i] -replace '\D', '') }
    if (-not $digitos) { $digitos = "0" }
    $numeros += [int]$digitos
}
$codigoVersao = $numeros[0] * 10000 + $numeros[1] * 100 + $numeros[2]

foreach ($html in @("app.html", "index.html")) {
    $caminhoHtml = Join-Path $StaticDir $html
    if (-not (Test-Path -LiteralPath $caminhoHtml)) {
        Fail "Arquivo nao encontrado: static/$html"
    }
    $textoHtml = [IO.File]::ReadAllText($caminhoHtml, [Text.Encoding]::UTF8)
    if (-not $textoHtml.Contains("?v=$versao")) {
        Fail "static/$html nao referencia os assets com ?v=$versao. Atualize o cache-busting antes do build."
    }
}

Write-Ok "Versao: $versao (versionCode $codigoVersao)"

# -------------------------------------------------------------- assinatura
Write-Etapa "Verificando a chave de assinatura"

$assinado = $false
if (Test-Path -LiteralPath $KeystorePropsPath) {
    $propriedadesChave = Read-Properties $KeystorePropsPath
    if (-not $propriedadesChave.ContainsKey("storeFile")) {
        Fail "keystore.properties existe, mas nao define storeFile."
    }
    $storeFile = $propriedadesChave["storeFile"]
    if ([IO.Path]::IsPathRooted($storeFile)) {
        $keystorePath = $storeFile
    } else {
        $keystorePath = Join-Path $AndroidDir $storeFile
    }
    if (-not (Test-Path -LiteralPath $keystorePath)) {
        Fail "Keystore nao encontrado: $keystorePath"
    }
    $assinado = $true
    Write-Ok "Keystore: $keystorePath"
} elseif ($PermitirNaoAssinado) {
    Write-Aviso "keystore.properties ausente: o APK sera gerado SEM assinatura e nao podera ser instalado/atualizado."
} else {
    Fail "keystore.properties nao encontrado. Crie a chave de assinatura (veja android/README.md) ou use -PermitirNaoAssinado."
}

Write-Etapa "Conferindo a chave do APK publicado"

$apksigner = Join-Path $buildTools.FullName "apksigner.bat"
$certificadoReferencia = $null
$apkAnteriores = @(
    Get-ChildItem -LiteralPath $DistDir -Filter "VisualKanban-*.apk" -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending
)
if ((Test-Path -LiteralPath $apksigner) -and $apkAnteriores.Count -gt 0) {
    $saidaReferencia = & $apksigner verify --print-certs $apkAnteriores[0].FullName 2>&1
    if ($LASTEXITCODE -eq 0) {
        $achadoReferencia = [regex]::Match(
            ($saidaReferencia | Out-String),
            "certificate SHA-256 digest:\s*([0-9a-fA-F]+)"
        )
        if ($achadoReferencia.Success) {
            $certificadoReferencia = $achadoReferencia.Groups[1].Value.ToLowerInvariant()
            Write-Ok "APK anterior: $($apkAnteriores[0].Name)"
            Write-Ok "Certificado: $certificadoReferencia"
        } else {
            Write-Aviso "Nao consegui ler o certificado de $($apkAnteriores[0].Name)."
        }
    } else {
        Write-Aviso "O APK anterior nao tem assinatura valida; nao sera usado como referencia."
    }
} else {
    Write-Aviso "Nenhum APK anterior em dist/; pulando comparacao de chave."
}

# -------------------------------------------------------------------- OTA
if ($Ota) {
    Write-Etapa "Gerando pacote OTA $versao"
    $python = Get-Command python -ErrorAction SilentlyContinue
    if (-not $python) {
        Fail "Python nao encontrado no PATH. Ele e necessario apenas para -Ota."
    }
    $argsOta = @((Join-Path $AndroidDir "tools\gerar_ota.py"))
    if ($Notas) { $argsOta += @("--notas", $Notas) }
    & $python.Source @argsOta
    if ($LASTEXITCODE -ne 0) {
        Fail "Falha ao gerar o pacote OTA."
    }
    Write-Ok "Pacote OTA gerado em ota/"
} elseif (Test-Path -LiteralPath $OtaManifestPath) {
    try {
        $manifestoOta = [IO.File]::ReadAllText($OtaManifestPath, [Text.Encoding]::UTF8) | ConvertFrom-Json
        if ($manifestoOta.versao -eq $versao) {
            Write-Ok "Manifesto OTA sincronizado ($versao)."
        } else {
            Write-Aviso "Manifesto OTA esta em $($manifestoOta.versao) e o painel em $versao. Use -Ota para atualizar."
        }
    } catch {
        Write-Aviso "Nao consegui ler o manifesto OTA: $($_.Exception.Message)"
    }
}

# ------------------------------------------------------------------ build
Write-Etapa "Compilando o APK (assembleRelease)"

$gradleArgs = @()
if ($Clean) { $gradleArgs += "clean" }
$gradleArgs += @("assembleRelease", "--console=plain")

Push-Location -LiteralPath $AndroidDir
try {
    & $Gradlew @gradleArgs
    $codigoBuild = $LASTEXITCODE
} finally {
    Pop-Location
}
if ($codigoBuild -ne 0) {
    Fail "O Gradle falhou (codigo $codigoBuild). Veja o log acima."
}

# -------------------------------------------------------------- validacoes
Write-Etapa "Validando o APK gerado"

$apkReleaseDir = Join-Path $AndroidDir "app\build\outputs\apk\release"
$apkSaida = Get-Item -LiteralPath (Join-Path $apkReleaseDir "app-release.apk") -ErrorAction SilentlyContinue
if (-not $apkSaida) {
    $apkSaida = Get-ChildItem -LiteralPath $apkReleaseDir `
        -Filter "*.apk" -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1
}
if (-not $apkSaida) {
    Fail "Nenhum APK encontrado em app/build/outputs/apk/release/"
}

if (Test-Path -LiteralPath $apksigner) {
    $saidaAssinatura = & $apksigner verify --print-certs $apkSaida.FullName 2>&1
    if ($LASTEXITCODE -ne 0) {
        if ($assinado) {
            $detalhe = ($saidaAssinatura | Out-String).Trim()
            Fail "O APK nao esta assinado corretamente.`n$detalhe"
        }
        Write-Aviso "APK sem assinatura valida (permitido por -PermitirNaoAssinado)."
    } else {
        Write-Ok "Assinatura valida."
        $saidaAssinatura |
            Where-Object { "$_" -match "SHA-256" } |
            ForEach-Object { Write-Host "        $_" }

        $achadoCertificadoNovo = [regex]::Match(
            ($saidaAssinatura | Out-String),
            "certificate SHA-256 digest:\s*([0-9a-fA-F]+)"
        )
        if ($achadoCertificadoNovo.Success) {
            $certificadoNovo = $achadoCertificadoNovo.Groups[1].Value.ToLowerInvariant()
            if ($certificadoReferencia -and $certificadoNovo -ne $certificadoReferencia) {
                Fail ("A chave de assinatura mudou em relacao ao APK publicado.`n" +
                    "  anterior: $certificadoReferencia`n" +
                    "  atual:    $certificadoNovo`n" +
                    "Um APK com outra chave nao atualiza o app instalado. Use a mesma keystore.")
            }
            if ($certificadoReferencia) {
                Write-Ok "Chave compativel com o APK publicado."
            }
        }
    }
} else {
    Write-Aviso "apksigner nao encontrado em build-tools; assinatura nao verificada."
}

$aapt2 = Join-Path $buildTools.FullName "aapt2.exe"
if (Test-Path -LiteralPath $aapt2) {
    $badging = & $aapt2 dump badging $apkSaida.FullName 2>&1
    $linhaPacote = $badging | Where-Object { "$_" -match "^package:" } | Select-Object -First 1
    if ($linhaPacote) {
        $achadoCodigo = [regex]::Match($linhaPacote, "versionCode='([^']+)'")
        $achadoNome = [regex]::Match($linhaPacote, "versionName='([^']+)'")
        if ($achadoNome.Success -and $achadoNome.Groups[1].Value -ne $versao) {
            Fail "O APK foi gerado com versao $($achadoNome.Groups[1].Value), esperado $versao."
        }
        if ($achadoCodigo.Success -and [int]$achadoCodigo.Groups[1].Value -ne $codigoVersao) {
            Fail "O APK foi gerado com versionCode $($achadoCodigo.Groups[1].Value), esperado $codigoVersao."
        }
        Write-Ok "Pacote e versao conferem: $versao (versionCode $codigoVersao)."
    }
}

# --------------------------------------------------------------- publicacao
Write-Etapa "Publicando em dist/"

New-Item -ItemType Directory -Force -Path $DistDir | Out-Null
$nomeDist = "VisualKanban-$versao.apk"
$destino = Join-Path $DistDir $nomeDist
Copy-Item -LiteralPath $apkSaida.FullName -Destination $destino -Force

$hash = (Get-FileHash -LiteralPath $destino -Algorithm SHA256).Hash.ToLowerInvariant()
$arquivoHash = "$destino.sha256"
$conteudoHash = "$hash  $nomeDist`r`n"
[IO.File]::WriteAllText($arquivoHash, $conteudoHash, (New-Object System.Text.UTF8Encoding($false)))

$tamanhoMb = [math]::Round((Get-Item -LiteralPath $destino).Length / 1MB, 2)
Write-Ok "$destino ($tamanhoMb MB)"
Write-Ok "$arquivoHash"

Write-Host ""
Write-Host "SHA-256: $hash" -ForegroundColor Green
Write-Host ""
Write-Host "APK atualizado pronto para distribuicao." -ForegroundColor Green
Write-Host "Commit sugerido:" -ForegroundColor Gray
Write-Host "    git -C visual_kanban add dist/ android" -ForegroundColor Gray
Write-Host "    git -C visual_kanban commit -m 'Publica APK $versao'" -ForegroundColor Gray

exit 0
