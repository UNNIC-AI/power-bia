"""
assistant.py
============
El pipeline del asistente, organizado en capas con responsabilidades claras.

    enrutar()         -> clasifica la intención (reemplaza es_consulta_datos + keywords)
    generar_dax()     -> traduce a DAX
    ejecutar_dax()    -> ejecuta contra Power BI (determinista, sin IA)
    corregir_dax()    -> arregla DAX fallido con el error
    responder_datos() -> interpreta el resultado
    responder_conversacion()

La capa Streamlit (app.py) solo orquesta llamadas a estas funciones y pinta.
Toda decisión de intención se toma aquí, no con palabras clave en la UI.
"""

import pandas as pd
from openai import OpenAI

from system_context import construir_system, ROL_ENRUTADOR, ROL_GENERADOR, \
    ROL_CORRECTOR, ROL_REDACTOR, ROL_CONVERSACION, ROL_DECISOR_VISUALIZACION, \
    ROL_IDENTIFICADOR_FILTRO

# --- Configuración -------------------------------------------------------

# NOTA: la API key NO debe ir hardcodeada. Se lee de variable de entorno
# (OPENAI_API_KEY), cargada desde un archivo .env si existe.
import os
from dotenv import load_dotenv
load_dotenv()  # carga el .env de la carpeta, si está presente

_api_key = os.environ.get("OPENAI_API_KEY")
if not _api_key:
    raise RuntimeError(
        "Falta OPENAI_API_KEY. Defínela en un archivo .env o como variable de entorno."
    )
cliente = OpenAI(api_key=_api_key)

MODELO_LLM = "gpt-4.1"   # actualizado desde gpt-4o

import re
import json as _json_stdlib
import requests
import msal

CONNECTION_STRING = os.environ.get("PBI_CONNECTION_STRING", "")
if not CONNECTION_STRING:
    raise RuntimeError(
        "Falta PBI_CONNECTION_STRING. Defínela en el archivo .env o como variable de entorno."
    )

# Extraer credenciales del connection string (formato XMLA con Service Principal)
def _parse_cs():
    uid = re.search(r"User ID=app:([^@]+)@([^;]+)", CONNECTION_STRING, re.I)
    pwd = re.search(r"Password=([^;]+)", CONNECTION_STRING, re.I)
    ds  = re.search(r"Data Source=powerbi://api\.powerbi\.com/v1\.0/myorg/([^;]+)", CONNECTION_STRING, re.I)
    ic  = re.search(r"Initial Catalog=([^;]+)", CONNECTION_STRING, re.I)
    return uid.group(1), uid.group(2), pwd.group(1), ds.group(1), ic.group(1).strip()

_CLIENT_ID, _TENANT_ID, _CLIENT_SECRET, _WORKSPACE_NAME, _DATASET_NAME = _parse_cs()

# Cache de token y IDs para no repetir llamadas
_token_cache: dict = {}
_pbi_ids: dict = {}

def _get_token(scope: str = "https://analysis.windows.net/powerbi/api/.default") -> str:
    app = msal.ConfidentialClientApplication(
        _CLIENT_ID,
        authority=f"https://login.microsoftonline.com/{_TENANT_ID}",
        client_credential=_CLIENT_SECRET,
        token_cache=msal.SerializableTokenCache(),
    )
    result = app.acquire_token_for_client(scopes=[scope])
    if "access_token" not in result:
        raise RuntimeError(f"Error obteniendo token Azure AD: {result.get('error_description')}")
    return result["access_token"]

def _get_pbi_ids() -> tuple[str, str]:
    if _pbi_ids:
        return _pbi_ids["workspace_id"], _pbi_ids["dataset_id"]
    token = _get_token()
    headers = {"Authorization": f"Bearer {token}"}

    groups = requests.get("https://api.powerbi.com/v1.0/myorg/groups", headers=headers).json()
    workspace = next(g for g in groups["value"] if g["name"] == _WORKSPACE_NAME)
    wid = workspace["id"]

    datasets = requests.get(f"https://api.powerbi.com/v1.0/myorg/groups/{wid}/datasets", headers=headers).json()
    dataset = next(d for d in datasets["value"] if d["name"] == _DATASET_NAME)
    did = dataset["id"]

    _pbi_ids["workspace_id"] = wid
    _pbi_ids["dataset_id"] = did
    return wid, did


# --- Utilidad de llamada al LLM -----------------------------------------

def _chat(system: str, user: str) -> str:
    resp = cliente.chat.completions.create(
        model=MODELO_LLM,
        temperature=0,
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
    )
    return resp.choices[0].message.content.strip()


def _chat_json(system: str, user: str, json_schema: dict, schema_name: str) -> dict:
    """Como _chat(), pero fuerza structured output (JSON Schema strict) — sin parseo regex."""
    resp = cliente.chat.completions.create(
        model=MODELO_LLM,
        temperature=0,
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        response_format={
            "type": "json_schema",
            "json_schema": {"name": schema_name, "schema": json_schema, "strict": True},
        },
    )
    return _json_stdlib.loads(resp.choices[0].message.content)


def _limpiar_dax(texto: str) -> str:
    return texto.replace("```DAX", "").replace("```dax", "").replace("```", "").strip()


def _parchear_dax(dax: str) -> str:
    """
    Corrección determinista de errores DAX frecuentes del LLM, sin llamar al modelo.

    Caso: SUMMARIZECOLUMNS sin columna de agrupación — el LLM pone una medida
    como primer argumento:
      SUMMARIZECOLUMNS("Nombre", expr, FILTER(...))
    → se convierte a:
      ROW("Nombre", CALCULATE(expr, FILTER(...)))
    """
    import re as _re
    # Detecta: SUMMARIZECOLUMNS( seguido de una cadena literal (medida) como 1er arg
    m = _re.match(
        r'(?i)(EVALUATE\s+)?SUMMARIZECOLUMNS\s*\(\s*"([^"]+)"\s*,\s*(.+)\)\s*$',
        dax.strip(),
        flags=_re.DOTALL,
    )
    if m:
        nombre = m.group(2)
        resto = m.group(3).strip()
        # Separar expresión de medida del FILTER (si lo hay)
        # Heurística: si hay FILTER(...) al final, usarlo como contexto de CALCULATE
        filtro_m = _re.search(r',\s*(FILTER\s*\(.+\))\s*$', resto, flags=_re.DOTALL)
        if filtro_m:
            expr = resto[:filtro_m.start()].strip().rstrip(',').strip()
            filtro = filtro_m.group(1).strip()
            return f'EVALUATE\nROW("{nombre}", CALCULATE({expr}, {filtro}))'
        else:
            return f'EVALUATE\nROW("{nombre}", {resto})'
    return dax


# --- Capa 1: enrutado ----------------------------------------------------

def enrutar(pregunta: str) -> str:
    """Devuelve: CONVERSACION | CONSULTA | GRAFICO_PREVIO | SEGUIMIENTO."""
    system = construir_system(ROL_ENRUTADOR)
    categoria = _chat(system, pregunta).upper().strip()
    validas = {"CONVERSACION", "CONSULTA", "GRAFICO_PREVIO", "SEGUIMIENTO", "FILTRO"}
    # Defensa: si el modelo devuelve algo raro, tratamos como consulta.
    return categoria if categoria in validas else "CONSULTA"


# --- Capa 1.5: decisión de visualización ---------------------------------

_DECISION_VISUALIZACION_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": [
        "modo", "chart_type", "eje_x", "columna_serie",
        "medida_1", "medida_2", "mostrar_tendencia",
        "necesita_aclaracion", "tipo_aclaracion",
        "pregunta_aclaracion", "opciones_aclaracion",
        "titulo_sugerido",
    ],
    "properties": {
        "modo": {"type": "string", "enum": ["tabla", "grafico"]},
        "chart_type": {"type": "string", "enum": [
            "table", "kpi", "bar", "line", "pie", "area",
            "multi_line", "grouped_bar", "stacked_bar", "combo",
        ]},
        "eje_x": {"type": ["string", "null"]},
        "columna_serie": {"type": ["string", "null"]},
        "medida_1": {"type": "string"},
        "medida_2": {"type": ["string", "null"]},
        "mostrar_tendencia": {"type": "boolean"},
        "necesita_aclaracion": {"type": "boolean"},
        "tipo_aclaracion": {"type": ["string", "null"], "enum": ["texto", "visual", None]},
        "pregunta_aclaracion": {"type": ["string", "null"]},
        "opciones_aclaracion": {
            "type": ["array", "null"],
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["id", "label", "campo", "valor"],
                "properties": {
                    "id": {"type": "string"},
                    "label": {"type": "string"},
                    "campo": {"type": "string", "enum": ["chart_type", "eje_x", "columna_serie"]},
                    "valor": {"type": "string"},
                },
            },
        },
        "titulo_sugerido": {"type": "string"},
    },
}

_DECISION_DEFAULT = {
    "modo": "tabla", "chart_type": "table", "eje_x": None, "columna_serie": None,
    "medida_1": "Ventas", "medida_2": None, "mostrar_tendencia": False,
    "necesita_aclaracion": False,
    "tipo_aclaracion": None, "pregunta_aclaracion": None, "opciones_aclaracion": None,
    "titulo_sugerido": "",
}


def decidir_visualizacion(pregunta: str, historial: list | None = None,
                          idioma: str = "español",
                          columnas_disponibles: list[str] | None = None) -> dict:
    """Decide modo/tipo de gráfico y columnas ANTES de generar el DAX."""
    system = construir_system(ROL_DECISOR_VISUALIZACION, incluir_esquema=True, idioma=idioma)
    contexto = (historial or [])[-5:]
    extra = ""
    if columnas_disponibles:
        extra = (f"\nColumnas YA disponibles de una consulta anterior (sin volver a consultar "
                 f"Power BI si tu decisión puede satisfacerse solo con ellas): {columnas_disponibles}")
    user = f"""Contexto reciente de consultas:
{contexto}

Pregunta actual:
{pregunta}{extra}

Decide la visualización."""
    try:
        return _chat_json(system, user, _DECISION_VISUALIZACION_SCHEMA, "decision_visualizacion")
    except Exception:
        return dict(_DECISION_DEFAULT)


def _render_forma_requerida(decision: dict) -> str:
    if decision.get("modo") == "tabla" or decision.get("chart_type") == "table":
        return ("Resultado esperado: tabla/listado. No hay una forma de datos concreta que "
                "respetar — genera el DAX que responda directamente a la pregunta.")
    ct = decision.get("chart_type")
    lineas = [f"Forma de datos requerida (chart_type={ct}):",
              f"  - Eje X / categoría: {decision.get('eje_x') or '(ninguno, resultado de una sola fila)'}"]
    if decision.get("columna_serie"):
        lineas.append(f"  - Columna de serie: {decision['columna_serie']}")
        lineas.append("  - Genera el DAX en FORMATO LARGO: una fila por cada combinación de "
                      "(eje_x, columna_serie), con la medida como única columna numérica. "
                      "Añade columna_serie como SEGUNDA columna de agrupación en "
                      "SUMMARIZECOLUMNS (después del eje_x), NUNCA como filtro. "
                      "ORDER BY eje_x ASC, columna_serie ASC. No pivotes series a columnas.")
    lineas.append(f"  - Medida 1: {decision.get('medida_1')} "
                  f"(usa este nombre EXACTO como alias de columna proyectada)")
    if decision.get("medida_2"):
        lineas.append(f"  - Medida 2 (misma fila que medida 1, NO formato largo): "
                      f"{decision['medida_2']} (alias exacto: \"{decision['medida_2']}\")")
    return "\n".join(lineas)


# --- Capa 2: generación --------------------------------------------------

def generar_dax(pregunta: str, decision: dict, historial: list | None = None,
                idioma: str = "español") -> str:
    system = construir_system(ROL_GENERADOR, incluir_esquema=True, incluir_tiempo=True, idioma=idioma)
    contexto = (historial or [])[-5:]
    user = f"""Contexto reciente de consultas:
{contexto}

{_render_forma_requerida(decision)}

Pregunta actual:
{pregunta}

Genera la consulta DAX considerando el contexto y la forma de datos requerida."""
    return _parchear_dax(_limpiar_dax(_chat(system, user)))


# --- Capa 3: ejecución (determinista, SIN IA) ---------------------------

import subprocess, json as _json, pathlib as _pathlib, platform as _platform

_ADOMD_DIR = _pathlib.Path(__file__).parent / "adomd_bin"
_ADOMD_BIN = _ADOMD_DIR / "adomd_wrapper"
_ADOMD_DLL = _ADOMD_DIR / "adomd_wrapper.dll"

def _limpiar_columna(c: str) -> str:
    """'Calendar[Año#Mes]', \"[Calendar].[Año#Mes]\" o 'Ventas' -> 'Año#Mes' / 'Ventas'.

    ADOMD/REST devuelven columnas físicas como 'Tabla[Columna]' (sin corchetes en la
    tabla); las medidas con alias de SUMMARIZECOLUMNS llegan tal cual, sin corchetes.
    """
    if "[" not in c:
        return c
    return c[c.rfind("[") + 1:].rstrip("]")


def ejecutar_dax(dax: str):
    """Ejecuta DAX contra Power BI. Usa ADOMD.NET si está disponible, REST API si no."""
    if _ADOMD_DLL.exists():
        return _ejecutar_dax_adomd(dax)
    return _ejecutar_dax_rest(dax)

def _ejecutar_dax_adomd(dax: str):
    try:
        if _platform.system() == "Linux":
            cmd = ["dotnet", str(_ADOMD_DLL), CONNECTION_STRING, dax]
        else:
            cmd = [str(_ADOMD_BIN), CONNECTION_STRING, dax]
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
        if result.returncode != 0:
            return pd.DataFrame(), result.stderr.strip()
        rows = _json.loads(result.stdout)
        df = pd.DataFrame(rows)
        df.columns = [_limpiar_columna(c) for c in df.columns]
        return df, None
    except Exception as e:
        return pd.DataFrame(), str(e)

def _ejecutar_dax_rest(dax: str):
    try:
        token = _get_token()
        wid, did = _get_pbi_ids()
        headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
        body = {"queries": [{"query": dax}], "serializerSettings": {"includeNulls": True}}
        r = requests.post(
            f"https://api.powerbi.com/v1.0/myorg/groups/{wid}/datasets/{did}/executeQueries",
            headers=headers, json=body, timeout=60,
        )
        r.raise_for_status()
        rows = r.json()["results"][0]["tables"][0].get("rows", [])
        df = pd.DataFrame(rows)
        if not df.empty:
            df.columns = [_limpiar_columna(c) for c in df.columns]
        return df, None
    except Exception as e:
        return pd.DataFrame(), str(e)


# --- Capa 4: corrección --------------------------------------------------

def corregir_dax(pregunta: str, dax_fallido: str, error: str,
                 historial: list | None = None, idioma: str = "español") -> str:
    system = construir_system(ROL_CORRECTOR, incluir_esquema=True, incluir_tiempo=True, idioma=idioma)
    user = f"""Pregunta original:
{pregunta}

DAX que falló:
{dax_fallido}

Error devuelto por Power BI:
{error}

Genera el DAX corregido."""
    return _parchear_dax(_limpiar_dax(_chat(system, user)))


# --- Capa 5: respuesta ---------------------------------------------------

_RESPUESTA_DATOS_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["text", "title"],
    "properties": {
        "text": {"type": "string"},
        "title": {"type": "string"},
    },
}


def responder_datos(pregunta: str, dax: str, df: pd.DataFrame,
                    error: str | None, idioma: str = "español") -> tuple[str, str]:
    """Devuelve (texto_respuesta, title). El tipo de visualización ya se decidió antes."""
    system = construir_system(ROL_REDACTOR, incluir_tiempo=True, idioma=idioma)
    vacio = (not error) and df.empty
    FILAS_MAX_CONTEXTO = 50
    if error:
        datos = f"Error al ejecutar: {error}"
    elif vacio:
        datos = "La consulta no devolvió ninguna fila."
    else:
        muestra = df.head(FILAS_MAX_CONTEXTO).to_dict(orient="records")
        datos = (muestra if len(df) <= FILAS_MAX_CONTEXTO
                  else f"(mostrando {FILAS_MAX_CONTEXTO} de {len(df)} filas totales)\n{muestra}")
    user = f"""Pregunta del usuario:
{pregunta}

Resultado de la consulta:
{datos}

Responde en JSON."""
    try:
        parsed = _chat_json(system, user, _RESPUESTA_DATOS_SCHEMA, "respuesta_datos")
        return parsed.get("text", ""), parsed.get("title", "")
    except Exception:
        fallback = ("Sorry, I couldn't process the response." if idioma == "inglés"
                    else "Lo siento, no he podido procesar la respuesta.")
        return fallback, ""


_FILTRO_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["tabla", "columna", "titulo", "dax"],
    "properties": {
        "tabla": {"type": "string"},
        "columna": {"type": "string"},
        "titulo": {"type": "string"},
        "dax": {"type": "string"},
    },
}

_FILTRO_DEFAULT = {
    "tabla": "Stores", "columna": "Store Name", "titulo": "Tiendas",
    "dax": "EVALUATE DISTINCT('Stores'[Store Name])",
}


def identificar_columna_filtro(pregunta: str, idioma: str = "español") -> dict:
    """Identifica la tabla/columna para un filtro y genera el DAX DISTINCT."""
    system = construir_system(ROL_IDENTIFICADOR_FILTRO, incluir_esquema=True, idioma=idioma)
    try:
        return _chat_json(system, pregunta, _FILTRO_SCHEMA, "filtro_columna")
    except Exception:
        return dict(_FILTRO_DEFAULT)


def responder_conversacion(pregunta: str, idioma: str = "español") -> str:
    system = construir_system(ROL_CONVERSACION, idioma=idioma)
    return _chat(system, pregunta)
