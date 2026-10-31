package br.com.visualkanban.app;

import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

/**
 * Teste rápido das regras de OTA na JVM (não depende do Android).
 *
 * Compile e rode a partir de android/:
 *   javac -d %TEMP%\vk-ota-test app/src/main/java/br/com/visualkanban/app/OtaPacote.java tools/TestarOta.java
 *   java -cp %TEMP%\vk-ota-test br.com.visualkanban.app.TestarOta
 */
public final class TestarOta {

    public static void main(String[] args) throws Exception {
        versoes();
        extraiPacoteValido();
        rejeitaVersaoDivergente();
        rejeitaZipSlip();
        System.out.println("OK: regras de OTA validadas");
    }

    private static void versoes() {
        exigir(OtaPacote.compararVersao("1.2.10", "1.2.9") > 0, "1.2.10 > 1.2.9");
        exigir(OtaPacote.compararVersao("1.2.7", "1.2.7") == 0, "1.2.7 == 1.2.7");
        exigir(OtaPacote.compararVersao("1.10", "1.9") > 0, "1.10 > 1.9");
        exigir(OtaPacote.compararVersao("1.2.7", "1.2.7.1") < 0, "1.2.7 < 1.2.7.1");
        exigir(OtaPacote.versaoValida("1.2.7"), "versão 1.2.7 válida");
        exigir(!OtaPacote.versaoValida("../etc"), "versão com caminho inválida");
    }

    private static void extraiPacoteValido() throws Exception {
        File base = Files.createTempDirectory("vk-ota-ok").toFile();
        File zip = new File(base, "www.zip");
        criarZip(zip, new String[][]{
                {"www/index.html", "<html>ok</html>"},
                {"www/app.html", "<html>app</html>"},
                {"www/js/config.js", "window.VK_CONFIG={versao: \"9.9.9\"};"},
                {"www/css/style.css", "body{}"},
        });
        File destino = new File(base, "9.9.9");
        OtaPacote.extrair(zip, destino, "9.9.9");
        exigir(new File(destino, "www/index.html").isFile(), "index extraído");
        exigir(new File(destino, "www/css/style.css").isFile(), "css extraído");
        exigir("9.9.9".equals(OtaPacote.versaoConfig(destino)), "versão lida");
        exigir(!OtaPacote.sha256(zip).isEmpty(), "sha256 gerado");
        OtaPacote.apagar(base);
    }

    private static void rejeitaVersaoDivergente() throws Exception {
        File base = Files.createTempDirectory("vk-ota-versao").toFile();
        File zip = new File(base, "www.zip");
        criarZip(zip, new String[][]{
                {"www/index.html", "<html>ok</html>"},
                {"www/app.html", "<html>app</html>"},
                {"www/js/config.js", "window.VK_CONFIG={versao: \"1.0.0\"};"},
        });
        File destino = new File(base, "9.9.9");
        try {
            OtaPacote.extrair(zip, destino, "9.9.9");
            throw new AssertionError("aceitou versão divergente");
        } catch (java.io.IOException esperado) {
            exigir(!destino.exists(), "removeu destino inválido");
        }
        OtaPacote.apagar(base);
    }

    private static void rejeitaZipSlip() throws Exception {
        File base = Files.createTempDirectory("vk-ota-slip").toFile();
        File zip = new File(base, "www.zip");
        criarZip(zip, new String[][]{
                {"www/index.html", "<html>ok</html>"},
                {"www/app.html", "<html>app</html>"},
                {"www/js/config.js", "window.VK_CONFIG={versao: \"9.9.9\"};"},
                {"www/../fora.txt", "invasao"},
        });
        File destino = new File(base, "9.9.9");
        try {
            OtaPacote.extrair(zip, destino, "9.9.9");
            throw new AssertionError("aceitou caminho fora de www");
        } catch (java.io.IOException esperado) {
            exigir(!new File(base, "fora.txt").exists(), "não escreveu fora");
            exigir(!destino.exists(), "removeu destino inválido");
        }
        OtaPacote.apagar(base);
    }

    private static void criarZip(File destino, String[][] entradas) throws Exception {
        try (ZipOutputStream z = new ZipOutputStream(new FileOutputStream(destino))) {
            for (String[] entrada : entradas) {
                z.putNextEntry(new ZipEntry(entrada[0]));
                z.write(entrada[1].getBytes(StandardCharsets.UTF_8));
                z.closeEntry();
            }
        }
    }

    private static void exigir(boolean condicao, String mensagem) {
        if (!condicao) throw new AssertionError("falhou: " + mensagem);
    }
}
