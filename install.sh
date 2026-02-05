#!/bin/bash
set -e

# 颜色定义
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${GREEN}=== 开始部署服务 (ClewdR + API Gateway) ===${NC}"

# 当前目录就是仓库根目录
REPO_DIR=$(pwd)
PROXY_DIR="$REPO_DIR/run/proxy"
CLEWDR_DIR="$REPO_DIR/run/clewdr"
API_DIR="$REPO_DIR/run/api_change"

# 1. 安装 Docker
echo -e "${BLUE}[1/6] 检查 Docker 环境...${NC}"
if ! command -v docker &> /dev/null; then
    curl -fsSL https://get.docker.com | bash
fi

# 2. 启动 Clash
echo -e "${BLUE}[2/6] 启动 Clash 代理...${NC}"
chmod +x "$PROXY_DIR/clash"

# 更新 systemd 指向仓库内的位置
sudo tee /etc/systemd/system/clash.service <<EOF
[Unit]
Description=Clash Proxy Service
After=network.target

[Service]
Type=simple
User=$USER
ExecStart=$PROXY_DIR/clash -d $PROXY_DIR -f $PROXY_DIR/config.yaml
Restart=on-failure

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable clash
sudo systemctl restart clash
echo "Clash 已启动 (端口 7890/9090)"

# 3. 启动 ClewdR
echo -e "${BLUE}[3/6] 启动 ClewdR...${NC}"
cd "$CLEWDR_DIR"
docker build -t clewdr-local .

docker rm -f clewdr 2>/dev/null || true

# 如果有备份的 config，挂载进去
CLEWDR_CONFIG_ARG=""
if [ -f "clewdr.toml" ]; then
    CLEWDR_CONFIG_ARG="-v $(pwd)/clewdr.toml:/app/clewdr.toml"
    echo "发现已备份的 ClewdR 配置，正在恢复..."
fi

# 启动 ClewdR 容器
docker run -d \
  --restart always \
  --name clewdr \
  $CLEWDR_CONFIG_ARG \
  -p 8484:8484 \
  -e HTTP_PROXY=http://172.17.0.1:7890 \
  -e HTTPS_PROXY=http://172.17.0.1:7890 \
  -e CLEWDR_CHECK_UPDATE=false \
  -e CLEWDR_AUTO_UPDATE=false \
  -e CLEWDR_IP=0.0.0.0 \
  -e CLEWDR_PORT=8484 \
  clewdr-local

echo "ClewdR 已启动 (端口 8484)"

# 4. 启动 API Gateway (api_change)
echo -e "${BLUE}[4/6] 启动 API Gateway (api_change)...${NC}"
mkdir -p "$API_DIR"
cd "$API_DIR"

if [ ! -f "Dockerfile" ]; then
    echo "错误: 找不到 api_change 的 Dockerfile"
    exit 1
fi

docker build -t api-change-local .

docker rm -f api_change 2>/dev/null || true

# 确保 keys.json 存在以便挂载
if [ ! -f "keys.json" ]; then
    echo "{}" > keys.json
fi
# 确保 config.json 存在以便挂载 (用于存储上游 URL 配置)
if [ ! -f "config.json" ]; then
    echo "{}" > config.json
fi

# 启动 API Change 容器
# CLEWDR_BASE_URL 指向宿主机的 8484 (172.17.0.1 是 Docker 默认网关)
docker run -d \
  --restart always \
  --name api_change \
  -p 8383:8383 \
  -e PORT=8383 \
  -e CLEWDR_BASE_URL=http://172.17.0.1:8484 \
  -e CLEWDR_API_KEY=sk-ponsde \
  -e GATEWAY_ADMIN_KEY=sk-ponsde \
  -e KEYS_FILE=/app/keys.json \
  -v $(pwd)/keys.json:/app/keys.json \
  -v $(pwd)/config.json:/app/config.json \
  api-change-local

echo "API Change 已启动 (端口 8383)"

# 5. 设置自动备份任务
echo -e "${BLUE}[5/6] 设置自动备份任务...${NC}"
cd "$REPO_DIR"
chmod +x auto_backup.sh

(crontab -l 2>/dev/null | grep -v "clewdr" | grep -v "auto_backup"; \
 echo "0 3 * * * /usr/bin/docker restart clewdr"; \
 echo "30 3 * * * /bin/bash $REPO_DIR/auto_backup.sh") | crontab -

# 6. 防火墙
echo -e "${BLUE}[6/6] 配置防火墙...${NC}"
if command -v ufw &> /dev/null; then
    sudo ufw allow 8484/tcp
    sudo ufw allow 9090/tcp
    sudo ufw allow 8383/tcp  # 开放 API Gateway 端口
    sudo ufw reload
fi

echo -e "${GREEN}=== 部署完毕！ ===${NC}"
echo -e "API Gateway 地址: http://<IP>:8383"
echo -e "Admin Key: sk-daili-admin"
