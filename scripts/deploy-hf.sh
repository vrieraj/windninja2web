#!/usr/bin/env bash
set -euo pipefail

SRC_REPO="/home/vencejo/Proyectos/windninja2web"
BRANCH="main"
COMMIT_MSG="Deploy: WindNinja web app for HF Spaces"
HF_REMOTE_URL=$(cd "$SRC_REPO" && git remote get-url hf)

# Create orphan branch from scratch
TMP_DIR=$(mktemp -d)
echo "Using temp dir: $TMP_DIR"

# Checkout HF remote main branch to temp dir
git clone --depth=1 "$HF_REMOTE_URL" "$TMP_DIR/hf-repo"
cd "$TMP_DIR/hf-repo"

# Remove everything
rm -rf ./* .dockerignore .gitignore 2>/dev/null || true

# Copy files from source repo
cd "$SRC_REPO"
FILES=(
  .dockerignore
  .gitignore
  Dockerfile
  backend/Dockerfile
  backend/__init__.py
  backend/app/__init__.py
  backend/app/core/__init__.py
  backend/app/core/dem_cache.py
  backend/app/core/export.py
  backend/app/core/ninja_bridge.py
  backend/app/core/task_manager.py
  backend/app/main.py
  backend/app/models/__init__.py
  backend/app/models/schemas.py
  backend/app/routes/__init__.py
  backend/app/routes/dem.py
  backend/app/routes/export.py
  backend/app/routes/map.py
  backend/app/routes/meteo.py
  backend/app/routes/simulation.py
  backend/lib/CMakeLists.txt
  backend/lib/bindings.cpp
  backend/pyproject.toml
  backend/requirements.txt
  frontend/css/style.css
  frontend/index.html
  frontend/js/app.js
  frontend/js/compass.js
  frontend/js/sidebar.js
  frontend/js/simulation.js
  frontend/js/state.js
  frontend/js/viewer.js
  LICENSE
  src/ninja_version.h.in
  .huggingface/README.md
)

# Copy WindNinja C++ source files (tracked by git)
echo "Copying src/ninja/..."
mkdir -p "$TMP_DIR/hf-repo/src/ninja"
cd "$SRC_REPO"
git ls-files src/ninja/ | while read f; do
  cp "$SRC_REPO/$f" "$TMP_DIR/hf-repo/$f"
done

for f in "${FILES[@]}"; do
  mkdir -p "$TMP_DIR/hf-repo/$(dirname "$f")"
  cp "$SRC_REPO/$f" "$TMP_DIR/hf-repo/$f"
done

# Copy root README.md with HF YAML front matter
cp "$SRC_REPO/.huggingface/README.md" "$TMP_DIR/hf-repo/README.md"

cd "$TMP_DIR/hf-repo"
git add -A
git commit -m "$COMMIT_MSG" --allow-empty
git push "$HF_REMOTE_URL" HEAD:refs/heads/main --force
echo "Done!"
