import os
import subprocess
import sys
from pathlib import Path

if __name__ == "__main__":
    diretorio_kanban = Path(__file__).resolve().parent

    print("Iniciando o Visual Kanban...")
    print("O seu navegador deve abrir automaticamente em alguns segundos.")

    # Executa o Streamlit a partir do diretório do Visual Kanban
    # para garantir o carregamento do .streamlit/config.toml (enableStaticServing)
    try:
        subprocess.run(
            [sys.executable, "-m", "streamlit", "run", "app.py", *sys.argv[1:]],
            cwd=diretorio_kanban,
        )
    except KeyboardInterrupt:
        print("\nAplicativo encerrado pelo usuário.")

