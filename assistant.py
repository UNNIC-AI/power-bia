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
    ROL_CORRECTOR, ROL_REDACTOR, ROL_CONVERSACION, ROL_SELECTOR_GRAFICO, \
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


# --- Capa 2: generación --------------------------------------------------

def generar_dax(pregunta: str, historial: list | None = None, idioma: str = "español") -> str:
    system = construir_system(ROL_GENERADOR, incluir_esquema=True, incluir_tiempo=True, idioma=idioma)
    contexto = (historial or [])[-5:]
    user = f"""Contexto reciente de consultas:
{contexto}

Pregunta actual:
{pregunta}

Genera la consulta DAX considerando el contexto."""
    return _parchear_dax(_limpiar_dax(_chat(system, user)))


# --- Capa 3: ejecución (determinista, SIN IA) ---------------------------

import subprocess, json as _json, pathlib as _pathlib, platform as _platform

_ADOMD_DIR = _pathlib.Path(__file__).parent / "adomd_bin"
_ADOMD_BIN = _ADOMD_DIR / "adomd_wrapper"
_ADOMD_DLL = _ADOMD_DIR / "adomd_wrapper.dll"

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
        df.columns = [c.split("].[")[-1].rstrip("]").lstrip("[") if "]" in c else c for c in df.columns]
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
            df.columns = [c.split("].[")[-1].rstrip("]").lstrip("[") if "]" in c else c for c in df.columns]
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

def responder_datos(pregunta: str, dax: str, df: pd.DataFrame,
                    error: str | None, idioma: str = "español") -> tuple[str, str, str]:
    """Devuelve (texto_respuesta, chart_type, title). El LLM decide tipo y título."""
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
    raw = _chat(system, user)
    try:
        limpio = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw.strip(), flags=re.MULTILINE)
        parsed = _json_stdlib.loads(limpio)
        text = parsed.get("text", raw)
        chart_type = parsed.get("chart_type", "table")
        title = parsed.get("title", "")
    except Exception:
        text_match = re.search(r'"text"\s*:\s*"((?:[^"\\]|\\.)*)"', raw, re.DOTALL)
        chart_match = re.search(r'"chart_type"\s*:\s*"(\w+)"', raw)
        title_match = re.search(r'"title"\s*:\s*"((?:[^"\\]|\\.)*)"', raw)
        text = text_match.group(1).replace('\\"', '"').replace('\\n', '\n') if text_match else raw
        chart_type = chart_match.group(1) if chart_match else "table"
        title = title_match.group(1) if title_match else ""
    validos = {"kpi", "bar", "line", "pie", "table", "none"}
    return text, (chart_type if chart_type in validos else "table"), title


def decidir_tipo_grafico(peticion: str, columnas: list) -> str:
    """Decide el tipo de visualización para redibujar el resultado anterior."""
    system = construir_system(ROL_SELECTOR_GRAFICO)
    user = f"""El usuario pide: "{peticion}"
Las columnas del resultado son: {columnas}"""
    resultado = _chat(system, user).strip().lower()
    validos = {"kpi", "bar", "line", "pie", "table"}
    return resultado if resultado in validos else "bar"


def identificar_columna_filtro(pregunta: str, idioma: str = "español") -> dict:
    """Identifica la tabla/columna para un filtro y genera el DAX DISTINCT."""
    system = construir_system(ROL_IDENTIFICADOR_FILTRO, incluir_esquema=True, idioma=idioma)
    raw = _chat(system, pregunta)
    try:
        limpio = re.sub(r'^```(?:json)?\s*|\s*```$', '', raw.strip(), flags=re.MULTILINE)
        return _json_stdlib.loads(limpio)
    except Exception:
        return {
            "tabla": "Stores", "columna": "Store Name", "titulo": "Tiendas",
            "dax": "EVALUATE DISTINCT('Stores'[Store Name])"
        }


def responder_conversacion(pregunta: str, idioma: str = "español") -> str:
    system = construir_system(ROL_CONVERSACION, idioma=idioma)
    return _chat(system, pregunta)
