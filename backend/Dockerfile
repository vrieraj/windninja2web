# ──────────────────────────────────────────────
#  Stage 1 — Build pybind11 module
# ──────────────────────────────────────────────
# Build from repo root: docker build -f backend/Dockerfile .
FROM ubuntu:22.04 AS builder

RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y \
    build-essential cmake git ninja-build \
    libgdal-dev libboost-date-time-dev libboost-program-options-dev \
    libcurl4-gnutls-dev libgeos-dev libsqlite3-dev sqlite3 \
    libopenjp2-7-dev libtiff-dev libshp-dev libnetcdf-dev \
    python3-dev python3-pip python3-pybind11 \
    && rm -rf /var/lib/apt/lists/*

COPY . /repo

RUN cmake -B /build -S /repo/backend/lib \
    -DCMAKE_BUILD_TYPE=Release \
    -Dpybind11_DIR=$(python3 -c "import pybind11; print(pybind11.get_cmake_dir())") \
    && cmake --build /build -j$(nproc) \
    && cp /build/windninja_core*.so /repo/backend/lib/

# ──────────────────────────────────────────────
#  Stage 2 — Runtime
# ──────────────────────────────────────────────
FROM ubuntu:22.04 AS runtime

RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y \
    libgdal30 libboost-date-time1.74.0 libboost-program-options1.74.0 \
    libcurl3-gnutls libsqlite3-0 libshp2 libnetcdf18 \
    python3 python3-pip \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /repo/backend /app/backend
COPY --from=builder /repo/frontend /app/frontend
COPY --from=builder /repo/data /app/data

ENV WINDNINJA_DATA=/app/data
ENV PYTHONPATH=/app/backend/lib

WORKDIR /app
RUN pip3 install --no-cache-dir -r backend/requirements.txt

EXPOSE 7860
CMD ["uvicorn", "backend.app.main:app", "--host", "0.0.0.0", "--port", "7860"]
