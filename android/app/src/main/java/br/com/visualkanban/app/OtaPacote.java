package br.com.visualkanban.app;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

/**
 * Regras puras do pacote OTA: comparação de versões, extração segura do ZIP e
 * leitura da versão empacotada no painel. Sem dependências do Android para poder
 * ser testado na JVM (veja tools/TestarOta.java).
 */
final class OtaPacote {

    private static final long LIMITE_TOTAL = 60L * 1024 * 1024;
    private static final int LIMITE_ARQUIVOS = 5000;
    private static final Pattern VERSAO_CONFIG =
            Pattern.compile("versao\\s*:\\s*\"([^\"]+)\"");
    private static final Pattern VERSAO_VALIDA =
            Pattern.compile("^[0-9A-Za-z][0-9A-Za-z._-]{0,31}$");

    private OtaPacote() {
    }

    static boolean versaoValida(String versao) {
        return versao != null && VERSAO_VALIDA.matcher(versao).matches();
    }

    /** Compara versões numéricas (ex.: 1.2.10 > 1.2.9). */
    static int compararVersao(String a, String b) {
        int[] pa = numeros(a);
        int[] pb = numeros(b);
        for (int i = 0; i < pa.length; i++) {
            if (pa[i] != pb[i]) return pa[i] < pb[i] ? -1 : 1;
        }
        return 0;
    }

    private static int[] numeros(String versao) {
        int[] partes = new int[4];
        if (versao == null) return partes;
        Matcher m = Pattern.compile("(\\d+)").matcher(versao);
        int i = 0;
        while (m.find() && i < partes.length) {
            try {
                partes[i++] = Integer.parseInt(m.group(1));
            } catch (NumberFormatException ignorado) {
                // número absurdo: trata como 0
            }
        }
        return partes;
    }

    /** Lê `versao: "x.y.z"` do config.js já extraído. */
    static String versaoConfig(File pastaVersao) throws IOException {
        File config = new File(pastaVersao, "www/js/config.js");
        if (!config.isFile()) throw new IOException("pacote sem www/js/config.js");
        String texto = ler(config, 256 * 1024);
        Matcher m = VERSAO_CONFIG.matcher(texto);
        if (!m.find()) throw new IOException("versão ausente em www/js/config.js");
        return m.group(1).trim();
    }

    /**
     * Extrai o ZIP para {@code destino} validando caminho, tamanho e versão.
     * Em qualquer falha, apaga o destino parcial.
     */
    static void extrair(File zip, File destino, String versaoEsperada) throws IOException {
        apagar(destino);
        if (!destino.mkdirs()) {
            throw new IOException("não foi possível criar a pasta de atualização");
        }
        long total = 0;
        int arquivos = 0;
        try {
            String prefixo = destino.getCanonicalPath() + File.separator;
            try (ZipInputStream entrada = new ZipInputStream(
                    new BufferedInputStream(new FileInputStream(zip)))) {
                ZipEntry item;
                while ((item = entrada.getNextEntry()) != null) {
                    String nome = item.getName().replace('\\', '/');
                    if (nome.isEmpty()) continue;
                    if (nome.indexOf('\0') >= 0
                            || (!nome.equals("www") && !nome.startsWith("www/"))) {
                        throw new IOException("caminho inválido no pacote: " + nome);
                    }
                    for (String parte : nome.split("/")) {
                        if (parte.equals("..") || parte.equals(".")) {
                            throw new IOException("caminho inválido no pacote: " + nome);
                        }
                    }
                    File saida = new File(destino, nome);
                    if (!saida.getCanonicalPath().startsWith(prefixo)) {
                        throw new IOException("caminho inválido no pacote: " + nome);
                    }
                    if (item.isDirectory()) {
                        if (!saida.isDirectory() && !saida.mkdirs()) {
                            throw new IOException("não foi possível criar " + nome);
                        }
                        continue;
                    }
                    if (++arquivos > LIMITE_ARQUIVOS) {
                        throw new IOException("pacote com arquivos demais");
                    }
                    File pai = saida.getParentFile();
                    if (pai != null && !pai.isDirectory() && !pai.mkdirs()) {
                        throw new IOException("não foi possível criar " + pai.getName());
                    }
                    try (OutputStream saidaArquivo = new BufferedOutputStream(
                            new FileOutputStream(saida))) {
                        byte[] buffer = new byte[8192];
                        int lidos;
                        while ((lidos = entrada.read(buffer)) > 0) {
                            total += lidos;
                            if (total > LIMITE_TOTAL) {
                                throw new IOException("pacote grande demais");
                            }
                            saidaArquivo.write(buffer, 0, lidos);
                        }
                    }
                }
            }

            if (!new File(destino, "www/index.html").isFile()) {
                throw new IOException("pacote sem www/index.html");
            }
            String versao = versaoConfig(destino);
            if (!versao.equals(versaoEsperada)) {
                throw new IOException("o pacote diz " + versao + ", manifesto diz "
                        + versaoEsperada);
            }
            if (!new File(destino, "www/app.html").isFile()) {
                throw new IOException("pacote sem www/app.html");
            }
        } catch (IOException | RuntimeException erro) {
            apagar(destino);
            throw erro;
        }
    }

    static String sha256(File arquivo) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        try (InputStream entrada = new BufferedInputStream(new FileInputStream(arquivo))) {
            byte[] buffer = new byte[8192];
            int lidos;
            while ((lidos = entrada.read(buffer)) > 0) {
                digest.update(buffer, 0, lidos);
            }
        }
        return hexadecimal(digest.digest());
    }

    static String hexadecimal(byte[] dados) {
        StringBuilder texto = new StringBuilder(dados.length * 2);
        for (byte b : dados) texto.append(String.format("%02x", b & 0xff));
        return texto.toString();
    }

    static void apagar(File arquivo) {
        if (arquivo == null || !arquivo.exists()) return;
        File[] filhos = arquivo.listFiles();
        if (filhos != null) {
            for (File filho : filhos) apagar(filho);
        }
        //noinspection ResultOfMethodCallIgnored
        arquivo.delete();
    }

    private static String ler(File arquivo, int limite) throws IOException {
        try (InputStream entrada = new BufferedInputStream(new FileInputStream(arquivo));
             ByteArrayOutputStream saida = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192];
            int lidos;
            int total = 0;
            while ((lidos = entrada.read(buffer)) > 0) {
                total += lidos;
                if (total > limite) throw new IOException("arquivo grande demais");
                saida.write(buffer, 0, lidos);
            }
            return new String(saida.toByteArray(), StandardCharsets.UTF_8);
        }
    }
}
