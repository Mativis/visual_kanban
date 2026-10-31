"""Empacota o painel para atualização OTA do app Android.

Uso (da raiz do repositório visual_kanban):

    python android/tools/gerar_ota.py --notas "Correções no quadro"

O script:
  1. lê a versão de `static/js/config.js`;
  2. gera `ota/www-<versao>.zip` com os mesmos assets que o APK usa;
  3. calcula o SHA-256;
  4. escreve `ota/manifest.json` apontando para o arquivo no GitHub (raw/main).

Depois é só commitar `static/` e `ota/`. O app verifica o manifesto no máximo a
cada 6 horas (ou pelo menu “Verificar atualizações”).
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
import zipfile
from datetime import datetime, timezone
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
STATIC = RAIZ / "static"
OTA = RAIZ / "ota"
CONFIG = STATIC / "js" / "config.js"
URL_BASE_PADRAO = (
    "https://raw.githubusercontent.com/Mativis/visual_kanban/main/ota"
)
DATA_FIXA = (2024, 1, 1, 0, 0, 0)


def ler_versao() -> str:
    texto = CONFIG.read_text(encoding="utf-8")
    encontrada = re.search(r'versao\s*:\s*"([^"]+)"', texto)
    if not encontrada:
        sys.exit("ERRO: não encontrei `versao` em static/js/config.js")
    versao = encontrada.group(1).strip()
    if not re.fullmatch(r"[0-9A-Za-z][0-9A-Za-z._-]{0,31}", versao):
        sys.exit(f"ERRO: versão inválida: {versao!r}")
    return versao


def validar_html(versao: str) -> None:
    for nome in ("app.html", "index.html"):
        texto = (STATIC / nome).read_text(encoding="utf-8")
        if f"?v={versao}" not in texto:
            sys.exit(
                f"ERRO: static/{nome} não referencia os assets com ?v={versao}. "
                "Atualize o cache-busting antes de gerar o OTA."
            )


def arquivos_do_painel() -> list[Path]:
    arquivos = []
    for arquivo in sorted(STATIC.rglob("*")):
        if not arquivo.is_file():
            continue
        relativo = arquivo.relative_to(STATIC).as_posix()
        if relativo.endswith(".map") or Path(relativo).name.startswith("_"):
            continue
        arquivos.append(arquivo)
    if not arquivos:
        sys.exit("ERRO: static/ está vazio")
    return arquivos


def gerar_zip(versao: str, arquivos: list[Path]) -> Path:
    OTA.mkdir(parents=True, exist_ok=True)
    destino = OTA / f"www-{versao}.zip"
    with zipfile.ZipFile(destino, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for arquivo in arquivos:
            relativo = "www/" + arquivo.relative_to(STATIC).as_posix()
            info = zipfile.ZipInfo(relativo, date_time=DATA_FIXA)
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            z.writestr(info, arquivo.read_bytes())
    return destino


def main() -> None:
    parser = argparse.ArgumentParser(description="Gera pacote + manifesto OTA")
    parser.add_argument("--notas", default="", help="novidades exibidas no manifesto")
    parser.add_argument(
        "--url-base",
        default=URL_BASE_PADRAO,
        help="pasta pública onde os ZIPs ficam hospedados",
    )
    parser.add_argument(
        "--apk-min",
        default="",
        help="versão mínima do APK exigida por esta atualização (opcional)",
    )
    args = parser.parse_args()

    versao = ler_versao()
    validar_html(versao)
    arquivos = arquivos_do_painel()

    zip_path = gerar_zip(versao, arquivos)
    dados = zip_path.read_bytes()
    sha256 = hashlib.sha256(dados).hexdigest()

    manifesto = {
        "versao": versao,
        "zip": f"{args.url_base.rstrip('/')}/{zip_path.name}",
        "sha256": sha256,
        "tamanho": len(dados),
        "publicado_em": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "notas": args.notas,
    }
    if args.apk_min:
        manifesto["apk_min"] = args.apk_min

    destino_manifesto = OTA / "manifest.json"
    destino_manifesto.write_text(
        json.dumps(manifesto, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    print(f"Versão:       {versao}")
    print(f"Arquivos:     {len(arquivos)}")
    print(f"Pacote:       {zip_path} ({len(dados) / 1024:.1f} KiB)")
    print(f"SHA-256:      {sha256}")
    print(f"Manifesto:    {destino_manifesto}")
    print(f"URL pública:  {manifesto['zip']}")
    print("\nAgora commite static/ e ota/ e faça push para o GitHub.")


if __name__ == "__main__":
    main()
