"""
schema.py
=========
Fuente única de verdad del modelo semántico de Power BI.

Todo el contexto que el LLM necesita para generar DAX correcto vive aquí:
tablas, columnas (con tipo, ejemplo y rol), relaciones, medidas de negocio,
sinónimos y metadatos temporales.

Si cambias de cliente / modelo de datos, este es el ÚNICO archivo que tocas.
Los prompts se construyen a partir de estas estructuras, no a mano.
"""

from datetime import date

# ---------------------------------------------------------------------------
# Metadatos del modelo
# ---------------------------------------------------------------------------

MODELO = {
    "nombre": "Ventas de licores (Iowa Liquor Sales)",
    "descripcion": (
        "Ventas mayoristas de botellas de licor: cada factura registra "
        "botellas vendidas de un producto en una tienda en una fecha."
    ),
    # Rango temporal REAL de los datos. Crítico para la conciencia de fecha:
    # el LLM debe razonar contra este rango, no contra el año actual.
    "fecha_min": date(2012, 1, 1),
    "fecha_max": date(2021, 12, 31),
}

# ---------------------------------------------------------------------------
# Tablas y columnas
#   rol: "dimension" | "hecho" | "fecha"
#   tipo: tipo de dato real observado en el modelo
#   ejemplo: valor real de muestra (resuelve ambigüedades de formato)
#   agregable: True solo si tiene sentido SUM() sobre la columna
# ---------------------------------------------------------------------------

TABLAS = {
    "Calendar": {
        "rol": "fecha",
        "descripcion": "Tabla de calendario. Toda dimensión temporal sale de aquí.",
        "columnas": {
            "Date":        {"tipo": "datetime", "ejemplo": "2012-07-02", "agregable": False},
            "FechaSK":     {"tipo": "entero",   "ejemplo": 20120702,     "agregable": False,
                            "nota": "Clave subrogada AAAAMMDD. Úsala para ORDER BY cronológico fiable."},
            "#Año":        {"tipo": "entero",   "ejemplo": 2012,         "agregable": False,
                            "nota": "Filtrar por año SIN comillas: 'Calendar'[#Año] = 2016"},
            "#Trimestre":  {"tipo": "entero",   "ejemplo": 3,            "agregable": False},
            "#Mes":        {"tipo": "entero",   "ejemplo": 7,            "agregable": False},
            "#Día":        {"tipo": "entero",   "ejemplo": 2,            "agregable": False},
            "Trimestre":   {"tipo": "texto",    "ejemplo": "T3",         "agregable": False},
            "Mes":         {"tipo": "texto",    "ejemplo": "July",       "agregable": False},
            "MesCorto":    {"tipo": "texto",    "ejemplo": "Jul",        "agregable": False},
            "#DíaSemana":  {"tipo": "entero",   "ejemplo": 1,            "agregable": False},
            "#SemanaAño":  {"tipo": "entero",   "ejemplo": 28,           "agregable": False},
            "CierreSemana":{"tipo": "datetime", "ejemplo": "2012-07-08", "agregable": False},
            "Día":         {"tipo": "texto",    "ejemplo": "Monday",     "agregable": False},
            "DíaCorto":    {"tipo": "texto",    "ejemplo": "Mon",        "agregable": False},
            "AñoTrimestre":{"tipo": "texto",    "ejemplo": "2012/T3",    "agregable": False},
            "Año#Mes":     {"tipo": "texto",    "ejemplo": "2012/07",    "agregable": False,
                            "nota": "Eje temporal para evolución mensual. Ordenable por texto (año primero)."},
            "AñoMesCorto": {"tipo": "texto",    "ejemplo": "2012/Jul",   "agregable": False,
                            "nota": "Etiqueta legible para evolución mensual."},
        },
    },

    "Invoices": {
        "rol": "hecho",
        "descripcion": "Tabla de hechos. Una fila por línea de factura. Es la tabla grande del modelo.",
        "columnas": {
            "Invoice":      {"tipo": "texto",  "ejemplo": "S04591900003", "agregable": False},
            "Date":         {"tipo": "datetime","ejemplo": "2012-03-15",  "agregable": False,
                             "nota": "Relacionada con Calendar[Date]. Filtrar fechas vía Calendar."},
            "Store Number": {"tipo": "entero", "ejemplo": 2190,           "agregable": False},
            "Item Number":  {"tipo": "entero", "ejemplo": 31657,          "agregable": False},
            "Bottles Sold": {"tipo": "entero", "ejemplo": 12,             "agregable": True,
                             "nota": "ÚNICA columna sumable del modelo. Toda métrica de ventas parte de aquí."},
        },
    },

    "Items": {
        "rol": "dimension",
        "descripcion": "Catálogo de productos.",
        "columnas": {
            "Item Number":        {"tipo": "entero", "ejemplo": 678,                              "agregable": False},
            "Item Description":   {"tipo": "texto",  "ejemplo": "Dewars 12 W/2 Rock Glasses",     "agregable": False,
                                   "nota": "Nombre del producto. 'producto' = esta columna."},
            "Category":           {"tipo": "entero", "ejemplo": 1701100,                          "agregable": False,
                                   "nota": "CÓDIGO de categoría. Para mostrar usa 'Category Name'."},
            "Category Name":      {"tipo": "texto",  "ejemplo": "Decanters & Specialty Packages", "agregable": False,
                                   "nota": "Nombre legible de categoría. 'categoría' = esta columna."},
            "Category Group":     {"tipo": "texto",  "ejemplo": "Other",                          "agregable": False},
            "Vendor Number":      {"tipo": "entero", "ejemplo": 35,                               "agregable": False,
                                   "nota": "Identificador FIABLE del proveedor (Vendor Name tiene duplicados de texto)."},
            "Vendor Name":        {"tipo": "texto",  "ejemplo": "Bacardi Usa Inc",                "agregable": False,
                                   "nota": "OJO: mismo proveedor puede aparecer con texto distinto "
                                           "('Bacardi Usa Inc' vs 'Bacardi U.S.A., Inc.'). Para agrupar "
                                           "proveedor de forma exacta, preferir Vendor Number."},
            "Pack":               {"tipo": "entero", "ejemplo": 6,                                "agregable": False},
            "Bottle Volume (ml)": {"tipo": "entero", "ejemplo": 750,                              "agregable": False},
            "State Bottle Cost":  {"tipo": "decimal","ejemplo": 20.0,                             "agregable": False,
                                   "nota": "Precio COSTE UNITARIO. NO sumar. Para importes: precio * Bottles Sold."},
            "State Bottle Retail":{"tipo": "decimal","ejemplo": 30.0,                             "agregable": False,
                                   "nota": "Precio VENTA UNITARIO. NO sumar. Para facturación: Retail * Bottles Sold."},
        },
    },

    "Stores": {
        "rol": "dimension",
        "descripcion": "Catálogo de tiendas.",
        "columnas": {
            "Store Number":   {"tipo": "entero", "ejemplo": 5386,                                    "agregable": False},
            "Store Name":     {"tipo": "texto",  "ejemplo": "Casey'S General Store # 2494/...",       "agregable": False,
                               "nota": "'tienda' = esta columna."},
            "Store Short":    {"tipo": "texto",  "ejemplo": "Casey'S General Store",                  "agregable": False},
            "Address":        {"tipo": "texto",  "ejemplo": "200 S Commercial Ave",                   "agregable": False},
            "City":           {"tipo": "texto",  "ejemplo": "Eagle Grove",                            "agregable": False,
                               "nota": "'ciudad' = esta columna."},
            "County":         {"tipo": "texto",  "ejemplo": "Wright",                                 "agregable": False,
                               "nota": "'condado' = esta columna."},
            "County Number":  {"tipo": "entero", "ejemplo": 99,                                       "agregable": False},
            "Zip Code":       {"tipo": "entero", "ejemplo": 50533,                                    "agregable": False},
            "Store Location": {"tipo": "texto",  "ejemplo": "POINT (-93.90 42.66)",                   "agregable": False},
            "Merged":         {"tipo": "texto",  "ejemplo": "200 S Commercial Ave, Eagle Grove, ...", "agregable": False},
            "lat":            {"tipo": "decimal","ejemplo": -93.90448,                                "agregable": False},
            "lon":            {"tipo": "decimal","ejemplo": 42.662672,                                "agregable": False},
        },
    },
}

# ---------------------------------------------------------------------------
# Relaciones (hechos confirmados, no suposiciones)
#   Todas muchos-a-uno (*:1) desde Invoices hacia las dimensiones, activas.
# ---------------------------------------------------------------------------

RELACIONES = [
    {"origen": "Invoices[Item Number]",  "destino": "Items[Item Number]",   "cardinalidad": "*:1", "activa": True},
    {"origen": "Invoices[Store Number]", "destino": "Stores[Store Number]", "cardinalidad": "*:1", "activa": True},
    {"origen": "Invoices[Date]",         "destino": "Calendar[Date]",       "cardinalidad": "*:1", "activa": True},
]

# ---------------------------------------------------------------------------
# Medidas / conceptos de negocio
#   El vocabulario del usuario -> la expresión DAX correcta.
# ---------------------------------------------------------------------------

MEDIDAS = {
    "Botellas vendidas": "SUM('Invoices'[Bottles Sold])",
    "Ventas":            "SUM('Invoices'[Bottles Sold])",
    "Facturación":       "SUMX('Invoices', 'Invoices'[Bottles Sold] * RELATED('Items'[State Bottle Retail]))",
    "Coste total":       "SUMX('Invoices', 'Invoices'[Bottles Sold] * RELATED('Items'[State Bottle Cost]))",
    "Margen":            "[Facturación] - [Coste total]  (calcular ambos SUMX)",
    "Precio medio venta":"AVERAGE('Items'[State Bottle Retail])",
    "Precio medio coste":"AVERAGE('Items'[State Bottle Cost])",
}

# ---------------------------------------------------------------------------
# Sinónimos del vocabulario de negocio -> columna/concepto canónico
# ---------------------------------------------------------------------------

SINONIMOS = {
    "ventas":        "Botellas vendidas",
    "vendido":       "Botellas vendidas",
    "botellas":      "Botellas vendidas",
    "facturación":   "Facturación",
    "ingresos":      "Facturación",
    "producto":      "Items[Item Description]",
    "artículo":      "Items[Item Description]",
    "categoría":     "Items[Category Name]",
    "proveedor":     "Items[Vendor Name] (agrupar por Vendor Number si exactitud)",
    "vendedor":      "Items[Vendor Name] — proveedor/marca, NO la tienda. Si el usuario parece referirse al punto de venta, pedir aclaración.",
    "marca":         "Items[Vendor Name]",
    "tienda":        "Stores[Store Name]",
    "ciudad":        "Stores[City]",
    "condado":       "Stores[County]",
    "mes":           "Calendar[Mes] / evolución: Calendar[Año#Mes]",
    "año":           "Calendar[#Año]",
    "trimestre":     "Calendar[#Trimestre]",
}
