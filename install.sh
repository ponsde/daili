#!/bin/bash
set -e

# 颜色定义
GREEN='\033[0;32m'
NC='\033[0m' # No Color

echo -e "${GREEN}=== 开始部署 ClewdR + Clash 代理服务 ===${NC}"

# 1. 基础环境检查与安装
echo -e "${GREEN}[1/6] 检查/安装 Docker...${NC}"
if ! command -v docker &> /dev/null; then
    echo "Docker 未安装，正在尝试自动安装..."
    curl -fsSL https://get.docker.com | bash
else
    echo "Docker 已安装。"
fi

# 2. 部署 Clash 代理
echo -e "${GREEN}[2/6] 部署 Clash 代理...${NC}"
INSTALL_DIR="$HOME/proxy_tool"
mkdir -p "$INSTALL_DIR"

# 复制文件
cp -r proxy_tool/* "$INSTALL_DIR/"
chmod +x "$INSTALL_DIR/clash"

# 创建 systemd 服务
echo "配置 Systemd 服务..."
sudo tee /etc/systemd/system/clash.service <<EOF
[Unit]
Description=Clash Proxy Service
After=network.target

[Service]
Type=simple
User=$USER
ExecStart=$INSTALL_DIR/clash -d $INSTALL_DIR -f $INSTALL_DIR/config.yaml
Restart=on-failure

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable clash
sudo systemctl restart clash
echo "Clash 服务已启动。"

# 3. 部署 ClewdR
echo -e "${GREEN}[3/6] 构建并启动 ClewdR...${NC}"
cd clewdr
# 构建镜像
echo "正在构建 Docker 镜像 (可能需要几分钟)..."
docker build -t clewdr-local .

# 删除旧容器（如果存在）
docker rm -f clewdr 2>/dev/null || true

# 启动容器
# 注意：这里使用 172.17.0.1 作为宿主机网关，确保能连上 Clash
docker run -d \
  --restart always \
  --name clewdr \
  -p 8484:8484 \
  -e HTTP_PROXY=http://172.17.0.1:7890 \
  -e HTTPS_PROXY=http://172.17.0.1:7890 \
  -e CLEWDR_CHECK_UPDATE=false \
  -e CLEWDR_AUTO_UPDATE=false \
  -e CLEWDR_IP=0.0.0.0 \
  -e CLEWDR_PORT=8484 \
  clewdr-local

echo "ClewdR 容器已启动。"
cd ..

# 4. 设置自动重启任务
echo -e "${GREEN}[4/6] 配置自动重启任务...${NC}"
(crontab -l 2>/dev/null | grep -v "clewdr" ; echo "0 3 * * * /usr/bin/docker restart clewdr") | crontab -
echo "已添加每天凌晨 3 点重启任务。"

# 5. 配置防火墙
echo -e "${GREEN}[5/6] 配置防火墙 (UFW)...${NC}"
if command -v ufw &> /dev/null; then
    sudo ufw allow 8484/tcp
    sudo ufw allow 9090/tcp
    sudo ufw reload
    echo "已放行 8484 和 9090 端口。"
else
    echo "未检测到 UFW，请手动放行防火墙端口 8484 和 9090。"
fi

# 6. 完成
echo -e "${GREEN}=== 部署完成！ ===${NC}"
IP=$(curl -s ifconfig.me || echo "您的服务器IP")
echo ""
echo "访问地址："
echo "1. ClewdR 服务: http://$IP:8484"
echo "2. 代理控制台: http://$IP:9090/ui"
echo ""
echo "控制台 Secret: 0618pauL (如需修改请编辑 ~/proxy_tool/config.yaml)"
