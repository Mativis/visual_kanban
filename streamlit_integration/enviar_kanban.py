"""
Integração Visualfil (Streamlit) → Visual Kanban (Google Sheets / Apps Script)
=============================================================================

Este módulo é a ÚNICA parte que vive dentro do Visualfil. Ele é independente do
repositório `visual_kanban`: apenas conversa com a API publicada no Apps Script.

Uso (dentro da página do Kanban):

    from integracao_kanban_visual import render_enviar_kanban

    render_enviar_kanban(df_kanban, key_prefix="kb")

O que ele faz:
  * mostra o painel "Enviar Kanban" com URL/usuário/senha;
  * testa a conexão;
  * envia os pedidos (a API preserva o status já sinalizado pelas confecções);
  * lista os nomes das confecções com o CÓDIGO DE VÍNCULO gerado pela API —
    é esse código que o analista usa ao cadastrar o usuário da confecção.

Nenhum dado é gravado localmente: apenas enviado ao Google Sheets.
"""
from __future__ import annotations

import math
import os
import re
import unicodedata
from datetime import date, datetime, timedelta
from typing import Any, Iterable, Optional

import streamlit as st

try:  # pandas é dependência do projeto, mas o módulo é tolerante
    import pandas as pd
except ImportError:  # pragma: no cover
    pd = None

try:
    import requests
except ImportError:  # pragma: no cover
    requests = None


# Colunas extras que vale a pena guardar/mostrar no cartão do Kanban
EXTRAS: tuple[str, ...] = (
    "Compra",
    "Dt Emissão",
    "Tecido",
    "Consumo",
    "NF de Remessa",
    "Dt Remessa",
    "Ope. produtiva",
    "Tipo do Confeccionado",
    "Qtd Ret",
)


# ============================================================================
#  Vínculo da confecção (mesma regra do Apps Script)
# ============================================================================

def codigo_confeccao(nome: Any) -> str:
    """Gera o código estável usado para vincular pedidos e usuários.

    "J.C. MACEDO'S INDÚSTRIA" -> "J C MACEDO S INDUSTRIA"

    A mesma regra existe em `appscript/Code.gs` (função `gerarCodigoConfeccao`).
    """
    texto = unicodedata.normalize("NFKD", str(nome or ""))
    texto = "".join(c for c in texto if not unicodedata.combining(c))
    texto = re.sub(r"[^A-Za-z0-9]+", " ", texto).strip().upper()
    texto = re.sub(r"\s+", " ", texto)
    if not texto:
        return "SEM-CONFECCAO"
    return texto.replace(" ", "-")[:60]


# ============================================================================
#  Conversão de valores
# ============================================================================

def _texto(valor: Any) -> str:
    if valor is None:
        return ""
    if isinstance(valor, float) and math.isnan(valor):
        return ""
    texto = str(valor).strip()
    return "" if texto.lower() in {"nan", "nat", "none"} else texto


def _num(valor: Any) -> float:
    if valor is None:
        return 0.0
    if isinstance(valor, (int, float)):
        if isinstance(valor, float) and (math.isnan(valor) or math.isinf(valor)):
            return 0.0
        return float(valor)
    texto = _texto(valor)
    if not texto:
        return 0.0
    texto = texto.replace("R$", "").replace(" ", "")
    if "," in texto and "." in texto:
        texto = texto.replace(".", "").replace(",", ".")
    elif "," in texto:
        texto = texto.replace(",", ".")
    try:
        return float(texto)
    except ValueError:
        return 0.0


def _data_iso(valor: Any) -> str:
    """Normaliza qualquer data para AAAA-MM-DD (formato usado na API)."""
    if valor is None or valor == "":
        return ""
    if pd is not None and valor is pd.NaT:
        return ""
    if pd is not None and isinstance(valor, pd.Timestamp):
        return valor.strftime("%Y-%m-%d")
    if isinstance(valor, datetime):
        return valor.strftime("%Y-%m-%d")
    if isinstance(valor, date):
        return valor.isoformat()
    if isinstance(valor, (int, float)):
        # data serial do Excel (base 1899-12-30)
        if not valor or math.isnan(float(valor)):
            return ""
        try:
            return (datetime(1899, 12, 30) + timedelta(days=float(valor))).strftime("%Y-%m-%d")
        except Exception:
            return ""

    texto = _texto(valor)
    if not texto:
        return ""

    achou = re.match(r"^(\d{4})-(\d{1,2})-(\d{1,2})", texto)
    if achou:
        return f"{achou.group(1)}-{int(achou.group(2)):02d}-{int(achou.group(3)):02d}"

    achou = re.match(r"^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})", texto)
    if achou:
        dia, mes, ano = achou.group(1), achou.group(2), achou.group(3)
        if len(ano) == 2:
            ano = "20" + ano
        return f"{ano}-{int(mes):02d}-{int(dia):02d}"

    return ""


def _json_valor(valor: Any) -> Any:
    """Converte um valor pandas/numpy em algo serializável em JSON."""
    if valor is None:
        return ""
    if pd is not None and valor is pd.NaT:
        return ""
    if isinstance(valor, float) and math.isnan(valor):
        return ""
    if pd is not None and isinstance(valor, pd.Timestamp):
        return valor.strftime("%Y-%m-%d")
    if isinstance(valor, (datetime, date)):
        return valor.strftime("%Y-%m-%d")
    if hasattr(valor, "item") and not isinstance(valor, (str, bytes)):
        try:
            valor = valor.item()
        except Exception:
            pass
    if isinstance(valor, float):
        if math.isnan(valor) or math.isinf(valor):
            return ""
        return valor
    if isinstance(valor, bool):
        return valor
    return _texto(valor) if not isinstance(valor, (int, float)) else valor


def _primeiro(linha: Any, nomes: Iterable[str]) -> Any:
    """Retorna o primeiro valor não vazio entre as colunas informadas."""
    for nome in nomes:
        try:
            if nome not in linha.index:
                continue
            valor = linha[nome]
        except Exception:
            continue
        if _texto(valor):
            return valor
    return ""


# ============================================================================
#  Montagem do payload
# ============================================================================

def _id(valor: Any) -> str:
    """Texto de identificador sem o sufixo .0 que o pandas produz."""
    if valor is None:
        return ""
    if hasattr(valor, "item") and not isinstance(valor, (str, bytes)):
        try:
            valor = valor.item()
        except Exception:
            pass
    if isinstance(valor, float) and valor.is_integer():
        return str(int(valor))
    if isinstance(valor, int) and not isinstance(valor, bool):
        return str(valor)
    texto = _texto(valor)
    if re.fullmatch(r"\d+\.0", texto):
        texto = texto[:-2]
    return texto


def montar_registros(df) -> list[dict]:
    """Converte o DataFrame do Kanban na lista enviada à API."""
    if df is None or getattr(df, "empty", True):
        return []

    registros: list[dict] = []

    for _, linha in df.iterrows():
        pedido = _primeiro(linha, ("Compra", "Pedido", "pedido", "compra"))
        codigo = _primeiro(linha, ("Cód Confec", "Cod Confec", "cod_confec"))
        confeccao = _primeiro(linha, ("Confecção", "Confeccao", "confeccao")) or "Sem Confecção"

        registro = {
            "pedido": _id(pedido),
            "cod_confec": _id(codigo),
            "produto": _texto(_primeiro(linha, ("Confeccionado", "Produto", "produto"))),
            "qtd": _num(_primeiro(linha, ("Qtd", "Quantidade", "qtd"))),
            "saldo": _num(_primeiro(linha, ("Saldo", "saldo"))),
            "dt_entrega": _data_iso(_primeiro(linha, ("Dt Entrega", "Data Entrega", "dt_entrega"))),
            "confeccao": _texto(confeccao),
            "marca": _texto(_primeiro(linha, ("Marca", "marca"))),
            "prioridade": _texto(_primeiro(linha, ("Prioridade", "prioridade"))) or "Baixa",
            "qe": _num(_primeiro(linha, ("Q.E", "QE", "Quantidade Emergencial", "qe"))),
        }

        if not registro["pedido"] and not registro["cod_confec"]:
            continue

        for extra in EXTRAS:
            if extra in getattr(linha, "index", []):
                registro[extra] = _json_valor(linha[extra])

        registros.append(registro)

    return registros


def resumo_confeccoes(df) -> "pd.DataFrame":
    """DataFrame com nome, código de vínculo e volume por confecção."""
    if df is None or getattr(df, "empty", True):
        return pd.DataFrame(columns=["Confecção", "Código de vínculo", "Pedidos", "Peças"])

    coluna = "Confecção" if "Confecção" in df.columns else None
    if coluna is None:
        return pd.DataFrame(columns=["Confecção", "Código de vínculo", "Pedidos", "Peças"])

    nomes = (
        df[coluna].fillna("Sem Confecção").astype(str).str.strip().replace("", "Sem Confecção")
    )

    linhas = []
    for nome in sorted(nomes.unique().tolist()):
        sub = df[nomes == nome]
        pecas = float(sub["Saldo"].sum()) if "Saldo" in sub.columns else 0.0
        linhas.append({
            "Confecção": nome,
            "Código de vínculo": codigo_confeccao(nome),
            "Pedidos": int(len(sub)),
            "Peças": pecas,
        })

    return pd.DataFrame(linhas)


# ============================================================================
#  HTTP
# ============================================================================

def _post_json(url: str, payload: dict, timeout: int = 120) -> dict:
    if requests is None:
        raise RuntimeError("Dependência ausente: instale com `pip install requests`.")
    if not url:
        raise RuntimeError("Informe a URL do Web App do Apps Script.")

    resposta = requests.post(url, json=payload, timeout=timeout)
    if resposta.status_code >= 400:
        raise RuntimeError(f"HTTP {resposta.status_code}: {resposta.text[:180]}")

    try:
        return resposta.json()
    except ValueError:
        trecho = re.sub(r"\s+", " ", resposta.text[:200])
        raise RuntimeError(
            "O servidor não respondeu em JSON. Confirme que a URL é a do Web App "
            f"(termina em /exec) e que a implantação está pública. Trecho: {trecho}"
        )


def testar_conexao(url: str) -> dict:
    """Faz um ping na API e devolve versão/horário do servidor."""
    return _post_json(url, {"action": "ping"}, timeout=25)


def enviar_kanban(
    url: str,
    usuario: str,
    senha: str,
    df,
    resetar_status: bool = False,
) -> dict:
    """Envia o Kanban para a planilha. Retorna a resposta crua da API."""
    registros = montar_registros(df)
    if not registros:
        raise RuntimeError("Nenhum pedido para enviar.")

    return _post_json(url, {
        "action": "enviarkanban",
        "user": usuario,
        "senha": senha,
        "dados": registros,
        "resetar_status": bool(resetar_status),
    }, timeout=180)


# ============================================================================
#  Interface Streamlit
# ============================================================================

def _chave(prefixo: str, nome: str) -> str:
    return f"{prefixo}_{nome}" if prefixo else nome


def _config(nome_env: str, chave_secrets: str = "") -> str:
    """Lê a configuração de st.secrets ou de variável de ambiente."""
    valor = ""
    if chave_secrets:
        try:
            valor = str(st.secrets.get(chave_secrets, "") or "")
        except Exception:
            valor = ""
    return valor or os.getenv(nome_env, "")


def render_enviar_kanban(df_kanban, key_prefix: str = "") -> None:
    """Renderiza o painel de envio do Kanban (dentro de um expander)."""
    ss = st.session_state
    k_url = _chave(key_prefix, "in_url")
    k_user = _chave(key_prefix, "in_user")
    k_senha = _chave(key_prefix, "in_senha")
    k_ultimo = _chave(key_prefix, "ultimo")

    # Semeia os campos com st.secrets/env apenas uma vez; depois o widget manda.
    if k_url not in ss:
        ss[k_url] = _config("KANBAN_VISUAL_URL", "kanban_visual_url")
    if k_user not in ss:
        ss[k_user] = _config("KANBAN_VISUAL_USER", "kanban_visual_user")
    if k_senha not in ss:
        ss[k_senha] = _config("KANBAN_VISUAL_SENHA", "kanban_visual_senha")

    with st.expander("📤 Enviar Kanban para o Visual Kanban", expanded=False):
        st.caption(
            "Publica **todo** o quadro no Google Sheets para analistas e confecções. "
            "O envio substitui a versão anterior (pedidos que saíram do Kanban deixam de aparecer), "
            "mas o status já sinalizado pela confecção é **preservado**."
        )

        col_url, col_user = st.columns([2.2, 1])
        with col_url:
            url = st.text_input(
                "URL do AppScript (Web App)",
                key=k_url,
                placeholder="https://script.google.com/macros/s/.../exec",
                help="Apps Script → Implantar → Nova implantação → App da Web.",
            )
        with col_user:
            usuario = st.text_input(
                "Usuário analista",
                key=k_user,
                placeholder="admin",
            )

        senha = st.text_input(
            "Senha",
            key=k_senha,
            type="password",
            help="Credenciais usadas apenas nesta chamada; nada é gravado em disco.",
        )

        base = df_kanban

        resetar = st.checkbox(
            "Reiniciar status dos pedidos",
            value=False,
            key=_chave(key_prefix, "in_resetar"),
            help="Apaga as marcações de “em produção” e “pronto” feitas pelas confecções.",
        )
        if resetar:
            st.warning("Os status atuais das confecções serão perdidos.")

        col_testar, col_enviar = st.columns(2)
        with col_testar:
            testar = st.button("🔌 Testar conexão", key=_chave(key_prefix, "btn_testar"))
        with col_enviar:
            enviar = st.button(
                "📤 Enviar Kanban",
                key=_chave(key_prefix, "btn_enviar"),
                type="primary",
            )

        if testar:
            if not url:
                st.error("Informe a URL do AppScript.")
            else:
                try:
                    info = testar_conexao(url)
                    st.success(
                        f"Conectado — versão {info.get('versao', '?')} · "
                        f"{info.get('hora', '')} · {info.get('abas', '?')} abas"
                    )
                except Exception as erro:
                    st.error(f"Falha na conexão: {erro}")

        if enviar:
            if not url or not usuario or not senha:
                st.error("Preencha URL, usuário e senha.")
            elif base is None or getattr(base, "empty", True):
                st.warning("Nenhum pedido para enviar.")
            else:
                with st.spinner("Enviando Kanban…"):
                    try:
                        resposta = enviar_kanban(url, usuario, senha, base, resetar)
                    except Exception as erro:
                        st.error(f"Falha ao enviar: {erro}")
                    else:
                        if resposta.get("ok"):
                            confs = resposta.get("confeccoes") or []
                            ss[k_ultimo] = {
                                "total": resposta.get("total", 0),
                                "confeccoes": confs,
                                "preservados": resposta.get("status_preservados", 0),
                                "resetado": resposta.get("resetado", False),
                            }
                            st.success(
                                f"✅ Kanban enviado: **{resposta.get('total', 0)}** pedidos · "
                                f"**{len(confs)}** confecções · "
                                f"**{resposta.get('status_preservados', 0)}** status preservados."
                            )
                        else:
                            st.error(f"❌ {resposta.get('erro', 'Erro desconhecido')}")

        ultimo = ss.get(k_ultimo)
        if ultimo:
            st.info(
                f"Último envio nesta sessão: {ultimo['total']} pedidos · "
                f"{len(ultimo['confeccoes'])} confecções · "
                f"{ultimo['preservados']} status preservados"
                + (" · status reiniciados" if ultimo["resetado"] else "")
            )

        # ---------------- Códigos de vínculo ----------------
        st.markdown("##### 🔗 Códigos de vínculo das confecções")
        st.caption(
            "Use estes códigos ao cadastrar os usuários em **Visual Kanban → Administração**. "
            "Eles são gerados a partir do nome e permanecem estáveis entre envios."
        )

        tabela = resumo_confeccoes(base if base is not None else df_kanban)
        if tabela.empty:
            st.info("Sem confecções para listar.")
        else:
            st.dataframe(tabela, hide_index=True, width="stretch")
            st.download_button(
                "⤓ Baixar códigos (CSV)",
                data=tabela.to_csv(index=False, sep=";").encode("utf-8-sig"),
                file_name="confeccoes_codigos.csv",
                mime="text/csv",
                key=_chave(key_prefix, "btn_csv_codigos"),
            )
