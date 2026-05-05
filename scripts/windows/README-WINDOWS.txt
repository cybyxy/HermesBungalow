HermesBungalow — Windows 快速运行（发布包内）

一、前置条件
  1) 安装 Python 3.11+（推荐与 Hermes 文档一致），并勾选「Add to PATH」。
  2) 本机已安装 Hermes 主目录（默认 %USERPROFILE%\.hermes），含 config / provider 等；串门另需配置：
     - %USERPROFILE%\.hermes\.env 中设置 HERMES_BUNGALOW_PEER_TOKEN、HERMES_BUNGALOW_PEERS 等（见主仓库文档）。

二、首次运行
  A) 发布包：解压 zip，进入解压后的根目录（与 backend、frontend 同级），执行：
       powershell -ExecutionPolicy Bypass -File .\start-bungalow.ps1
  B) 从 Git 仓库：在仓库根目录执行（脚本在 scripts\windows\，会自动定位 backend）：
       powershell -ExecutionPolicy Bypass -File .\scripts\windows\start-bungalow.ps1
     脚本会创建 backend\.venv 并 pip install -r（根目录或 backend 下的 requirements；需联网）。

三、访问
  - 浏览器打开：http://127.0.0.1:8000/
  - 局域网其它机器：http://本机局域网IP:8000/
  - 若 8000 被占用，可先 set PORT=8001 再运行脚本（或改脚本内端口）。

四、说明
  - 本包为「后端 + 已构建前端静态资源」单端口部署；不再单独起 Vite 3000。
  - 数据默认写在 backend\data\game.db（随包目录变化）；备份该目录即可。
