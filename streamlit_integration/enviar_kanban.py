"""
Integração Streamlit -> Visual Kanban (Google Sheets via AppScript).

Uso no kanban_confeccao.py:
    from streamlit_integration.enviar_kanban import botao_enviar_kanban
    botao_enviar_kanban(df_kanban)
"""
import json

import streamlit as st


def _serializar_kanban(df):
    """Converte o DataFrame do Kanban em lista de dicts para envio."""
    if df is None or df.empty:
        return []
    registros = []
    for _, row in df.iterrows():
        rec = {}
        for col in df.columns:
            v = row[col]
            if pd.isna(v) if False else (v is None):
                rec[col] = ""
            elif hasattr(v, "strftime"):
                rec[col] = v.strftime("%d/%m/%Y")
            else:
                try:
                    if float(v) == int(float(v)):
                        rec[col] = int(float(v))
                    else:
                        rec[col] = float(v)
                except (ValueError, TypeError):
                    rec[col] = str(v)
        registros.append(rec)
    return registros


def botao_enviar_kanban(df_kanban, url_appscript=None):
    """Renderiza o botão 'Enviar Kanban' e envia os dados para o Google Sheets."""
    import pandas as pd

    url = url_appscript or st.session_state.get("url_appscript_kanban", "")
    if not url:
        url = st.text_input(
            "URL do AppScript (Visual Kanban)",
            value="",
            key="url_appscript_kanban",
            help="Cole a URL do Web App do Google Apps Script.",
        )

    if st.button("📤 Enviar Kanban para Visualização", key="btn_enviar_kanban"):
        if not url:
            st.error("Informe a URL do AppScript.")
            return
        if df_kanban is None or (hasattr(df_kanban, "empty") and df_kanban.empty):
            st.warning("Nenhum dado de Kanban para enviar.")
            return
        try:
            import requests
            dados = _serializar_kanban(df_kanban)
            payload = {"action": "enviarkanban", "token": st.session_state.get("token_kanban", ""), "dados": dados}
            resp = requests.post(url, json=payload, timeout=60)
            result = resp.json()
            if result.get("ok"):
                st.success(f"✅ Kanban enviado com sucesso! {result.get('total', len(dados))} itens.")
            else:
                st.error(f"❌ Erro: {result.get('error', 'desconhecido')}")
        except Exception as e:
            st.error(f"❌ Falha ao enviar: {e}")
