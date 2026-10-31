package br.com.visualkanban.app;

import android.app.Activity;
import android.content.ContentValues;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.media.MediaScannerConnection;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.util.Log;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.ConsoleMessage;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.ProgressBar;
import android.widget.Toast;

import androidx.webkit.WebViewAssetLoader;

import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.util.concurrent.atomic.AtomicReference;

/**
 * Casca Android do Visual Kanban.
 *
 * O painel continua sendo o mesmo HTML/CSS/JS de `static/`, empacotado em
 * `assets/www` e servido em https://appassets.androidplatform.net (WebViewAssetLoader),
 * o que mantém localStorage, fetch e CORS funcionando como no navegador.
 */
public class MainActivity extends Activity {

    private static final String TAG = "VisualKanban";
    private static final String HOST = "appassets.androidplatform.net";
    private static final String URL_INICIAL = "https://" + HOST + "/assets/www/index.html";
    private static final String PASTA_DOWNLOADS = "Visual Kanban";
    private static final int PEDIDO_PERMISSAO_ARMAZENAMENTO = 41;

    private WebView webView;
    private ProgressBar carregando;
    private WebViewAssetLoader assetLoader;
    private final AtomicReference<String[]> salvamentoPendente = new AtomicReference<>();

    @Override
    protected void onCreate(Bundle estadoSalvo) {
        super.onCreate(estadoSalvo);

        assetLoader = new WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();

        FrameLayout raiz = new FrameLayout(this);
        raiz.setBackgroundColor(Color.parseColor("#0a1020"));

        webView = new WebView(this);
        webView.setBackgroundColor(Color.parseColor("#0a1020"));
        raiz.addView(webView, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        carregando = new ProgressBar(this);
        raiz.addView(carregando, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.CENTER));

        setContentView(raiz);
        configurarWebView();

        if (estadoSalvo != null) {
            webView.restoreState(estadoSalvo);
        } else {
            webView.loadUrl(URL_INICIAL);
        }
    }

    @SuppressWarnings("SetJavaScriptEnabled")
    private void configurarWebView() {
        WebSettings ajustes = webView.getSettings();
        ajustes.setJavaScriptEnabled(true);
        ajustes.setDomStorageEnabled(true);
        ajustes.setDatabaseEnabled(true);
        ajustes.setAllowFileAccess(false);
        ajustes.setAllowContentAccess(false);
        ajustes.setSupportZoom(false);
        ajustes.setBuiltInZoomControls(false);
        ajustes.setDisplayZoomControls(false);
        ajustes.setTextZoom(100);
        ajustes.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        ajustes.setMediaPlaybackRequiresUserGesture(true);
        ajustes.setJavaScriptCanOpenWindowsAutomatically(false);
        ajustes.setSupportMultipleWindows(false);
        ajustes.setCacheMode(WebSettings.LOAD_DEFAULT);
        ajustes.setUserAgentString(ajustes.getUserAgentString() + " VisualKanbanApp/" + versaoApp());
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            ajustes.setSafeBrowsingEnabled(true);
        }

        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, true);

        webView.addJavascriptInterface(new PonteNativa(), "AndroidBridge");

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest pedido) {
                return assetLoader.shouldInterceptRequest(pedido.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest pedido) {
                return tratarUrl(pedido.getUrl());
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                esconderCarregando();
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest pedido, WebResourceError erro) {
                if (pedido.isForMainFrame()) {
                    Log.e(TAG, "Falha ao abrir o painel: " + erro.getDescription());
                    esconderCarregando();
                }
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onConsoleMessage(ConsoleMessage mensagem) {
                Log.d(TAG, mensagem.message() + " (" + mensagem.sourceId() + ":" +
                        mensagem.lineNumber() + ")");
                return true;
            }
        });

        if ((getApplicationInfo().flags & android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0) {
            WebView.setWebContentsDebuggingEnabled(true);
        }
    }

    private void esconderCarregando() {
        if (carregando != null && carregando.getVisibility() != View.GONE) {
            carregando.setVisibility(View.GONE);
        }
    }

    private String versaoApp() {
        try {
            return getPackageManager().getPackageInfo(getPackageName(), 0).versionName;
        } catch (Exception e) {
            return "1.0.0";
        }
    }

    /** Links externos saem do app; o painel (appassets) fica dentro do WebView. */
    private boolean tratarUrl(Uri uri) {
        if (uri == null) return false;
        String esquema = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase();
        String host = uri.getHost() == null ? "" : uri.getHost().toLowerCase();

        if (("https".equals(esquema) || "http".equals(esquema)) && HOST.equals(host)) {
            return false;
        }
        if ("http".equals(esquema) || "https".equals(esquema)
                || "mailto".equals(esquema) || "tel".equals(esquema)) {
            try {
                startActivity(new Intent(Intent.ACTION_VIEW, uri));
            } catch (Exception e) {
                Toast.makeText(this, "Não foi possível abrir este link.", Toast.LENGTH_SHORT).show();
            }
            return true;
        }
        return false;
    }

    @Override
    public void onBackPressed() {
        if (webView == null) {
            super.onBackPressed();
            return;
        }
        webView.evaluateJavascript(
                "(function(){var d=document.querySelector('dialog[open]');" +
                "if(!d)return '';try{if(window.VK&&VK.fecharDialogo){VK.fecharDialogo(d.id);}" +
                "else{d.close();}}catch(e){}return 'fechado';})()",
                resultado -> {
                    boolean fechouDialogo = resultado != null && resultado.contains("fechado");
                    if (fechouDialogo) return;
                    if (webView.canGoBack()) {
                        webView.goBack();
                    } else {
                        finish();
                    }
                });
    }

    @Override
    protected void onSaveInstanceState(Bundle estado) {
        super.onSaveInstanceState(estado);
        if (webView != null) webView.saveState(estado);
    }

    @Override
    protected void onPause() {
        if (webView != null) webView.onPause();
        super.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (webView != null) webView.onResume();
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.removeJavascriptInterface("AndroidBridge");
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }

    /* ------------------------------------------------------------------ */
    /* Ponte JavaScript ↔ Android                                          */
    /* ------------------------------------------------------------------ */

    private class PonteNativa {

        @JavascriptInterface
        public boolean isNative() {
            return true;
        }

        @JavascriptInterface
        public String appVersion() {
            return versaoApp();
        }

        @JavascriptInterface
        public void saveFile(String base64, String nome, String mime) {
            salvarArquivo(base64, nome, mime);
        }

        @JavascriptInterface
        public void openUrl(String url) {
            if (url == null || url.isEmpty()) return;
            runOnUiThread(() -> {
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
                } catch (Exception e) {
                    Toast.makeText(MainActivity.this,
                            "Não foi possível abrir este link.", Toast.LENGTH_SHORT).show();
                }
            });
        }
    }

    private void salvarArquivo(String base64, String nome, String mime) {
        if (base64 == null || base64.isEmpty()) {
            avaliarErro("arquivo vazio");
            return;
        }
        String nomeLimpo = sanitizarNome(nome);
        String tipo = (mime == null || mime.isEmpty())
                ? "application/octet-stream" : mime;

        runOnUiThread(() -> {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q
                    && checkSelfPermission(android.Manifest.permission.WRITE_EXTERNAL_STORAGE)
                    != PackageManager.PERMISSION_GRANTED) {
                salvamentoPendente.set(new String[]{base64, nomeLimpo, tipo});
                requestPermissions(
                        new String[]{android.Manifest.permission.WRITE_EXTERNAL_STORAGE},
                        PEDIDO_PERMISSAO_ARMAZENAMENTO);
                return;
            }
            executarSalvamento(base64, nomeLimpo, tipo);
        });
    }

    @Override
    public void onRequestPermissionsResult(int codigo, String[] permissoes, int[] resultados) {
        super.onRequestPermissionsResult(codigo, permissoes, resultados);
        if (codigo != PEDIDO_PERMISSAO_ARMAZENAMENTO) return;
        String[] pendente = salvamentoPendente.getAndSet(null);
        if (pendente == null) return;
        if (resultados.length > 0 && resultados[0] == PackageManager.PERMISSION_GRANTED) {
            executarSalvamento(pendente[0], pendente[1], pendente[2]);
        } else {
            avaliarErro("permissão de armazenamento negada");
        }
    }

    private void executarSalvamento(String base64, String nome, String tipo) {
        new Thread(() -> {
            try {
                byte[] dados = Base64.decode(base64, Base64.DEFAULT);
                String caminho = gravar(dados, nome, tipo);
                avaliar("window.VKNative && window.VKNative.onSaved(" +
                        JSONObject.quote(caminho) + ");");
            } catch (Throwable erro) {
                Log.e(TAG, "Falha ao salvar arquivo", erro);
                avaliarErro(erro.getMessage() == null ? "erro desconhecido" : erro.getMessage());
            }
        }, "vk-salvar-arquivo").start();
    }

    private String gravar(byte[] dados, String nome, String tipo) throws Exception {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            ContentValues valores = new ContentValues();
            valores.put(MediaStore.Downloads.DISPLAY_NAME, nome);
            valores.put(MediaStore.Downloads.MIME_TYPE, tipo);
            valores.put(MediaStore.Downloads.RELATIVE_PATH,
                    Environment.DIRECTORY_DOWNLOADS + "/" + PASTA_DOWNLOADS);
            valores.put(MediaStore.Downloads.IS_PENDING, 1);

            Uri uri = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, valores);
            if (uri == null) throw new Exception("não foi possível criar o arquivo em Downloads");

            try (OutputStream saida = getContentResolver().openOutputStream(uri)) {
                if (saida == null) throw new Exception("não foi possível abrir o arquivo em Downloads");
                saida.write(dados);
                saida.flush();
            } catch (Exception erro) {
                try { getContentResolver().delete(uri, null, null); } catch (Exception ignorado) { }
                throw erro;
            }

            ContentValues pronto = new ContentValues();
            pronto.put(MediaStore.Downloads.IS_PENDING, 0);
            getContentResolver().update(uri, pronto, null, null);
            return "Downloads/" + PASTA_DOWNLOADS + "/" + nome;
        }

        File pasta = new File(
                Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS),
                PASTA_DOWNLOADS);
        if (!pasta.exists() && !pasta.mkdirs()) {
            throw new Exception("não foi possível criar a pasta Downloads/" + PASTA_DOWNLOADS);
        }
        File destino = new File(pasta, nome);
        int contador = 1;
        while (destino.exists()) {
            int ponto = nome.lastIndexOf('.');
            String base = ponto > 0 ? nome.substring(0, ponto) : nome;
            String extensao = ponto > 0 ? nome.substring(ponto) : "";
            destino = new File(pasta, base + " (" + contador++ + ")" + extensao);
        }
        try (FileOutputStream saida = new FileOutputStream(destino)) {
            saida.write(dados);
        }
        MediaScannerConnection.scanFile(this,
                new String[]{destino.getAbsolutePath()}, new String[]{tipo}, null);
        return "Downloads/" + PASTA_DOWNLOADS + "/" + destino.getName();
    }

    private String sanitizarNome(String nome) {
        String limpo = (nome == null ? "" : nome)
                .replaceAll("[\\\\/:*?\"<>|\\r\\n\\t]", "_")
                .trim();
        if (limpo.isEmpty()) limpo = "arquivo";
        if (limpo.length() > 120) {
            String extensao = "";
            int ponto = limpo.lastIndexOf('.');
            if (ponto > 0) {
                extensao = limpo.substring(ponto);
                limpo = limpo.substring(0, ponto);
            }
            int limite = Math.max(1, 120 - extensao.length());
            limpo = limpo.substring(0, Math.min(limpo.length(), limite)) + extensao;
        }
        return limpo;
    }

    private void avaliar(String javascript) {
        runOnUiThread(() -> {
            if (webView != null) webView.evaluateJavascript(javascript, null);
        });
    }

    private void avaliarErro(String mensagem) {
        avaliar("window.VKNative && window.VKNative.onSaveError(" +
                JSONObject.quote(mensagem) + ");");
    }
}
