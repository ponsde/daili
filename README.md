# Daili (Claude 全能网关)

集成了 Clash 代理、ClewdR (Web 转 API) 以及 OpenAI 格式转换网关的一站式解决方案。
支持国内环境一键部署、Web UI 管理、以及配置自动备份到 GitHub。

## ✨ 功能特性

- **🚀 内置科学上网**: 集成 Clash Meta 核心，自动管理 GeoIP 数据库，确保 Docker 和 ClewdR 服务稳定连接。
- **🤖 ClewdR 转换**: 将 Claude 网页版转换为 API 接口 (`:8484`)。
- **🔌 OpenAI 网关**: 提供标准的 `/v1/chat/completions` 接口 (`:8383`)，完美支持 LobeChat 等客户端，自动处理图像格式转换。
- **💾 自动云备份**: 每天凌晨 03:30 自动将 Cookie、API Key 和配置文件同步回本 GitHub 仓库，防丢防炸。
- **📊 Web 管理面板**: 可视化管理 API Key、修改上游转发地址，无需黑屏操作。

## 🛠️ 快速部署

在服务器上运行以下命令即可（需 Root 权限，脚本会自动安装 Docker）：

```bash
git clone https://github.com/ponsde/daili.git
cd daili
bash install.sh
```

## 📡 服务端口说明

| 服务 | 端口 | 说明 | 关键地址/信息 |
| :--- | :--- | :--- | :--- |
| **API 网关 (主)** | `8383` | **对外主要接口**，支持 OpenAI 格式 | BaseURL: `http://IP:8383/v1`<br>UI: `http://IP:8383/ui` |
| **ClewdR** | `8484` | 原始 ClewdR 服务 (Anthropic 格式) | `http://IP:8484` |
| **Clash 面板** | `9090` | 代理管理后台 | `http://IP:9090/ui`<br>Secret: `0618pauL` |
| **Clash 代理** | `7890` | 本地 HTTP/SOCKS5 代理 | `http://127.0.0.1:7890` |

---

## 📖 使用指南

### 1. 对接客户端 (推荐)
适用于 LobeChat, NextChat, Immersive Translate 等支持 OpenAI 格式的软件。

- **接口地址 (Base URL)**: `http://<服务器IP>:8383/v1`
- **API Key**: 在 UI 面板中自行生成的 Key (或者填 `sk-daili` 试用)
- **模型**: `claude-3-5-sonnet-20240620` 等 ClewdR 支持的模型

### 2. 网关管理后台
- **地址**: `http://<服务器IP>:8383/ui`
- **管理员密钥 (Admin Key)**: `sk-ponsde`
- **功能**:
    - 添加/删除 API Key
    - 修改 ClewdR 上游地址 (例如端口变动时)
    - 查看服务健康状态

### 3. 系统维护
- **自动备份**: 系统已自动设置 Crontab，每天凌晨 3:30 自动提交更改到 GitHub。
- **手动备份**:
  ```bash
  bash /home/ubuntu/daili/auto_backup.sh
  ```
- **查看日志**:
  ```bash
  docker logs -f api_change   # 网关日志
  docker logs -f clewdr       # ClewdR 日志
  sudo systemctl status clash # 代理状态
  ```

## 📂 目录结构

```text
/home/ubuntu/daili
├── run/
│   ├── api_change/   # OpenAI 网关代码 & 配置 (keys.json, config.json)
│   ├── clewdr/       # ClewdR Docker 配置 (clewdr.toml 存放在此)
│   └── proxy/        # Clash 核心 & 配置文件
├── install.sh        # 一键安装/更新脚本
└── auto_backup.sh    # 自动备份脚本
```

## ⚠️ 注意事项
- 请确保云服务器防火墙 (安全组) 放行了 `8383`, `8484`, `9090` 端口。
- 首次部署后，建议立即登录 ClewdR (`:8484`) 完成 Cookie 登录。
