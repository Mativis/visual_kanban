"""Gera os ícones PNG legados do app (Android < 8.0) a partir das cores do tema.

Uso (da pasta android/):
    python tools/gerar_icones.py

O build usa os adaptive icons (mipmap-anydpi-v26) no Android 8+; estes PNGs
cobrem apenas aparelhos antigos e são versionados no repositório.
"""
from pathlib import Path

from PIL import Image, ImageDraw

RAIZ = Path(__file__).resolve().parent.parent
RES = RAIZ / "app" / "src" / "main" / "res"

DENSIDADES = {
    "mdpi": 48,
    "hdpi": 72,
    "xhdpi": 96,
    "xxhdpi": 144,
    "xxxhdpi": 192,
}

TOPO = (99, 102, 241)     # #6366F1
BASE = (67, 56, 202)      # #4338CA
BRANCO = (255, 255, 255, 255)


def fundo(tamanho: int) -> Image.Image:
    """Quadrado com gradiente diagonal indigo -> indigo escuro."""
    imagem = Image.new("RGB", (tamanho, tamanho))
    pixels = imagem.load()
    for y in range(tamanho):
        for x in range(tamanho):
            t = (x + y) / (2 * (tamanho - 1))
            pixels[x, y] = tuple(
                round(TOPO[i] + (BASE[i] - TOPO[i]) * t) for i in range(3)
            )
    return imagem.convert("RGBA")


def mascara(tamanho: int, redondo: bool) -> Image.Image:
    escala = 8
    mascara = Image.new("L", (tamanho * escala, tamanho * escala), 0)
    desenho = ImageDraw.Draw(mascara)
    if redondo:
        desenho.ellipse(
            (0, 0, tamanho * escala - 1, tamanho * escala - 1), fill=255
        )
    else:
        raio = int(tamanho * escala * 0.22)
        desenho.rounded_rectangle(
            (0, 0, tamanho * escala - 1, tamanho * escala - 1),
            radius=raio,
            fill=255,
        )
    return mascara.resize((tamanho, tamanho), Image.LANCZOS)


def barras(imagem: Image.Image) -> None:
    """Desenha as três barras do logo (mesma proporção do ic_launcher_foreground)."""
    tamanho = imagem.width
    desenho = ImageDraw.Draw(imagem)

    # O viewport do vetor é 108dp; converte cada coordenada para pixels.
    def px(valor: float) -> float:
        return valor / 108.0 * tamanho

    barras = [
        (32, 32, 44, 76, 255),
        (48, 38, 60, 76, 255),
        (64, 45, 76, 76, 140),
    ]
    raio = max(1, round(px(3)))
    for x0, y0, x1, y1, alfa in barras:
        cor = BRANCO[:3] + (alfa,)
        desenho.rounded_rectangle(
            (px(x0), px(y0), px(x1), px(y1)), radius=raio, fill=cor
        )


def gerar() -> None:
    for densidade, tamanho in DENSIDADES.items():
        destino = RES / f"mipmap-{densidade}"
        destino.mkdir(parents=True, exist_ok=True)

        for redondo, nome in (
            (False, "ic_launcher.png"),
            (True, "ic_launcher_round.png"),
        ):
            icone = fundo(tamanho)
            barras(icone)
            icone.putalpha(mascara(tamanho, redondo))
            icone.save(destino / nome, "PNG", optimize=True)
            print(f"{destino / nome} ({tamanho}x{tamanho})")


if __name__ == "__main__":
    gerar()
