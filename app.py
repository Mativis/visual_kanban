"""Visual Kanban — ponto de entrada no Streamlit.

O painel em si é 100% estático (HTML/CSS/JS) e fica na pasta `static/`.
O Streamlit serve esses arquivos em `/app/static/` (quando
`server.enableStaticServing = true`) e esta página redireciona para o login.

A URL é relativa de propósito: no Streamlit Cloud o app roda dentro de
`/~/+/`, então `app/static/index.html` resolve para o caminho certo tanto
localmente (`/app/static/...`) quanto na nuvem (`/~/+/app/static/...`).
"""

import streamlit as st

st.set_page_config(
    page_title="Visual Kanban",
    page_icon="📋",
    layout="centered",
)

st.markdown(
    '<meta http-equiv="refresh" content="0; url=app/static/index.html?v=1.2.2">',
    unsafe_allow_html=True,
)

st.markdown(
    """
    <div style="text-align:center; padding:48px 16px;">
      <h1 style="margin:0 0 8px;">Visual Kanban</h1>
      <p style="margin:0 0 20px; color:#93a3bd;">Abrindo o painel…</p>
      <p><a href="app/static/index.html?v=1.2.2" target="_self">Abrir o Visual Kanban</a></p>
    </div>
    """,
    unsafe_allow_html=True,
)
