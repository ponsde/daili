#!/bin/bash
set -e

# 颜色定义
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${GREEN}=== 开始部署服务 (基于 daili 仓库) ===${NC}"

# 当前目录就是仓库根目录
REPO_DIR=$(pwd)
PROXY_DIR="$REPO_DIR/run/proxy"
CLEWDR_DIR="$REPO_DIR/run/clewdr"

# 1. 安装 Docker
echo -e "${BLUE}[1/5] 检查 Docker 环境...${NC}"
if ! command -v docker &> /dev/null; then
    curl -fsSL https://get.docker.com | bash
fi

# 2. 启动 Clash
echo -e "${BLUE}[2/5] 启动 Clash 代理...${NC}"
chmod +x "$PROXY_DIR/clash"

# 更新 systemd 指向仓库内的位置
sudo tee /etc/systemd/system/clash.service <<EOF
[Unit]
Description=Clash Proxy Service
After=network.target

[Service]
Type=simple
User=$USER
# 直接运行仓库里的文件，这样自动备份时改的就是它
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
echo -e "${BLUE}[3/5] 启动 ClewdR...${NC}"
cd "$CLEWDR_DIR"
docker build -t clewdr-local .

docker rm -f clewdr 2>/dev/null || true

# 如果有备份的 config，挂载进去；如果没有，让它生成
CLEWDR_CONFIG_ARG=""
if [ -f "clewdr.toml" ]; then
    CLEWDR_CONFIG_ARG="-v $(pwd)/clewdr.toml:/app/clewdr.toml"
    echo "发现已备份的 ClewdR 配置，正在恢复..."
fi

# 启动容器
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

# 4. 设置自动备份任务
echo -e "${BLUE}[4/5] 设置自动备份任务...${NC}"
cd "$REPO_DIR"
chmod +x auto_backup.sh

# 清理旧任务并添加新任务
(crontab -l 2>/dev/null | grep -v "clewdr" | grep -v "auto_backup"; \
 echo "0 3 * * * /usr/bin/docker restart clewdr"; \
 echo "30 3 * * * /bin/bash $REPO_DIR/auto_backup.sh") | crontab -

# 5. 防火墙
echo -e "${BLUE}[5/5] 配置防火墙...${NC}"
if command -v ufw &> /dev/null; then
    sudo ufw allow 8484/tcp
    sudo ufw allow 9090/tcp
    sudo ufw reload
fi

echo -e "${GREEN}=== 部署完毕！ ===${NC}"
