# Power BIA — Asistente conversacional de Power BI

## Qué es este proyecto

**Power BIA** es un prototipo de interfaz conversacional que permite a usuarios no técnicos consultar modelos de datos de Power BI usando **lenguaje natural en español**. El usuario escribe preguntas ("¿Cuáles fueron las ventas en 2020?") y el sistema genera DAX, lo ejecuta contra el modelo de Power BI, y devuelve la respuesta con lenguaje natural y visualizaciones interactivas.

El modelo de datos conectado es **Iowa Liquor Sales** (ventas mayoristas de licores 2012-2021), con tablas de hechos, productos, tiendas y calendario.

---

## Stack tecnológico

- **Backend:** Python 3.12 + FastAPI + Uvicorn
- **LLM:** OpenAI GPT-4.1 (generación de DAX, corrección, respuesta)
- **Conectividad Power BI:** XMLA endpoint via ADOMD.NET (.NET 10 runtime) + fallback a REST API de Power BI
- **Auth:** Azure AD service principal (MSAL)
- **Frontend:** HTML/CSS/JS vanilla (chat interactivo con tarjetas de visualización)
- **Despliegue:** Docker + Railway/Heroku (Procfile)

---

## Arquitectura del pipeline LLM

`server.py` recibe `POST /api/chat` y delega en `assistant.py`, que ejecuta 5 pasos en orden:

1. **`enrutar()`** — clasifica la intención (consulta de datos / conversación / fuera de rango)
2. **`generar_dax()`** — genera la query DAX usando el esquema de `schema.py`
3. **`ejecutar_dax()`** — ejecuta DAX contra Power BI (ADOMD.NET o REST API); **no usa LLM**
4. **`corregir_dax()`** — si la ejecución falla, reintenta con el mensaje de error como contexto
5. **`responder_datos()` / `responder_conversacion()`** — genera respuesta en lenguaje natural

Cada paso tiene su propio system prompt en `system_context.py`.

---

## Ficheros clave

| Fichero | Propósito |
|---|---|
| `server.py` | Entry point FastAPI, gestión de sesiones (cookie `pbi_session`), endpoint `/api/chat` |
| `assistant.py` | Pipeline LLM completo (5 funciones encadenadas) |
| `system_context.py` | System prompts para cada rol LLM; conciencia temporal del rango de datos |
| `schema.py` | **Fuente de verdad del modelo de datos** — tablas, columnas, relaciones, medidas, sinónimos |
| `index.html` | UI de chat completa (dark/light theme, tarjetas KPI/tabla/gráfico) |
| `Dockerfile` | Python 3.12 slim + .NET 10 runtime (para ADOMD wrapper) |
| `adomd_bin/` | Wrapper .NET precompilado para ejecutar DAX vía XMLA |
| `.env` | Secrets: `OPENAI_API_KEY`, `PBI_CONNECTION_STRING` (no en repo) |

---

## Modelo de datos (schema.py)

- **Calendar** — dimensión de fechas (15 columnas: fecha, año, mes, semana...)
- **Invoices** — tabla de hechos (factura, fecha, tienda, ítem, botellas vendidas)
- **Items** — productos (descripción, categoría, proveedor, precio)
- **Stores** — tiendas (nombre, ciudad, condado, lat/lon)

Relaciones: todas `*:1` desde `Invoices` hacia las tres tablas dimensionales.

Medidas de negocio: Bottles Sold, Revenue (SUMX), Cost, Margin, Avg Price.

---

## Gestión de sesiones

`server.py` mantiene un dict en memoria `_sessions` indexado por UUID de cookie. Guarda los últimos 5 intercambios (pregunta, DAX generado, columnas, muestra de filas) para permitir preguntas de seguimiento contextuales.

---

## Despliegue

- **Local:** `python3 server.py` (requiere `.env` con credenciales)
- **Docker:** `docker build -t powerbia . && docker run -p 8000:8000 --env-file .env powerbia`
- **Railway/Heroku:** via `Procfile` (`web: uvicorn server:app --host 0.0.0.0 --port $PORT`)
- Repo remoto: `UNNIC-AI/power-bia`

---

## Convenciones del código

- Todo el código y comentarios están **en español**
- `schema.py` es el único fichero que hay que tocar para cambios en el modelo de datos
- Los system prompts en `system_context.py` construyen el contexto de esquema dinámicamente desde `schema.py`
- El LLM no interviene en la ejecución de DAX (`ejecutar_dax` es determinista)

---

## Variables de entorno necesarias

```
OPENAI_API_KEY=sk-...
PBI_CONNECTION_STRING=Provider=MSOLAP;...
```

La connection string incluye credenciales de service principal de Azure AD para autenticar contra el XMLA endpoint de Power BI.
