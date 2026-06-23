FROM python:3.12-slim

# Install .NET 10 runtime
RUN apt-get update && apt-get install -y wget apt-transport-https ca-certificates && \
    wget https://packages.microsoft.com/config/debian/12/packages-microsoft-prod.deb -O /tmp/packages-microsoft-prod.deb && \
    dpkg -i /tmp/packages-microsoft-prod.deb && \
    apt-get update && \
    apt-get install -y dotnet-runtime-10.0 && \
    rm -rf /var/lib/apt/lists/* /tmp/packages-microsoft-prod.deb

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

CMD uvicorn server:app --host 0.0.0.0 --port ${PORT:-8000}
