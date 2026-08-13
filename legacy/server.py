"""
server.py — FastAPI backend para Power BIA.
Arranca con: python3 server.py  (o uvicorn server:app --reload)
"""

import os, pathlib, uuid, json, sqlite3, time
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


# ---------- Persistencia de conversaciones y vistas (SQLite) ----------
# Guarda por session_id (cookie pbi_session) para que sobrevivan a un reinicio del
# servidor o a cambiar de dispositivo — antes solo vivían en localStorage del navegador.

_DB_PATH = pathlib.Path(__file__).parent / "data.db"


def _db() -> sqlite3.Connection:
    conn = sqlite3.connect(_DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def _init_db() -> None:
    conn = _db()
    conn.execute("""CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY, session_id TEXT NOT NULL, ts INTEGER NOT NULL, data TEXT NOT NULL)""")
    conn.execute("""CREATE TABLE IF NOT EXISTS views (
        id TEXT PRIMARY KEY, session_id TEXT NOT NULL, ts INTEGER NOT NULL, data TEXT NOT NULL)""")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_conversations_session ON conversations(session_id)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_views_session ON views(session_id)")
    conn.commit()
    conn.close()


_init_db()


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


def _col_core(nombre: str) -> str:
    """'Calendar[Año#Mes]' / 'Calendar[Año#Mes' / 'Ventas' -> 'año#mes' / 'ventas'."""
    nombre = str(nombre)
    if "[" in nombre:
        nombre = nombre[nombre.rfind("[") + 1:]
    return nombre.rstrip("]").strip().lower()


def _resolver_columna(nombre: str | None, columnas: list[str]) -> str | None:
    """'Calendar[Año#Mes]' o 'Ventas' -> nombre real de columna en el df (o None)."""
    if not nombre:
        return None
    objetivo = _col_core(nombre)
    for c in columnas:
        if _col_core(c) == objetivo:
            return c
    return None


def _rows_a_puntos(sub_df: pd.DataFrame, x_col: str, val_col: str) -> list[dict]:
    return [{"label": str(r[x_col]), "value": float(r[val_col]) if pd.notna(r[val_col]) else 0.0}
            for _, r in sub_df.iterrows()]


def _pivot_largo_a_series(df: pd.DataFrame, x_col: str, serie_col: str, val_col: str) -> list[dict]:
    """DataFrame en formato largo (categoría, serie, valor) -> lista de series {name, data}."""
    labels = df[x_col].astype(str).drop_duplicates().tolist()
    acumulado: dict[str, dict[str, float]] = {}
    orden: list[str] = []
    for _, row in df.iterrows():
        nombre = str(row[serie_col])
        if nombre not in acumulado:
            acumulado[nombre] = {}
            orden.append(nombre)
        v = row[val_col]
        acumulado[nombre][str(row[x_col])] = float(v) if pd.notna(v) else 0.0
    return [
        {"name": nombre, "data": [{"label": l, "value": acumulado[nombre].get(l, 0.0)} for l in labels]}
        for nombre in orden
    ]


_MAX_SERIES = 8  # = longitud de la paleta COLORS del frontend (index.html)


def _limitar_series(series: list[dict], lang: str = "es", max_series: int = _MAX_SERIES) -> tuple[list[dict], str | None]:
    """Si hay más series de las que se pueden colorear/leer, agrupa el resto en 'Otros'."""
    if len(series) <= max_series:
        return series, None
    ordenadas = sorted(series, key=lambda s: -sum(p["value"] for p in s["data"]))
    top = ordenadas[:max_series - 1]
    resto = ordenadas[max_series - 1:]
    labels = [p["label"] for p in series[0]["data"]] if series else []
    otros_vals = {l: 0.0 for l in labels}
    for s in resto:
        for p in s["data"]:
            otros_vals[p["label"]] = otros_vals.get(p["label"], 0.0) + p["value"]
    nombre_otros = "Otros" if lang == "es" else "Other"
    otros = {"name": nombre_otros, "data": [{"label": l, "value": otros_vals[l]} for l in labels]}
    nota = (f"Mostrando las {max_series - 1} categorías principales; el resto agrupado en «Otros»."
            if lang == "es" else
            f"Showing the top {max_series - 1} categories; the rest grouped into \"Other\".")
    return top + [otros], nota


_MAX_X_CATEGORIES = 15         # mismo límite que ya existía para barras/pie de serie única
_MAX_X_PUNTOS_TEMPORAL = 120    # ~10 años mensuales; red de seguridad para series temporales


def _limitar_categorias_por_valor(df: pd.DataFrame, x_col: str, val_col: str, lang: str,
                                  max_cats: int = _MAX_X_CATEGORIES) -> tuple[pd.DataFrame, str | None]:
    """Trunca el eje X a las N categorías con mayor valor total (para ejes NO temporales,
    ej. tienda/producto) — evita mandar miles de puntos que el navegador no puede dibujar."""
    if df[x_col].nunique() <= max_cats:
        return df, None
    top = df.groupby(x_col)[val_col].sum().sort_values(ascending=False).head(max_cats).index
    nota = (f"Mostrando los {max_cats} valores principales del eje." if lang == "es"
            else f"Showing the top {max_cats} axis values.")
    return df[df[x_col].isin(top)], nota


def _limitar_puntos_temporales(df: pd.DataFrame, x_col: str, lang: str,
                               max_puntos: int = _MAX_X_PUNTOS_TEMPORAL) -> tuple[pd.DataFrame, str | None]:
    """Trunca el eje X a los últimos N puntos, preservando el orden (para ejes temporales:
    nunca recortar por valor, o se rompe la continuidad cronológica)."""
    labels = df[x_col].drop_duplicates().tolist()
    if len(labels) <= max_puntos:
        return df, None
    recientes = set(labels[-max_puntos:])
    nota = (f"Mostrando los últimos {max_puntos} periodos." if lang == "es"
            else f"Showing the last {max_puntos} periods.")
    return df[df[x_col].isin(recientes)], nota


def construir_card(df: pd.DataFrame, decision: dict, lang: str = "es", titulo: str | None = None) -> dict | None:
    """Construye la card a partir del DataFrame y la decisión de visualización tomada
    ANTES de generar el DAX. Localiza columnas por nombre (declarado en `decision`), con
    fallback determinista a heurística por posición si el LLM no respetó el alias pedido."""
    if df is None or df.empty:
        return None

    cols = list(df.columns)
    chart_type = decision.get("chart_type") or "table"
    modo = decision.get("modo") or "tabla"

    x_col = _resolver_columna(decision.get("eje_x"), cols)
    serie_col = _resolver_columna(decision.get("columna_serie"), cols)
    val_col = _resolver_columna(decision.get("medida_1"), cols)
    val2_col = _resolver_columna(decision.get("medida_2"), cols)

    num_cols = df.select_dtypes(include="number").columns.tolist()
    cat_cols = [c for c in cols if c not in num_cols]

    if not val_col:
        val_col = num_cols[-1] if num_cols else None
    if not val_col:
        return _df_to_table_card(df, lang)

    titulo_final = titulo or decision.get("titulo_sugerido") or ""

    # 1) KPI: la forma de los datos manda siempre, sea lo que sea que decidiera el LLM.
    if len(df) == 1 and not cat_cols:
        label = titulo_final or _col_label(val_col, lang)
        valor = df[val_col].iloc[0]
        return {"kind": "kpi", "title": label, "sub": None, "unit": None,
                "data": [{"label": label, "value": float(valor) if pd.notna(valor) else 0.0}]}

    # 2) Tabla explícita
    if modo == "tabla" or chart_type == "table":
        return _df_to_table_card(df, lang)

    # Fallback determinista: localizar eje_x por posición si el nombre declarado no existe.
    if not x_col:
        candidatos = [c for c in cat_cols if c != serie_col]
        x_col = candidatos[0] if candidatos else None
    if serie_col and serie_col == x_col:
        serie_col = None
    if not x_col:
        return _df_to_table_card(df, lang)

    base_title = titulo_final or f"{_col_label(val_col, lang)} por {_col_label(x_col, lang)}"

    # 3) Combinado (2 medidas, misma fila)
    if chart_type == "combo":
        if val2_col and val2_col != val_col:
            df_combo, nota_combo = _limitar_puntos_temporales(df, x_col, lang)
            data1 = _rows_a_puntos(df_combo[[x_col, val_col]], x_col, val_col)
            data2 = _rows_a_puntos(df_combo[[x_col, val2_col]], x_col, val2_col)
            titulo_combo = titulo_final or f"{_col_label(val_col, lang)} y {_col_label(val2_col, lang)} por {_col_label(x_col, lang)}"
            return {"kind": "combo", "title": titulo_combo, "sub": nota_combo,
                    "series": [
                        {"name": _col_label(val_col, lang), "type": "bar", "axis": "primary", "data": data1},
                        {"name": _col_label(val2_col, lang), "type": "line", "axis": "secondary", "data": data2},
                    ]}
        chart_type = "line"  # downgrade: no hay segunda medida localizable

    # 4) Multi-serie (multi_line / grouped_bar / stacked_bar) — formato largo
    if chart_type in ("multi_line", "grouped_bar", "stacked_bar"):
        if serie_col:
            # El eje X puede tener cardinalidad enorme (ej. ~1900 tiendas): sin este límite
            # se manda un payload de varios MB que el navegador no puede dibujar. Para ejes
            # temporales (multi_line) se recorta por los últimos periodos, nunca por valor
            # (o se rompe la continuidad cronológica); para categóricos, por valor total.
            if chart_type == "multi_line":
                df_multi, nota_x = _limitar_puntos_temporales(df, x_col, lang)
            else:
                df_multi, nota_x = _limitar_categorias_por_valor(df, x_col, val_col, lang)
            series = _pivot_largo_a_series(df_multi, x_col, serie_col, val_col)
            series, nota_series = _limitar_series(series, lang)
            nota = " ".join(n for n in (nota_x, nota_series) if n) or None
            if series and any(p["value"] for s in series for p in s["data"]):
                card = {"kind": chart_type, "title": base_title, "sub": nota, "series": series}
                if len(series) == 1:
                    card["data"] = series[0]["data"]
                return card
        # downgrade: no hay columna de serie localizable -> equivalente de serie única
        chart_type = "line" if chart_type == "multi_line" else "bar"

    sub = df[[x_col, val_col]].copy()

    # 5) Distribución
    if chart_type == "pie":
        data = sorted(_rows_a_puntos(sub, x_col, val_col), key=lambda d: -d["value"])
        nota = None
        if len(data) > 10:
            nota = "Mostrando las 10 categorías principales." if lang == "es" else "Showing the top 10 categories."
            data = data[:10]
        if sum(d["value"] for d in data) <= 0:
            return _df_to_table_card(df, lang)
        return {"kind": "pie", "title": base_title, "sub": nota, "data": data}

    # 6) Barras (serie única)
    if chart_type == "bar":
        nota = None
        if len(sub) > 15:
            sub = sub.nlargest(15, val_col)
            nota = "Mostrando las 15 categorías principales." if lang == "es" else "Showing the top 15 categories."
        if pd.api.types.is_numeric_dtype(sub[x_col]):
            sub = sub.sort_values(x_col)
        data = _rows_a_puntos(sub, x_col, val_col)
        return {"kind": "bar", "title": base_title, "sub": nota, "series": [{"name": None, "data": data}], "data": data}

    # 7) Línea / área (y cualquier chart_type no reconocido tras los downgrades)
    kind = chart_type if chart_type in ("line", "area") else "line"
    sub, nota_line = _limitar_puntos_temporales(sub, x_col, lang)
    data = _rows_a_puntos(sub, x_col, val_col)
    if len(data) <= 1:
        label = titulo_final or _col_label(val_col, lang)
        valor = data[0]["value"] if data else 0.0
        return {"kind": "kpi", "title": label, "sub": None, "unit": None,
                "data": [{"label": label, "value": valor}]}
    return {"kind": kind, "title": base_title, "sub": nota_line, "series": [{"name": None, "data": data}],
            "data": data, "trend": bool(decision.get("mostrar_tendencia"))}


# ---------- Sugerencias de seguimiento ----------

_FOLLOWUPS_TEMPLATE = [
    {"label": "Desglose", "text": "Desglosa este resultado por categoría"},
    {"label": "Evolución", "text": "Muéstrame la evolución en el tiempo"},
    {"label": "Top 10", "text": "Dame los top 10"},
]


# ---------- Endpoints ----------

_CHART_TYPES = {"kpi", "bar", "line", "pie", "table", "area",
                "multi_line", "grouped_bar", "stacked_bar", "combo"}


def _guardar_aclaracion(session_id: str, pregunta: str, aclaracion: str, tipo: str, decision: dict | None):
    _sessions.setdefault(session_id, []).append({
        "pregunta": pregunta, "dax": None,
        "aclaracion_pendiente": aclaracion, "aclaracion_tipo": tipo,
        "decision_parcial": decision, "columnas": [], "ejemplo": [],
    })
    _sessions[session_id] = _sessions[session_id][-5:]


def _continuar_consulta(pregunta_llm: str, pregunta_session: str, decision: dict,
                        hist: list, session_id: str, lang: str, idioma: str) -> JSONResponse:
    """Capas 2-5 del pipeline: generar DAX (ya con la forma decidida), ejecutar,
    corregir si falla, redactar texto y construir la card."""
    dax = A.generar_dax(pregunta_llm, decision, hist, idioma=idioma)

    if dax.startswith("NECESITA_ACLARACION:"):
        aclaracion = dax.replace("NECESITA_ACLARACION:", "").strip()
        _guardar_aclaracion(session_id, pregunta_session, aclaracion, "texto", decision)
        return JSONResponse({"text": aclaracion, "card": None, "followups": []})

    if dax.startswith("FUERA_DE_RANGO:"):
        cuerpo = dax.replace("FUERA_DE_RANGO:", "").strip()
        return JSONResponse({"text": f"No tengo datos para ese periodo. {cuerpo}", "card": None, "followups": []})

    df, error = A.ejecutar_dax(dax)
    if error:
        print(f"[DAX ERROR] {error}", flush=True)
        print(f"[DAX QUERY] {dax}", flush=True)
        dax2 = A.corregir_dax(pregunta_llm, dax, error, hist, idioma=idioma)
        df2, error2 = A.ejecutar_dax(dax2)
        if not error2:
            dax, df, error = dax2, df2, None
        else:
            print(f"[DAX ERROR 2] {error2}", flush=True)

    if not error and not df.empty:
        _sessions.setdefault(session_id, []).append({
            "pregunta": pregunta_session,
            "dax": dax,
            "decision": decision,
            "columnas": list(df.columns),
            "ejemplo": df.head(3).to_dict(orient="records"),
        })
        _sessions[session_id] = _sessions[session_id][-5:]

    resp_text, title = A.responder_datos(pregunta_llm, dax, df, error, idioma=idioma)
    card = construir_card(df, decision, lang=lang, titulo=title or decision.get("titulo_sugerido")) if not error else None
    return JSONResponse({"text": resp_text, "card": card, "followups": [], "dax": dax})


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
    choice_id: str | None = body.get("choice_id")
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
    last_entry = hist_assistant[-1] if hist_assistant else None
    pending = last_entry if (last_entry and last_entry.get("aclaracion_pendiente")) else None

    # Resolución determinista de una aclaración VISUAL (clic en un botón "choice"),
    # sin volver a llamar al LLM.
    if pending and pending.get("aclaracion_tipo") == "visual" and choice_id:
        decision_parcial = dict(pending.get("decision_parcial") or {})
        opciones = decision_parcial.get("opciones_aclaracion") or []
        opt = next((o for o in opciones if o.get("id") == choice_id), None)
        if opt:
            decision_parcial[opt["campo"]] = opt["valor"]
            decision_parcial["necesita_aclaracion"] = False
            pending["aclaracion_pendiente"] = None
            if forced_chart_type and forced_chart_type in _CHART_TYPES:
                decision_parcial["chart_type"] = forced_chart_type
            return _continuar_consulta(pending["pregunta"], pending["pregunta"], decision_parcial,
                                       hist_assistant, session_id, lang, idioma)

    intencion = A.enrutar(effective_text)

    # Si el último turno era una aclaración pendiente (texto o visual sin clic), la
    # respuesta del usuario SIEMPRE es la continuación de esa aclaración — sea lo que
    # sea que el enrutador crea que es (p. ej. "tienda" clasifica como FILTRO, pero
    # aquí es la respuesta a "¿cada tienda como cliente?").
    if pending:
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

    # GRAFICO_PREVIO: redibujar el último resultado con el tipo que pide el usuario.
    # decidir_visualizacion() ya conoce las columnas cacheadas; solo re-consulta si
    # la decisión necesita una columna que no estaba en el resultado anterior.
    last_with_dax = next((e for e in reversed(hist_assistant) if e.get("dax")), None)
    if intencion == "GRAFICO_PREVIO" and last_with_dax:
        cache_cols = last_with_dax.get("columnas") or []
        decision = A.decidir_visualizacion(text, hist_assistant, idioma=idioma,
                                           columnas_disponibles=cache_cols)
        if forced_chart_type and forced_chart_type in _CHART_TYPES:
            decision["chart_type"] = forced_chart_type
            decision["modo"] = "tabla" if forced_chart_type == "table" else "grafico"

        requeridas = [decision.get("eje_x"), decision.get("columna_serie"),
                      decision.get("medida_1"), decision.get("medida_2")]
        puede_reusar = all((not r) or _resolver_columna(r, cache_cols) is not None for r in requeridas)

        if puede_reusar:
            df, error = A.ejecutar_dax(last_with_dax["dax"])
        else:
            dax_nuevo = A.generar_dax(text, decision, hist_assistant, idioma=idioma)
            df, error = A.ejecutar_dax(dax_nuevo)

        if not error and not df.empty:
            card = construir_card(df, decision, lang=lang, titulo=decision.get("titulo_sugerido"))
            msg = ("Here are your previous results in that format." if lang == "en"
                   else "Aquí tienes los datos de tu consulta anterior en ese formato.")
            return JSONResponse({"text": msg, "card": card, "followups": []})

    # CONSULTA o SEGUIMIENTO (y GRAFICO_PREVIO sin historial reutilizable)
    decision = A.decidir_visualizacion(effective_text, hist_assistant, idioma=idioma)
    if forced_chart_type and forced_chart_type in _CHART_TYPES:
        decision["chart_type"] = forced_chart_type
        decision["modo"] = "tabla" if forced_chart_type == "table" else "grafico"

    if decision.get("necesita_aclaracion"):
        tipo_acl = decision.get("tipo_aclaracion") or "texto"
        pregunta_acl = decision.get("pregunta_aclaracion") or (
            "How would you like to see it?" if lang == "en" else "¿Cómo quieres verlo?")
        _guardar_aclaracion(session_id, text, pregunta_acl, tipo_acl, decision)
        if tipo_acl == "visual" and decision.get("opciones_aclaracion"):
            card = {"kind": "choice", "title": pregunta_acl, "sub": None,
                    "options": [{"id": o["id"], "label": o["label"]} for o in decision["opciones_aclaracion"]]}
            return JSONResponse({"text": pregunta_acl, "card": card, "followups": []})
        return JSONResponse({"text": pregunta_acl, "card": None, "followups": []})

    return _continuar_consulta(effective_text, text, decision, hist_assistant, session_id, lang, idioma)


# ---------- Persistencia: conversaciones y vistas ----------
# Workspace único y compartido: todo el mundo que entra a la web ve las mismas
# conversaciones y vistas (no hay separación por usuario/cookie). El primer arranque
# con la base de datos vacía precarga contenido real (ver _seed_demo_data más abajo).

_SHARED_WORKSPACE = "shared"


@app.get("/api/conversations")
async def listar_conversaciones():
    conn = _db()
    rows = conn.execute(
        "SELECT data FROM conversations WHERE session_id = ? ORDER BY ts DESC", (_SHARED_WORKSPACE,)
    ).fetchall()
    conn.close()
    return JSONResponse([json.loads(r["data"]) for r in rows])


@app.put("/api/conversations/{conv_id}")
async def guardar_conversacion(conv_id: str, request: Request):
    body = await request.json()
    body["id"] = conv_id
    ts = int(body.get("ts") or time.time() * 1000)
    conn = _db()
    conn.execute(
        "INSERT INTO conversations (id, session_id, ts, data) VALUES (?, ?, ?, ?) "
        "ON CONFLICT(id) DO UPDATE SET ts = excluded.ts, data = excluded.data",
        (conv_id, _SHARED_WORKSPACE, ts, json.dumps(body)),
    )
    conn.commit()
    conn.close()
    return JSONResponse({"ok": True})


@app.delete("/api/conversations/{conv_id}")
async def eliminar_conversacion(conv_id: str):
    conn = _db()
    conn.execute("DELETE FROM conversations WHERE id = ?", (conv_id,))
    conn.commit()
    conn.close()
    return JSONResponse({"ok": True})


@app.get("/api/views")
async def listar_vistas():
    conn = _db()
    rows = conn.execute(
        "SELECT data FROM views WHERE session_id = ? ORDER BY ts ASC", (_SHARED_WORKSPACE,)
    ).fetchall()
    conn.close()
    return JSONResponse([json.loads(r["data"]) for r in rows])


@app.put("/api/views/{view_id}")
async def guardar_vista(view_id: str, request: Request):
    body = await request.json()
    body["id"] = view_id
    ts = int(body.get("ts") or time.time() * 1000)
    conn = _db()
    conn.execute(
        "INSERT INTO views (id, session_id, ts, data) VALUES (?, ?, ?, ?) "
        "ON CONFLICT(id) DO UPDATE SET data = excluded.data",
        (view_id, _SHARED_WORKSPACE, ts, json.dumps(body)),
    )
    conn.commit()
    conn.close()
    return JSONResponse({"ok": True})


@app.delete("/api/views/{view_id}")
async def eliminar_vista(view_id: str):
    conn = _db()
    conn.execute("DELETE FROM views WHERE id = ?", (view_id,))
    conn.commit()
    conn.close()
    return JSONResponse({"ok": True})


# ---------- Datos de ejemplo reales (solo si el workspace compartido está vacío) ----------
# Ejecuta el pipeline completo (igual que /api/chat) contra Power BI real para que
# cualquiera que entre por primera vez a la web vea conversaciones y una vista con
# datos genuinos, no vacíos ni inventados. Solo corre una vez: si ya hay contenido
# guardado (persistido en data.db), no vuelve a llamar a OpenAI/Power BI en cada arranque.

_SEED_PREGUNTAS = [
    ("¿Cuál es la tendencia de botellas vendidas en 2020 por mes?", "es"),
    ("Compara el precio medio por mes entre 2020 y 2021", "es"),
    ("Top 10 categorías por botellas vendidas en 2021", "es"),
]


def _workspace_vacio() -> bool:
    conn = _db()
    n = conn.execute(
        "SELECT COUNT(*) FROM conversations WHERE session_id = ?", (_SHARED_WORKSPACE,)
    ).fetchone()[0]
    conn.close()
    return n == 0


def _guardar_registro(tabla: str, obj: dict, ts: int) -> None:
    conn = _db()
    conn.execute(
        f"INSERT INTO {tabla} (id, session_id, ts, data) VALUES (?, ?, ?, ?) "
        "ON CONFLICT(id) DO UPDATE SET ts = excluded.ts, data = excluded.data",
        (obj["id"], _SHARED_WORKSPACE, ts, json.dumps(obj)),
    )
    conn.commit()
    conn.close()


def _responder_pregunta_seed(pregunta: str, lang: str) -> dict | None:
    idioma = "inglés" if lang == "en" else "español"
    try:
        decision = A.decidir_visualizacion(pregunta, idioma=idioma)
        dax = A.generar_dax(pregunta, decision, idioma=idioma)
        df, error = A.ejecutar_dax(dax)
        if error or df.empty:
            print(f"[SEED] Sin datos para '{pregunta}': {error}", flush=True)
            return None
        texto, titulo = A.responder_datos(pregunta, dax, df, error, idioma=idioma)
        card = construir_card(df, decision, lang=lang, titulo=titulo or decision.get("titulo_sugerido"))
        if not card:
            return None
        return {"card": card, "dax": dax, "texto": texto}
    except Exception as e:
        print(f"[SEED] Error generando '{pregunta}': {e}", flush=True)
        return None


def _seed_demo_data() -> None:
    if not _workspace_vacio():
        return
    print("[SEED] Workspace compartido vacío: generando conversaciones y vista de ejemplo con datos reales...", flush=True)
    resultados = []
    for pregunta, lang in _SEED_PREGUNTAS:
        r = _responder_pregunta_seed(pregunta, lang)
        if not r:
            continue
        resultados.append(r)
        ts = int(time.time() * 1000)
        conv = {
            "id": "seed-" + uuid.uuid4().hex[:8],
            "title": pregunta[:48],
            "ts": ts,
            "msgs": [
                {"role": "user", "text": pregunta, "ts": ts},
                {"role": "bot", "text": r["texto"], "card": r["card"], "dax": r["dax"],
                 "followups": [], "ts": ts + 1},
            ],
        }
        _guardar_registro("conversations", conv, ts)

    if resultados:
        ts = int(time.time() * 1000)
        w_, h_, gap, cols = 480, 300, 24, 2
        widgets = [
            {"id": f"w{i}", "card": r["card"],
             "x": 20 + (i % cols) * (w_ + gap), "y": 20 + (i // cols) * (h_ + gap),
             "w": w_, "h": h_}
            for i, r in enumerate(resultados)
        ]
        vista = {"id": "seed-" + uuid.uuid4().hex[:8], "name": "Resumen Iowa Liquor Sales", "widgets": widgets}
        _guardar_registro("views", vista, ts)
    print(f"[SEED] Generadas {len(resultados)} conversaciones de ejemplo.", flush=True)


_seed_demo_data()


# ---------- Arranque ----------

if __name__ == "__main__":
    (uvicorn.run
     (app, host="0.0.0.0", port=8000, reload=False))
