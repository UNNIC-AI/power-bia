using System.Diagnostics;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.AnalysisServices.AdomdClient;

var gatewayToken = Environment.GetEnvironmentVariable("DAX_GATEWAY_TOKEN");
if (string.IsNullOrWhiteSpace(gatewayToken))
{
    throw new InvalidOperationException("DAX_GATEWAY_TOKEN is not set");
}

var builder = WebApplication.CreateBuilder(args);
builder.Services.ConfigureHttpJsonOptions(options =>
{
    options.SerializerOptions.PropertyNamingPolicy = JsonNamingPolicy.CamelCase;
});

var app = builder.Build();

app.MapGet("/health", () => Results.Ok(new { status = "ok" }));

app.UseWhen(
    context => !context.Request.Path.StartsWithSegments("/health"),
    branch => branch.Use(async (context, next) =>
    {
        if (!HasValidToken(context.Request, gatewayToken))
        {
            context.Response.StatusCode = StatusCodes.Status401Unauthorized;
            return;
        }

        await next();
    }));

app.MapPost("/query", (DaxRequest request) =>
{
    try
    {
        return Results.Ok(Execute(request));
    }
    catch (AdomdException exception)
    {
        // The message is the Power BI error text, which the API feeds back into
        // its DAX repair step - it must survive intact.
        return Results.UnprocessableEntity(new ErrorResult(exception.Message));
    }
    catch (Exception exception)
    {
        return Results.UnprocessableEntity(new ErrorResult(exception.Message));
    }
});

app.Run();

static bool HasValidToken(HttpRequest request, string expected)
{
    var header = request.Headers.Authorization.ToString();
    if (!header.StartsWith("Bearer ", StringComparison.Ordinal)) return false;

    return CryptographicOperations.FixedTimeEquals(
        Encoding.UTF8.GetBytes(header["Bearer ".Length..]),
        Encoding.UTF8.GetBytes(expected));
}

static QueryResult Execute(DaxRequest request)
{
    var stopwatch = Stopwatch.StartNew();

    using var connection = new AdomdConnection(BuildConnectionString(request.Connection));
    connection.Open();

    using var command = connection.CreateCommand();
    command.CommandText = request.Dax;
    command.CommandTimeout = request.TimeoutSeconds ?? 120;

    using var reader = command.ExecuteReader();

    var columns = Enumerable.Range(0, reader.FieldCount).Select(reader.GetName).ToArray();
    var rows = new List<object?[]>();

    while (reader.Read())
    {
        var row = new object?[reader.FieldCount];
        for (var i = 0; i < row.Length; i++)
        {
            row[i] = ToJsonValue(reader.GetValue(i));
        }

        rows.Add(row);
    }

    return new QueryResult(columns, rows, stopwatch.ElapsedMilliseconds);
}

static object? ToJsonValue(object? value) => value switch
{
    null or DBNull => null,
    DateTime date => date.ToString("yyyy-MM-dd'T'HH:mm:ss"),
    decimal number => (double)number,
    _ => value,
};

static string BuildConnectionString(PowerBiConnection connection) =>
    string.Join(';', [
        "Provider=MSOLAP",
        $"Data Source=powerbi://api.powerbi.com/v1.0/myorg/{Quote(connection.WorkspaceName)}",
        $"Initial Catalog={Quote(connection.DatasetName)}",
        $"User ID=app:{connection.ClientId}@{connection.TenantId}",
        $"Password={Quote(connection.ClientSecret)}",
    ]);

/// A secret containing ';' would otherwise silently truncate the connection string.
static string Quote(string value) =>
    value.Contains(';') || value.Contains('"')
        ? $"\"{value.Replace("\"", "\"\"")}\""
        : value;

record PowerBiConnection(
    string TenantId,
    string ClientId,
    string ClientSecret,
    string WorkspaceName,
    string DatasetName);

record DaxRequest(PowerBiConnection Connection, string Dax, int? TimeoutSeconds);

record QueryResult(string[] Columns, IReadOnlyList<object?[]> Rows, long DurationMs);

record ErrorResult(string Error);
