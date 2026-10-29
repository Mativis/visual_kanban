"""
Integração Visualfil (Streamlit) → Visual Kanban (Google Sheets / Apps Script)
=============================================================================

Este módulo é a ÚNICA parte que vive dentro do Visualfil. Ele é independente do
repositório `visual_kanban`: apenas conversa com a API publicada no Apps Script.

Uso (dentro da página do Kanban):

    from integracao_kanban_visual import render_enviar_kanban

    render_enviar_kanban(df_kanban, key_prefix="kb", df_filtrado=df_filtrado)

O que ele faz:
  * mostra o painel "Enviar Kanban" com URL/usuário/senha;
  * testa a conexão;
  * envia somente os pedidos filtrados (preservando os demais) ou o quadro
    completo, conforme a escolha (a API preserva o status já sinalizado);
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


def _partes_versao(valor: Any) -> tuple[int, ...]:
    """Converte "1.2.3" em (1, 2, 3) para comparação simples."""
    try:
        return tuple(int(x) for x in re.findall(r"\d+", str(valor))[:3])
    except (TypeError, ValueError):
        return ()


def _versao_ok(versao: Any, minima: str = "1.2.3") -> bool:
    """True quando a versão do servidor suporta o envio parcial."""
    atual = _partes_versao(versao)
    alvo = _partes_versao(minima)
    return bool(atual) and bool(alvo) and atual >= alvo


def enviar_kanban(
    url: str,
    usuario: str,
    senha: str,
    df,
    resetar_status: bool = False,
    modo: str = "completo",
) -> dict:
    """Envia o Kanban para a planilha. Retorna a resposta crua da API.

    ``modo="parcial"`` (backend 1.2.3+) atualiza os pedidos enviados e preserva
    os demais que já estão no Visual Kanban. ``modo="completo"`` substitui o
    quadro inteiro, como nas versões anteriores.
    """
    registros = montar_registros(df)
    if not registros:
        raise RuntimeError("Nenhum pedido para enviar.")

    modo = "parcial" if str(modo).strip().lower() == "parcial" else "completo"
    return _post_json(url, {
        "action": "enviarkanban",
        "user": usuario,
        "senha": senha,
        "dados": registros,
        "resetar_status": bool(resetar_status),
        "modo": modo,
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


def render_enviar_kanban(df_kanban, key_prefix: str = "", df_filtrado=None) -> None:
    """Renderiza o painel de envio do Kanban (dentro de um expander).

    ``df_filtrado`` é o recorte atual da tela. Quando informado, o painel pode
    enviar somente esses pedidos e preservar os demais no Visual Kanban.
    """
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
            "Escolha enviar **somente os pedidos filtrados** (os demais continuam no Visual Kanban) "
            "ou **todo o quadro** (substitui a versão anterior). Nos dois modos o status já "
            "sinalizado pela confecção é **preservado**."
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

        modo_label = st.radio(
            "Escopo do envio",
            (
                "Somente os pedidos filtrados (preserva os demais)",
                "Todo o quadro (substitui a versão anterior)",
            ),
            index=0 if df_filtrado is not None else 1,
            key=_chave(key_prefix, "in_modo"),
            help=(
                "O envio filtrado atualiza somente os pedidos selecionados e mantém os outros. "
                "O envio completo remove do Visual Kanban os pedidos que não estiverem no quadro atual."
            ),
        )
        parcial = modo_label.startswith("Somente")
        base = (df_filtrado if df_filtrado is not None else df_kanban) if parcial else df_kanban

        if base is None or getattr(base, "empty", True):
            st.warning("Nenhum pedido selecionado para envio.")
        elif parcial:
            st.info(
                f"**{len(base)}** pedido(s) do filtro atual serão enviados. "
                "Os pedidos fora do filtro permanecem no Visual Kanban; pedidos removidos "
                "da origem só saem no envio completo."
            )
        else:
            st.warning(
                f"**{len(base)}** pedido(s) do quadro completo serão enviados. "
                "Pedidos que não estiverem nesta lista serão removidos do Visual Kanban."
            )

        resetar = st.checkbox(
            "Reiniciar status dos pedidos",
            value=False,
            key=_chave(key_prefix, "in_resetar"),
            help=(
                "Apaga as marcações de “em produção” e “pronto” feitas pelas confecções. "
                "No envio filtrado, só os pedidos enviados são reiniciados."
            ),
        )
        if resetar:
            st.warning(
                "Os status atuais dos pedidos enviados serão perdidos."
                if parcial
                else "Os status atuais de todo o quadro serão perdidos."
            )

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
                    suporta_parcial = _versao_ok(info.get("versao"), "1.2.3")
                    st.success(
                        f"Conectado — versão {info.get('versao', '?')} · "
                        f"{info.get('hora', '')} · {info.get('abas', '?')} abas"
                        + (
                            " · envio filtrado disponível"
                            if suporta_parcial
                            else " · atualize o Apps Script para 1.2.3 para usar o envio filtrado"
                        )
                    )
                except Exception as erro:
                    st.error(f"Falha na conexão: {erro}")

        if enviar:
            if not url or not usuario or not senha:
                st.error("Preencha URL, usuário e senha.")
            elif base is None or getattr(base, "empty", True):
                st.warning("Nenhum pedido para enviar.")
            else:
                pode_enviar = True
                if parcial:
                    # O modo parcial só existe no backend 1.2.3+. Em um servidor
                    # antigo o parâmetro seria ignorado e o quadro seria substituído.
                    with st.spinner("Verificando o servidor…"):
                        try:
                            info = testar_conexao(url)
                        except Exception as erro:
                            st.error(f"Não foi possível verificar o servidor: {erro}")
                            pode_enviar = False
                        else:
                            if not _versao_ok(info.get("versao"), "1.2.3"):
                                st.error(
                                    "O envio filtrado precisa do Apps Script **1.2.3** ou superior. "
                                    f"Servidor conectado: **{info.get('versao', '?')}**. "
                                    "Publique a nova versão ou escolha **Todo o quadro**."
                                )
                                pode_enviar = False

                if pode_enviar:
                    with st.spinner("Enviando Kanban…"):
                        try:
                            resposta = enviar_kanban(
                                url,
                                usuario,
                                senha,
                                base,
                                resetar,
                                modo="parcial" if parcial else "completo",
                            )
                        except Exception as erro:
                            st.error(f"Falha ao enviar: {erro}")
                        else:
                            if resposta.get("ok"):
                                confs = resposta.get("confeccoes") or []
                                ss[k_ultimo] = {
                                    "total": resposta.get("total", 0),
                                    "enviados": resposta.get("enviados", resposta.get("total", 0)),
                                    "fora": resposta.get("preservados_fora", 0),
                                    "modo": resposta.get("modo", "completo"),
                                    "confeccoes": confs,
                                    "preservados": resposta.get("status_preservados", 0),
                                    "resetado": resposta.get("resetado", False),
                                }
                                mensagem = (
                                    f"✅ Kanban enviado: **{resposta.get('total', 0)}** pedidos no quadro · "
                                    f"**{len(confs)}** confecções · "
                                    f"**{resposta.get('status_preservados', 0)}** status preservados."
                                )
                                if resposta.get("modo") == "parcial":
                                    mensagem += (
                                        f" · **{resposta.get('enviados', 0)}** atualizados"
                                        f" · **{resposta.get('preservados_fora', 0)}** fora do filtro mantidos"
                                    )
                                st.success(mensagem)
                            else:
                                st.error(f"❌ {resposta.get('erro', 'Erro desconhecido')}")

        ultimo = ss.get(k_ultimo)
        if ultimo:
            partes = [
                f"{ultimo.get('total', 0)} pedidos no quadro",
                f"{len(ultimo.get('confeccoes') or [])} confecções",
                f"{ultimo.get('preservados', 0)} status preservados",
            ]
            if ultimo.get("modo") == "parcial":
                partes.append(f"{ultimo.get('enviados', 0)} atualizados")
                partes.append(f"{ultimo.get('fora', 0)} fora do filtro mantidos")
            if ultimo.get("resetado"):
                partes.append("status reiniciados")
            st.info("Último envio nesta sessão: " + " · ".join(partes))

        # ---------------- Códigos de vínculo ----------------
        st.markdown("##### 🔗 Códigos de vínculo das confecções")
        st.caption(
            "Use estes códigos ao cadastrar os usuários em **Visual Kanban → Administração**. "
            "Eles são gerados a partir do nome e permanecem estáveis entre envios. "
            "A tabela lista todas as confecções do quadro, mesmo quando o envio é filtrado."
        )

        tabela = resumo_confeccoes(df_kanban if df_kanban is not None else df_filtrado)
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
