package br.com.visualkanban.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Log;

import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Atualização OTA do painel (HTML/CSS/JS), sem reinstalar o APK.
 *
 * O app baixa `ota/manifest.json`, compara a versão com a ativa e, se houver
 * uma nova, baixa o ZIP, confere o SHA-256, extrai em `filesDir/ota/<versão>`
 * e passa a servir essa pasta pelo WebViewAssetLoader. Os assets embutidos no
 * APK continuam sendo o fallback permanente.
 */
final class OtaManager {

    private static final String TAG = "VisualKanbanOta";
    private static final String PREFS = "vk_ota";
    private static final String CHAVE_VERSAO = "versao";
    private static final String CHAVE_VERIFICADO = "verificado_em";
    private static final long INTERVALO_VERIFICACAO = 6L * 60L * 60L * 1000L;
    private static final int LIMITE_MANIFESTO = 128 * 1024;
    private static final long LIMITE_ZIP = 30L * 1024 * 1024;

    interface Callback {
        void semAtualizacao(String versao, boolean manual);

        void instalada(String versao);

        void erro(String mensagem, boolean manual);
    }

    private final Context contexto;
    private final SharedPreferences preferencias;
    private final File raiz;
    private final String versaoEmpacotada;
    private final String urlManifesto;
    private final AtomicBoolean verificando = new AtomicBoolean(false);

    OtaManager(Context contexto, String versaoEmpacotada) {
        this.contexto = contexto.getApplicationContext();
        this.versaoEmpacotada = versaoEmpacotada;
        this.preferencias = this.contexto.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        this.raiz = new File(this.contexto.getFilesDir(), "ota");
        this.urlManifesto = this.contexto.getString(R.string.ota_manifest_url);
        if (!raiz.isDirectory()) raiz.mkdirs();
        limparTemporarios();
    }

    /** Pasta a ser servida no WebView, ou null para usar os assets do APK. */
    File raizAtiva() {
        String versao = preferencias.getString(CHAVE_VERSAO, "");
        if (versao == null || versao.isEmpty()) return null;

        File pasta = pasta(versao);
        boolean valida = new File(pasta, "www/index.html").isFile();
        boolean maisNovaQueApk = OtaPacote.compararVersao(versao, versaoEmpacotada) > 0;

        if (!valida || !maisNovaQueApk) {
            // APK atualizado por cima: o pacote embutido já é igual ou mais novo.
            preferencias.edit().remove(CHAVE_VERSAO).apply();
            OtaPacote.apagar(pasta);
            return null;
        }
        return pasta;
    }

    String versaoAtiva() {
        File pasta = raizAtiva();
        if (pasta == null) return versaoEmpacotada;
        String versao = preferencias.getString(CHAVE_VERSAO, versaoEmpacotada);
        return versao == null || versao.isEmpty() ? versaoEmpacotada : versao;
    }

    boolean usandoOta() {
        return raizAtiva() != null;
    }

    /** Remove o pacote ativo; o app volta para os assets embutidos. */
    void desativarAtual() {
        String versao = preferencias.getString(CHAVE_VERSAO, "");
        preferencias.edit().remove(CHAVE_VERSAO).apply();
        if (versao != null && !versao.isEmpty()) {
            OtaPacote.apagar(pasta(versao));
        }
    }

    File pasta(String versao) {
        return new File(raiz, versao);
    }

    void verificar(boolean manual, Callback retorno) {
        if (!manual) {
            long ultima = preferencias.getLong(CHAVE_VERIFICADO, 0L);
            if (System.currentTimeMillis() - ultima < INTERVALO_VERIFICACAO) return;
        }
        if (!verificando.compareAndSet(false, true)) return;

        new Thread(() -> {
            try {
                executar(manual, retorno);
            } catch (Throwable erro) {
                Log.w(TAG, "Falha na verificação de atualização", erro);
                if (manual) retorno.erro(mensagem(erro), true);
            } finally {
                verificando.set(false);
            }
        }, "vk-ota").start();
    }

    private void executar(boolean manual, Callback retorno) throws Exception {
        JSONObject manifesto = new JSONObject(new String(
                baixar(urlManifesto, LIMITE_MANIFESTO),
                java.nio.charset.StandardCharsets.UTF_8));

        preferencias.edit()
                .putLong(CHAVE_VERIFICADO, System.currentTimeMillis())
                .apply();

        String versao = manifesto.optString("versao", "").trim();
        if (!OtaPacote.versaoValida(versao)) {
            throw new IOException("versão inválida no manifesto");
        }

        String apkMinimo = manifesto.optString("apk_min", "").trim();
        if (!apkMinimo.isEmpty()
                && OtaPacote.compararVersao(versaoEmpacotada, apkMinimo) < 0) {
            throw new IOException("esta atualização exige o app " + apkMinimo
                    + " ou superior");
        }

        String ativa = versaoAtiva();
        if (OtaPacote.compararVersao(versao, ativa) <= 0) {
            retorno.semAtualizacao(ativa, manual);
            return;
        }

        String urlZip = manifesto.optString("zip", "").trim();
        String sha256 = manifesto.optString("sha256", "").trim().toLowerCase();
        if (!urlZip.startsWith("https://")) {
            throw new IOException("endereço do pacote não usa HTTPS");
        }
        if (!sha256.matches("[0-9a-f]{64}")) {
            throw new IOException("SHA-256 inválido no manifesto");
        }

        File zip = new File(contexto.getCacheDir(), "vk-ota.zip");
        try {
            baixarZip(urlZip, zip, sha256);
            File temporaria = new File(raiz, ".tmp-" + System.nanoTime());
            OtaPacote.extrair(zip, temporaria, versao);

            File destino = pasta(versao);
            OtaPacote.apagar(destino);
            if (!temporaria.renameTo(destino)) {
                OtaPacote.apagar(temporaria);
                throw new IOException("não foi possível ativar a atualização");
            }

            String anterior = ativa;
            if (!preferencias.edit().putString(CHAVE_VERSAO, versao).commit()) {
                throw new IOException("não foi possível gravar a versão ativa");
            }
            limparAntigas(versao, anterior);
            retorno.instalada(versao);
        } finally {
            //noinspection ResultOfMethodCallIgnored
            zip.delete();
        }
    }

    private byte[] baixar(String endereco, int limite) throws IOException {
        HttpURLConnection conexao = abrir(endereco);
        try (InputStream entrada = new BufferedInputStream(conexao.getInputStream());
             ByteArrayOutputStream saida = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192];
            int lidos;
            int total = 0;
            while ((lidos = entrada.read(buffer)) > 0) {
                total += lidos;
                if (total > limite) throw new IOException("manifesto grande demais");
                saida.write(buffer, 0, lidos);
            }
            return saida.toByteArray();
        } finally {
            conexao.disconnect();
        }
    }

    private void baixarZip(String endereco, File destino, String shaEsperado)
            throws Exception {
        HttpURLConnection conexao = abrir(endereco);
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        long total = 0;
        try (InputStream entrada = new BufferedInputStream(conexao.getInputStream());
             OutputStream saida = new BufferedOutputStream(new FileOutputStream(destino))) {
            byte[] buffer = new byte[8192];
            int lidos;
            while ((lidos = entrada.read(buffer)) > 0) {
                total += lidos;
                if (total > LIMITE_ZIP) throw new IOException("pacote grande demais");
                digest.update(buffer, 0, lidos);
                saida.write(buffer, 0, lidos);
            }
        } finally {
            conexao.disconnect();
        }

        String obtido = OtaPacote.hexadecimal(digest.digest());
        if (!obtido.equalsIgnoreCase(shaEsperado)) {
            //noinspection ResultOfMethodCallIgnored
            destino.delete();
            throw new IOException("o SHA-256 do pacote não confere");
        }
    }

    private HttpURLConnection abrir(String endereco) throws IOException {
        URL url = new URL(endereco);
        if (!"https".equalsIgnoreCase(url.getProtocol())) {
            throw new IOException("download OTA exige HTTPS");
        }
        HttpURLConnection conexao = (HttpURLConnection) url.openConnection();
        conexao.setConnectTimeout(15000);
        conexao.setReadTimeout(45000);
        conexao.setInstanceFollowRedirects(true);
        conexao.setUseCaches(false);
        conexao.setRequestProperty("User-Agent", "VisualKanban-OTA/" + versaoEmpacotada);
        int codigo = conexao.getResponseCode();
        if (codigo != HttpURLConnection.HTTP_OK) {
            conexao.disconnect();
            throw new IOException("servidor respondeu HTTP " + codigo);
        }
        return conexao;
    }

    private void limparTemporarios() {
        File[] filhos = raiz.listFiles();
        if (filhos == null) return;
        for (File filho : filhos) {
            if (filho.isDirectory() && filho.getName().startsWith(".tmp-")) {
                OtaPacote.apagar(filho);
            }
        }
    }

    /** Mantém a versão nova e a anterior (que pode estar em uso pelo WebView). */
    private void limparAntigas(String nova, String anterior) {
        File[] filhos = raiz.listFiles();
        if (filhos == null) return;
        for (File filho : filhos) {
            if (!filho.isDirectory()) continue;
            String nome = filho.getName();
            if (nome.equals(nova) || nome.equals(anterior)) continue;
            OtaPacote.apagar(filho);
        }
    }

    private String mensagem(Throwable erro) {
        String texto = erro.getMessage();
        if (texto == null || texto.isEmpty()) texto = "erro de rede";
        return texto;
    }
}
