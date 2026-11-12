#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$REPO_DIR"

echo "============================================================"
echo "  Tony Studio -> Push to GitHub & Build ghcr.io Image"
echo "============================================================"
echo ""

# 1. Sync latest code from /start.sh, /opt/tony, /opt/tony-mcp
bash "${REPO_DIR}/sync-from-system.sh"

# 2. Optional: update BASE_IMAGE in Dockerfile
CURRENT_BASE=$(grep -E '^ARG BASE_IMAGE=' Dockerfile | head -n1 | cut -d= -f2-)
echo ""
echo "BASE_IMAGE ปัจจุบันใน Dockerfile: ${CURRENT_BASE}"
read -r -p "ใส่ชื่อ Container Image ต้นฉบับจาก RunPod (กด Enter เพื่อใช้ค่าเดิม): " INPUT_BASE
if [[ -n "${INPUT_BASE// }" ]]; then
  CLEAN_BASE="${INPUT_BASE// /}"
  sed -i "s|^ARG BASE_IMAGE=.*|ARG BASE_IMAGE=${CLEAN_BASE}|" Dockerfile
  echo "อัปเดต BASE_IMAGE เป็น: ${CLEAN_BASE}"
fi

# 3. Ask GitHub details
echo ""
read -r -p "GitHub Username: " GH_USER
GH_USER="${GH_USER// /}"
if [[ -z "$GH_USER" ]]; then
  echo "กรุณากรอก GitHub Username"
  exit 1
fi

read -r -p "Repository Name [tony-h3-studio]: " GH_REPO
GH_REPO="${GH_REPO:-tony-h3-studio}"
GH_REPO="${GH_REPO// /}"

echo ""
echo "สร้าง Token ที่ GitHub -> Settings -> Developer settings -> Personal access tokens -> Tokens (classic)"
echo "ติ๊กสิทธิ์: [repo] และ [workflow]"
read -r -s -p "วาง GitHub Personal Access Token (ข้อความจะถูกซ่อน): " GH_TOKEN
echo ""
if [[ -z "$GH_TOKEN" ]]; then
  echo "กรุณาวาง GitHub Token"
  exit 1
fi

# 4. Initialize git repo if needed
if [[ ! -d .git ]]; then
  git init -b main
fi

git config user.name "${GH_USER}"
git config user.email "${GH_USER}@users.noreply.github.com"

# Set clean remote URL (never store token inside .git/config)
CLEAN_REMOTE="https://github.com/${GH_USER}/${GH_REPO}.git"
if git remote get-url origin >/dev/null 2>&1; then
  git remote set-url origin "$CLEAN_REMOTE"
else
  git remote add origin "$CLEAN_REMOTE"
fi

git add -A
if git diff --cached --quiet; then
  echo "ไม่มีไฟล์เปลี่ยนแปลงใหม่ กำลัง push commit ล่าสุด..."
else
  COMMIT_MSG="${1:-Update Tony Studio MVC}"
  git commit -m "$COMMIT_MSG"
fi

# 5. Push using ephemeral askpass helper so token is never saved to disk
ASKPASS_FILE=$(mktemp)
trap 'rm -f "$ASKPASS_FILE"' EXIT
cat > "$ASKPASS_FILE" <<'EOF'
#!/usr/bin/env bash
case "$1" in
  *Username*) printf '%s\n' "$_GH_USER" ;;
  *Password*) printf '%s\n' "$_GH_TOKEN" ;;
esac
EOF
chmod 700 "$ASKPASS_FILE"

echo ""
echo "กำลัง Push ขึ้น ${CLEAN_REMOTE} ..."
_GH_USER="$GH_USER" _GH_TOKEN="$GH_TOKEN" GIT_TERMINAL_PROMPT=0 GIT_ASKPASS="$ASKPASS_FILE" git push -u origin main

OWNER_LOWER=$(echo "$GH_USER" | tr '[:upper:]' '[:lower:]')
REPO_LOWER=$(echo "$GH_REPO" | tr '[:upper:]' '[:lower:]')

echo ""
echo "============================================================"
echo "  Push สำเร็จ!"
echo "  1. ดูสถานะ Build ได้ที่:"
echo "     https://github.com/${GH_USER}/${GH_REPO}/actions"
echo "  2. เมื่อ Build เสร็จ ตั้ง Visibility เป็น Public ที่:"
echo "     https://github.com/${GH_USER}?tab=packages"
echo "  3. นำชื่อ Image นี้ไปใส่ใน RunPod Template:"
echo "     ghcr.io/${OWNER_LOWER}/${REPO_LOWER}:latest"
echo "============================================================"
