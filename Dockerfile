# =============================================================================
# Synq Daily Planner — Docker multi-stage build
# =============================================================================
# Stage 1: Build frontend (React/Vite)
# Stage 2: Build Rust backend (synq-server standalone binary)
# Stage 3: Minimal runtime image
# =============================================================================

# ---------------------------------------------------------------------------
# Stage 1: Frontend
# ---------------------------------------------------------------------------
FROM node:20-slim AS frontend
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# ---------------------------------------------------------------------------
# Stage 2: Rust backend — builds only the synq-server binary (no Tauri/GUI)
# ---------------------------------------------------------------------------
FROM rust:1.82-slim AS backend
RUN apt-get update && apt-get install -y pkg-config libssl-dev && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# Copy manifests first for layer caching
COPY src-tauri/Cargo.toml src-tauri/Cargo.lock ./src-tauri/
COPY src-tauri/src ./src-tauri/src

# build.rs calls tauri_build::build() which is only needed for the Tauri binary.
# We replace it with a no-op so the standalone synq-server bin compiles cleanly.
RUN printf 'fn main() {}\n' > /app/src-tauri/build.rs

WORKDIR /app/src-tauri
RUN cargo build --release --bin synq-server

# ---------------------------------------------------------------------------
# Stage 3: Runtime
# ---------------------------------------------------------------------------
FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app

COPY --from=backend /app/src-tauri/target/release/synq-server ./synq-server
COPY --from=frontend /app/dist ./dist

RUN mkdir -p /data

VOLUME ["/data"]

ENV SYNQ_DB_PATH=/data/planner.db
ENV SYNQ_DIST_PATH=/app/dist

EXPOSE 7734

CMD ["./synq-server"]
