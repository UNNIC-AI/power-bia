"""
server.py — FastAPI backend para Power BIA.
Arranca con: python3 server.py  (o uvicorn server:app --reload)
"""

import os, pathlib, uuid
from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI, Request, Cookie
from fastapi.responses import HTMLResponse, JSONResponse
import uvicorn

import assistant as A
import pandas as pd

app = FastAPI()

_sessions: dict[str, list] = {}
_HTML_PATH = pathlib.Path(__file__).parent / "index.html"
_HTML_CACHE: str | None = None

def _html() -> str:
    global _HTML_CACHE
    if _HTML_CACHE is None:
        _HTML_CACHE = _HTML_PATH.read_text(encoding="utf-8")
    return _HTML_CACHE


# ---------- Conversión DataFrame → card ----------

def _fmt(v) -> str:
    if pd.isna(v):
        return ""
    if isinstance(v, float):
        if v == int(v):
            return f"{int(v):,}"
        return f"{v:,.2f}"
    if isinstance(v, int):
        return f"{v:,}"
    return str(v)


def _df_to_table_card(df: pd.DataFrame) -> dict:
    cols = df.columns.tolist()
    rows = [[ _fmt(v) for v in row] for _, row in df.head(50).iterrows()]
    return {"kind": "table", "title": None, "sub": None, "cols": cols, "rows": rows}


def _df_to_card(df: pd.DataFrame, pregunta: str, quiere_grafico: bool = False) -> dict | None:
    if df.empty:
        return None
    num_cols = df.select_dtypes(include="number").columns.tolist()
    cat_cols = [c for c in df.columns if c not in num_cols]

    # KPI: una sola celda numérica → siempre mostrar como KPI
    if not cat_cols and len(num_cols) == 1 and len(df) == 1:
        return {"kind": "kpi", "title": num_cols[0], "sub": None, "unit": None,
                "data": [{"label": num_cols[0], "value": float(df[num_cols[0]].iloc[0])}]}

    # Sin columnas numéricas → tabla siempre
    if not num_cols:
        return _df_to_table_card(df)

    # Solo tabla a menos que el usuario pida explícitamente un gráfico
    if not quiere_grafico:
        return _df_to_table_card(df)

    # Gráfico: necesitamos al menos una columna categórica
    if not cat_cols:
        return _df_to_table_card(df)

    y = num_cols[-1]
    x = cat_cols[0]
    is_temporal = any(t in x.lower() for t in
                      ["mes", "año", "fecha", "periodo", "trimestre", "semana", "dia", "month", "year"])

    # Para gráficos de barras con muchos items: top 12 ordenado por valor
    if not is_temporal:
        df = df.nlargest(12, y)

    data = [{"label": str(row[x]), "value": float(row[y]) if pd.notna(row[y]) else 0}
            for _, row in df.iterrows()]
    kind = "line" if is_temporal else "bar"
    return {"kind": kind, "title": f"{y} por {x}", "sub": None, "data": data}


# ---------- Sugerencias de seguimiento ----------

_FOLLOWUPS_TEMPLATE = [
    {"label": "Desglose", "text": "Desglosa este resultado por categoría"},
    {"label": "Evolución", "text": "Muéstrame la evolución en el tiempo"},
    {"label": "Top 10", "text": "Dame los top 10"},
]


# ---------- Endpoints ----------

@app.get("/", response_class=HTMLResponse)
async def root(pbi_session: str = Cookie(default=None)):
    resp = HTMLResponse(_html())
    if not pbi_session:
        resp.set_cookie("pbi_session", str(uuid.uuid4()), httponly=True, samesite="strict")
    return resp


@app.post("/api/chat")
async def chat(request: Request, pbi_session: str = Cookie(default=None)):
    body = await request.json()
    text: str = body.get("text", "").strip()

    if not text:
        return JSONResponse({"text": "", "card": None, "followups": []})

    # Historial rico almacenado en sesión (igual que historial_datos de Streamlit)
    session_id = pbi_session or "default"
    hist_assistant = _sessions.get(session_id, [])

    intencion = A.enrutar(text)

    if intencion == "CONVERSACION":
        resp_text = A.responder_conversacion(text)
        return JSONResponse({"text": resp_text, "card": None, "followups": []})

    # CONSULTA o SEGUIMIENTO
    dax = A.generar_dax(text, hist_assistant)

    if dax.startswith("NECESITA_ACLARACION:"):
        aclaracion = dax.replace("NECESITA_ACLARACION:", "").strip()
        return JSONResponse({"text": aclaracion, "card": None, "followups": []})

    if dax.startswith("FUERA_DE_RANGO:"):
        cuerpo = dax.replace("FUERA_DE_RANGO:", "").strip()
        return JSONResponse({"text": f"No tengo datos para ese periodo. {cuerpo}", "card": None, "followups": []})

    df, error = A.ejecutar_dax(dax)
    if error:
        dax2 = A.corregir_dax(text, dax, error, hist_assistant)
        df2, error2 = A.ejecutar_dax(dax2)
        if not error2:
            dax, df, error = dax2, df2, None

    # Guardar contexto rico en sesión (igual que Streamlit)
    if not error and not df.empty:
        _sessions.setdefault(session_id, []).append({
            "pregunta": text,
            "dax": dax,
            "columnas": list(df.columns),
            "ejemplo": df.head(3).to_dict(orient="records"),
        })
        _sessions[session_id] = _sessions[session_id][-5:]

    quiere_grafico = any(p in text.lower() for p in ["gráfic", "grafic", "evolución", "evolucion", "tendencia"])
    resp_text = A.responder_datos(text, dax, df, error, quiere_grafico)
    card = _df_to_card(df, text, quiere_grafico) if not error else None

    followups = _FOLLOWUPS_TEMPLATE[:2] if not error and not df.empty else []

    return JSONResponse({"text": resp_text, "card": card, "followups": followups})


# ---------- Arranque ----------

if __name__ == "__main__":
    (uvicorn.run
     (app, host="0.0.0.0", port=8000, reload=False))
