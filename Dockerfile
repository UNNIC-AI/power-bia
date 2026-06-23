FROM python:3.12-slim

# Install .NET 10 runtime via official install script
RUN apt-get update && apt-get install -y curl && \
    curl -sSL https://dot.net/v1/dotnet-install.sh -o /tmp/dotnet-install.sh && \
    chmod +x /tmp/dotnet-install.sh && \
    /tmp/dotnet-install.sh --runtime dotnet --channel 10.0 && \
    rm /tmp/dotnet-install.sh && \
    rm -rf /var/lib/apt/lists/*

ENV DOTNET_ROOT="/root/.dotnet"
ENV PATH="$PATH:/root/.dotnet"

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

CMD uvicorn server:app --host 0.0.0.0 --port ${PORT:-8000}
