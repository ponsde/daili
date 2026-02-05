#!/bin/bash
set -e

# 定义路径
REPO_DIR="/home/ubuntu/daili"
CLASH_CONFIG="$REPO_DIR/run/proxy/config.yaml"
CLEWDR_CONTAINER="clewdr"
CLEWDR_CONFIG="$REPO_DIR/run/clewdr/clewdr.toml"  # 这是一个用来存备份的文件位置
LOG_FILE="$REPO_DIR/backup.log"

echo "=== Backup started at $(date) ===" >> $LOG_FILE

# 1. 自动提交 Clash 配置
# 因为 Clash 现在直接运行在仓库目录 run/proxy/config.yaml 下
# 所以只要你通过 UI 改了配置，文件已经变了，不需要复制

# 2. 同步 ClewdR 配置文件 (Cookie 等)
# 因为 ClewdR 运行在 Docker 里，如果不是挂载模式，需要拷贝出来
if docker ps | grep -q "$CLEWDR_CONTAINER"; then
    if docker cp $CLEWDR_CONTAINER:/app/clewdr.toml "$CLEWDR_CONFIG" 2>>$LOG_FILE; then
        echo "Synced ClewdR config from container." >> $LOG_FILE
    else
        echo "Warning: Failed to copy clewdr.toml from container." >> $LOG_FILE
    fi
else
    echo "Warning: ClewdR container is not running, skipping config backup." >> $LOG_FILE
fi

# 3. 检查 API Gateway 配置
# API Gateway 使用挂载模式，文件直接位于 run/api_change/ 下，无需手动 docker cp
if [ -f "$REPO_DIR/run/api_change/keys.json" ]; then
    echo "API Gateway keys found." >> $LOG_FILE
fi

# 4. 提交并推送到 GitHub
cd "$REPO_DIR"

# 检查是否有文件通过 git status 发生变化
if [[ -n $(git status -s) ]]; then
    git config user.name "Auto Backup"
    git config user.email "backup@localhost"
    
    git add .
    git commit -m "Auto backup: $(date '+%Y-%m-%d %H:%M:%S')" >> $LOG_FILE
    
    # 尝试推送
    if git push origin main >> $LOG_FILE 2>&1; then
        echo "Success: Changes pushed to GitHub." >> $LOG_FILE
    else
        echo "Error: Git push failed. Please check credentials." >> $LOG_FILE
    fi
else
    echo "No changes detected. Skipping backup." >> $LOG_FILE
fi

echo "=== Backup finished ===" >> $LOG_FILE
echo "" >> $LOG_FILE
