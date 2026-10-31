# Visual Kanban · app Android

Casca Android (WebView) que empacota o painel de `../static/`. O painel web no
Streamlit continua igual; o APK só adiciona o empacotamento, o salvamento de
Excel/CSV em `Downloads/Visual Kanban/` e o botão voltar do Android.

## Como o app funciona

- Os arquivos de `../static/` são copiados para `assets/www` durante o build
  (tarefa `syncWebAssets`).
- Eles são servidos por `WebViewAssetLoader` em
  `https://appassets.androidplatform.net/assets/www/index.html`, o que mantém
  `localStorage`, `fetch` e `CORS` iguais ao navegador.
- `static/js/native.js` detecta a ponte `AndroidBridge` e troca o download do
  navegador pela gravação via `MediaStore` (Android 10+) ou escrita direta em
  Downloads (Android 7–9, com permissão).
- O backend continua sendo o Google Sheets + Apps Script configurado no próprio
  painel.

## Versão

A versão do APK vem de `../static/js/config.js` (`versao`). Não edite à mão no
Gradle: altere o painel, faça o build e o `versionCode` será
`major*10000 + minor*100 + patch` (ex.: `1.2.6` → `10206`).

## Build local

Pré-requisitos: JDK 17, Android SDK (platform 35 e build-tools 35.0.0).

```powershell
cd visual_kanban/android
$env:JAVA_HOME = "C:\caminho\para\jdk-17"
$env:ANDROID_HOME = "C:\caminho\para\Android\Sdk"
.\gradlew.bat assembleRelease
```

O APK sai em `app/build/outputs/apk/release/app-release.apk`.

Para rodar no emulador/aparelho:

```powershell
.\gradlew.bat installDebug
```

## Assinatura (obrigatória para atualizar o app)

O APK de release precisa da **mesma chave** em todas as versões. Crie uma vez:

```powershell
keytool -genkeypair -v -keystore signing/visual-kanban.jks `
  -alias visualkanban -keyalg RSA -keysize 4096 -validity 10000 `
  -storepass SUA_SENHA -keypass SUA_SENHA `
  -dname "CN=Visual Kanban, O=Visual Kanban, C=BR"
```

Depois crie `android/keystore.properties` (fora do Git):

```properties
storeFile=signing/visual-kanban.jks
storePassword=SUA_SENHA
keyAlias=visualkanban
keyPassword=SUA_SENHA
```

**Guarde `signing/visual-kanban.jks` e as senhas.** Sem essa chave não é
possível atualizar um APK já instalado; seria preciso desinstalar e perder os
dados locais. `keystore.properties` e `signing/` estão no `.gitignore`.

Sem esse arquivo o build gera um APK **não assinado**, que não instala.

## Ícones

Os ícones adaptativos estão em `res/mipmap-anydpi-v26` e `res/mipmap-anydpi-v33`
(monochrome). Os PNGs legados são gerados por:

```powershell
python tools/gerar_icones.py
```

## GitHub Actions

`.github/workflows/android-apk.yml` monta o APK assinado quando os secrets
abaixo existem no repositório:

- `ANDROID_KEYSTORE_BASE64`: keystore `.jks` em base64
  (`[Convert]::ToBase64String([IO.File]::ReadAllBytes("signing/visual-kanban.jks"))`)
- `ANDROID_KEYSTORE_PASSWORD`
- `ANDROID_KEY_ALIAS`
- `ANDROID_KEY_PASSWORD`

Sem os secrets o workflow gera apenas um APK de debug, sem valor para
distribuição.
