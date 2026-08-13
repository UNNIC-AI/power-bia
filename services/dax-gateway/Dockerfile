FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
COPY DaxGateway.csproj .
RUN dotnet restore
COPY . .
RUN dotnet publish -c Release -o /app --no-restore

FROM mcr.microsoft.com/dotnet/aspnet:10.0
# libicu: ADOMD requires ICU. wget: compose healthcheck.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libicu-dev wget \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app .
EXPOSE 8080
ENTRYPOINT ["dotnet", "DaxGateway.dll"]
