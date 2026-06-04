import os
from pathlib import Path
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware

# Load .env (optional, graceful fallback)
try:
    from dotenv import load_dotenv
    ENV_PATH = Path(__file__).resolve().parent.parent.parent / ".env"
    load_dotenv(ENV_PATH)
except ImportError:
    pass

app = FastAPI(title="WindNinja Web")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Resolve frontend path
FRONTEND_DIR = Path(__file__).resolve().parent.parent.parent / "frontend"

app.mount("/static", StaticFiles(directory=str(FRONTEND_DIR)), name="static")

@app.get("/")
async def root():
    return FileResponse(str(FRONTEND_DIR / "index.html"))

@app.get("/health")
async def health():
    return {"status": "ok"}

@app.get("/api/config")
async def config():
    return {"cesiumToken": os.getenv("CESIUM_TOKEN", "")}

# Import and register route modules
from backend.app.routes import simulation, dem, export
app.include_router(simulation.router)
app.include_router(dem.router)
app.include_router(export.router)
