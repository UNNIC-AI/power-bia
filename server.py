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
    return _HTML_PATH.read_text(encoding="utf-8")


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


_COL_ES = {
    "Store Name": "Tienda", "Category Name": "Categoría", "Vendor Name": "Proveedor",
    "City": "Ciudad", "County": "Condado", "State": "Estado",
    "Bottles Sold": "Botellas vendidas", "Invoice": "Factura",
    "Invoice Date": "Fecha factura", "Description": "Descripción",
    "Retail Price": "Precio retail", "Bottle Cost": "Coste botella",
    "AñoMesCorto": "Mes", "Año Mes": "Año/Mes", "Año": "Año",
    "Mes": "Mes", "Trimestre": "Trimestre", "Fecha": "Fecha",
    "Zip Code": "Código postal", "Address": "Dirección",
    "Category": "Categoría", "Vendor": "Proveedor", "Store": "Tienda",
}

def _col_label(col: str, lang: str = "es") -> str:
    """'Calendar[#Año]' → 'Año' (es) o 'Year' (en)"""
    if '[' in col:
        col = col[col.rfind('['):]
    col = col.strip('[]').replace('#', '').replace('_', ' ').strip()
    if lang == "es":
        return _COL_ES.get(col, col)
    return col


def _df_to_table_card(df: pd.DataFrame, lang: str = "es") -> dict:
    cols = [_col_label(c, lang) for c in df.columns]
    rows = [[_fmt(v) for v in row] for _, row in df.head(1000).iterrows()]
    return {"kind": "table", "title": None, "sub": None, "cols": cols, "rows": rows}


def _df_to_card(df: pd.DataFrame, chart_type: str = "table", title: str = "", lang: str = "es") -> dict | None:
    """Construye la card según el chart_type y título decididos por el LLM."""
    if df.empty:
        return None
    num_cols = df.select_dtypes(include="number").columns.tolist()
    cat_cols = [c for c in df.columns if c not in num_cols]

    # KPI: forma de los datos manda siempre
    if not cat_cols and len(num_cols) == 1 and len(df) == 1:
        label = title or _col_label(num_cols[0], lang)
        return {"kind": "kpi", "title": label, "sub": None, "unit": None,
                "data": [{"label": label, "value": float(df[num_cols[0]].iloc[0])}]}

    if not num_cols:
        return _df_to_table_card(df, lang)

    y = num_cols[-1]
    x = cat_cols[0] if cat_cols else None
    card_title = title or f"{_col_label(y, lang)} por {_col_label(x, lang)}"

    if chart_type == "pie" and x:
        data = sorted(
            [{"label": str(row[x]), "value": float(row[y]) if pd.notna(row[y]) else 0}
             for _, row in df.iterrows()],
            key=lambda d: -d["value"]
        )[:10]
        if sum(d["value"] for d in data) > 0:
            return {"kind": "pie", "title": card_title, "sub": None, "data": data}

    if chart_type in ("bar", "line") and x:
        if chart_type == "bar":
            df = df.nlargest(15, y)
        data = [{"label": str(row[x]), "value": float(row[y]) if pd.notna(row[y]) else 0}
                for _, row in df.iterrows()]
        return {"kind": chart_type, "title": card_title, "sub": None, "data": data}

    return _df_to_table_card(df, lang)


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
    lang: str = body.get("lang", "es")
    filters: list = body.get("filters", [])
    forced_chart_type: str | None = body.get("chart_type")
    idioma = "inglés" if lang == "en" else "español"

    # Build natural-language filter context to inject into LLM queries
    filter_ctx = ""
    if filters:
        parts = [
            f"{f['column']}: {', '.join(str(v) for v in f['values'][:20])}"
            for f in filters if f.get("values")
        ]
        if parts:
            filter_ctx = " (filtros activos: " + "; ".join(parts) + ")"
    effective_text = text + filter_ctx

    if not text:
        return JSONResponse({"text": "", "card": None, "followups": []})

    # Historial rico almacenado en sesión (igual que historial_datos de Streamlit)
    session_id = pbi_session or "default"
    hist_assistant = _sessions.get(session_id, [])

    intencion = A.enrutar(effective_text)

    # Si el último turno era una aclaración pendiente, la respuesta del usuario
    # siempre es un seguimiento — aunque parezca CONVERSACION al router.
    last_entry = hist_assistant[-1] if hist_assistant else None
    if last_entry and last_entry.get("aclaracion_pendiente") and intencion == "CONVERSACION":
        intencion = "SEGUIMIENTO"

    if intencion == "CONVERSACION":
        resp_text = A.responder_conversacion(text, idioma=idioma)
        return JSONResponse({"text": resp_text, "card": None, "followups": []})

    if intencion == "FILTRO":
        col_info = A.identificar_columna_filtro(text, idioma=idioma)
        dax_distinct = col_info.get("dax", f"EVALUATE DISTINCT('{col_info['tabla']}'[{col_info['columna']}])")
        df_f, err_f = A.ejecutar_dax(dax_distinct)
        if not err_f and not df_f.empty:
            vals = sorted(df_f.iloc[:, 0].dropna().astype(str).tolist())[:100]
            titulo = col_info.get("titulo", col_info.get("columna", "Filtro"))
            card = {"kind": "filter", "title": titulo,
                    "column": col_info.get("columna", ""), "values": vals, "selected": []}
            msg = (f"Filter '{titulo}' created." if lang == "en"
                   else f"Filtro '{titulo}' creado con {len(vals)} valores.")
            return JSONResponse({"text": msg, "card": card, "followups": []})
        return JSONResponse({"text": "No pude obtener los valores para ese filtro.", "card": None, "followups": []})

    # GRAFICO_PREVIO: redibujar el último resultado con el tipo que pide el usuario
    last_with_dax = next((e for e in reversed(hist_assistant) if e.get("dax")), None)
    if intencion == "GRAFICO_PREVIO" and last_with_dax:
        last = last_with_dax
        df, error = A.ejecutar_dax(last["dax"])
        if not error and not df.empty:
            chart_type = A.decidir_tipo_grafico(text, list(df.columns))
            card = _df_to_card(df, chart_type, lang=lang)
            msg = "Here are your previous results in that format." if lang == "en" \
                  else "Aquí tienes los datos de tu consulta anterior en ese formato."
            return JSONResponse({"text": msg, "card": card, "followups": []})

    # CONSULTA o SEGUIMIENTO (y GRAFICO_PREVIO sin historial)
    dax = A.generar_dax(effective_text, hist_assistant, idioma=idioma)

    if dax.startswith("NECESITA_ACLARACION:"):
        aclaracion = dax.replace("NECESITA_ACLARACION:", "").strip()
        # Guardar en historial para que la siguiente respuesta del usuario tenga contexto
        _sessions.setdefault(session_id, []).append({
            "pregunta": text,
            "dax": None,
            "aclaracion_pendiente": aclaracion,
            "columnas": [],
            "ejemplo": [],
        })
        _sessions[session_id] = _sessions[session_id][-5:]
        return JSONResponse({"text": aclaracion, "card": None, "followups": []})

    if dax.startswith("FUERA_DE_RANGO:"):
        cuerpo = dax.replace("FUERA_DE_RANGO:", "").strip()
        return JSONResponse({"text": f"No tengo datos para ese periodo. {cuerpo}", "card": None, "followups": []})

    df, error = A.ejecutar_dax(dax)
    if error:
        print(f"[DAX ERROR] {error}", flush=True)
        print(f"[DAX QUERY] {dax}", flush=True)
        dax2 = A.corregir_dax(effective_text, dax, error, hist_assistant, idioma=idioma)
        df2, error2 = A.ejecutar_dax(dax2)
        if not error2:
            dax, df, error = dax2, df2, None
        else:
            print(f"[DAX ERROR 2] {error2}", flush=True)

    if not error and not df.empty:
        _sessions.setdefault(session_id, []).append({
            "pregunta": text,
            "dax": dax,
            "columnas": list(df.columns),
            "ejemplo": df.head(3).to_dict(orient="records"),
        })
        _sessions[session_id] = _sessions[session_id][-5:]

    resp_text, chart_type, chart_title = A.responder_datos(effective_text, dax, df, error, idioma=idioma)
    if forced_chart_type and forced_chart_type in {"kpi", "bar", "line", "pie", "table"}:
        chart_type = forced_chart_type
    card = _df_to_card(df, chart_type, chart_title, lang=lang) if not error else None
    return JSONResponse({"text": resp_text, "card": card, "followups": []})


# ---------- Arranque ----------

if __name__ == "__main__":
    (uvicorn.run
     (app, host="0.0.0.0", port=8000, reload=False))
