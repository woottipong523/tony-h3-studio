#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$REPO_DIR"

echo "============================================================"
echo "  Tony Studio -> Pure Clean Build & Push to GitHub (ghcr.io)"
echo "============================================================"
echo ""

# 1. Sync latest code from /start.sh, /opt/tony, /opt/tony-mcp
bash "${REPO_DIR}/sync-from-system.sh"

# 2. Ask GitHub details
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

# 3. Initialize git repo if needed
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

if git diff-index --quiet HEAD -- 2>/dev/null; then
  echo "ไม่มีการเปลี่ยนแปลงใหม่ในโค้ด แต่จะทำการ Push ซ้ำไปยัง origin main..."
else
  git commit -m "feat(tony): standalone pure 100% build without legacy base"
fi

# 4. Push securely using ephemeral askpass
ASKPASS_SH=$(mktemp)
cat << 'EOF' > "$ASKPASS_SH"
#!/usr/bin/env bash
case "$1" in
  *Username*) echo "$GH_USER" ;;
  *Password*) echo "$GH_TOKEN" ;;
  *) echo "" ;;
esac
EOF
chmod 700 "$ASKPASS_SH"

export GH_USER GH_TOKEN
export GIT_ASKPASS="$ASKPASS_SH"
export GIT_TERMINAL_PROMPT=0

echo ""
echo "[GIT] กำลัง Push ไปยัง GitHub (${CLEAN_REMOTE})..."
git push -u origin main
rm -f "$ASKPASS_SH"

echo ""
echo "============================================================"
echo "✓ Push เรียบร้อยแล้ว!"
echo "GitHub Actions จะทำการ Build Base Image ตัวใหม่ของคุณเองแบบ 100%"
echo "ติดตามการ Build ได้ที่: https://github.com/${GH_USER}/${GH_REPO}/actions"
echo "============================================================"
