# ClewdR 一键迁移包

本仓库包含了您的 ClewdR 和 Clash 代理的完整配置。

## 包含文件
- `proxy_tool/`: Clash 核心程序、配置文件和 UI 面板
- `clewdr/`: ClewdR 二进制文件和 Dockerfile
- `install.sh`: 一键安装脚本

## 迁移指南 (在新服务器上执行)

### 1. 克隆仓库
登录新服务器，运行：
```bash
git clone https://github.com/ponsde/daili.git
cd daili
```

### 2. 运行安装脚本
赋予脚本执行权限并运行：
```bash
chmod +x install.sh
./install.sh
```

脚本会自动完成以下操作：
- 安装 Docker (如果没有)
- 配置并启动 Clash 代理服务
- 构建 ClewdR 镜像并启动容器
- 设置 Docker 的代理环境变量
- 配置每天凌晨 3 点自动重启
- 放行 UFW 防火墙端口 (8484, 9090)

### 3. 开始使用
安装完成后，直接访问：
- **ClewdR**: `http://你的IP:8484`
- **代理管理**: `http://你的IP:9090/ui` (Secret: `0618pauL`)

---
**注意**：请确保新服务器的安全组（阿里云/腾讯云后台）也放行了 TCP 8484 和 9090 端口。
