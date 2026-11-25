
FROM node:20-bookworm-slim

WORKDIR /app

# Install Python and tools needed for analytics dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-venv \
    python3-pip \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Create an isolated Python environment
RUN python3 -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"
ENV PYTHON_BIN="/opt/venv/bin/python"

# Copy the complete project
COPY . .

# Install backend dependencies
RUN npm install --prefix backend --omit=dev

# Install frontend dependencies and build React application
RUN npm ci --prefix frontend
RUN npm run build --prefix frontend

# Install Python analytics dependencies
RUN pip install --no-cache-dir -r analytics/requirements.txt

# Render provides the PORT environment variable
ENV NODE_ENV=production

EXPOSE 10000

# Start the Express backend
CMD ["npm", "--prefix", "backend", "start"]
