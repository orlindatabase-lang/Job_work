FROM python:3.11-slim

# Install Node.js 20
RUN apt-get update && apt-get install -y curl --no-install-recommends \
 && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
 && apt-get install -y nodejs \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Python deps
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Node deps (separate layer so code changes don't re-install)
COPY ppc-dashboard/backend/package*.json ./ppc-dashboard/backend/
RUN cd ppc-dashboard/backend && npm ci --omit=dev

# Copy everything else
COPY . .

# Cloud Run sets PORT automatically; default 8080
ENV PORT=8080
EXPOSE 8080

CMD ["node", "ppc-dashboard/backend/server.js"]
