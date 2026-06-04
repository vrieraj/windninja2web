import os
from pathlib import Path
from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

# Load .env from project root
ENV_PATH = Path(__file__).resolve().parent.parent.parent / ".env"
load_dotenv(ENV_PATH)

app = FastAPI(title="WindNinja Web")

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
