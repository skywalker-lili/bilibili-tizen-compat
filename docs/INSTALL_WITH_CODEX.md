# 在另一台电脑上用 Codex 给三星电视安装

本指南面向**新的电脑和新的 Codex 会话**。要安装的是三星 **Tizen 电视**上的 Web 应用，不是 Android 手机 APK。此仓库是 [skywalker-lili/bilibili-tizen-compat](https://github.com/skywalker-lili/bilibili-tizen-compat)；不要误用原作者的 [titlog/bilibili-tizen](https://github.com/titlog/bilibili-tizen) 或某台电脑上的本地开发台。原项目作者、基点提交与本版改动见 [README](../README.md)。

这次交接的源码为 **`v1.0.17-rc.1`**，安装包及电视「设置」页都应显示 **1.0.17**。它的剧集导航已通过本地检查，**尚未在电视上实测**；此前 1.0.16 的主要功能只在 Q90T / Tizen 5.5 上实测过。朋友的机型即使满足最低版本，也要当作新机型验证。`app/config.xml` 声明最低 Tizen 5.5；更早的系统不适用。官方番剧／影视独立播放接口不在这次剧集功能范围内。

## 可交给新 Codex 会话的任务

> 请帮我把 `https://github.com/skywalker-lili/bilibili-tizen-compat` 的 `v1.0.17-rc.1` 源码安装到我面前这台三星 Tizen 电视。先读仓库的 `README.md`、`docs/INSTALL_WITH_CODEX.md` 和 `app/config.xml`，确认电视型号、Tizen 版本、电脑系统及当前局域网地址。使用这台电视自己的 Samsung 签名证书；不要复用作者的 DUID、证书或本地 IP。先运行仓库测试，再按电脑系统选择 macOS 脚本或 Windows 的 Tizen Studio 流程。需要我操作电视遥控器、登录三星账号或授权时，明确告诉我具体步骤。安装后核对电视「设置」页为 1.0.17，并测试分 P、UP 主合集的上一集／下一集和当前集定位。不要把证书、密码、DUID、账号令牌、诊断日志或已签名的 `.wgt` 提交到 GitHub。

公开仓库可直接 `git clone`，**不需要在朋友电脑上登录项目作者的 GitHub 账号**。建议克隆到只含 ASCII 字符的路径，减少旧版 Tizen 工具链处理路径名时的问题。

```bash
git clone https://github.com/skywalker-lili/bilibili-tizen-compat.git
cd bilibili-tizen-compat
git checkout v1.0.17-rc.1
npm ci --prefix tools
npm test --prefix tools
```

`git checkout` 后是 detached HEAD，**用于安装完全正常**；无需创建分支或推送。检查 `app/config.xml` 的版本为 `1.0.17`、最低系统为 `5.5`，`app/js/config.js` 中 `SELFTEST = false` 且 `REPORT_TO = ""`。不要使用 `--selftest` 安装日常观看版本。构建前确认工作树没有未知改动；不要把某台电脑上生成的 `.wgt` 当作可给另一台电视通用的安装包。

## 在电视和电脑上确认的事

1. 在朋友同意安装后，记录电视的**完整型号、Tizen 版本和固件**。Tizen 低于 5.5 就停止；其他机型都属于未验证范围。
2. 让电视和笔记本连到**可互通的同一局域网**。同名 Wi-Fi 不保证互通：访客网络、客户端隔离或 VPN 可能挡住 `26101` 端口。电脑从 Wi-Fi 换到网线或换热点后，要重新核对它实际使用的局域网 IP。
3. 在电视登录朋友自己的三星账号，打开 **Apps** 商店页面（可进入右上角设置），用遥控器依次输入 `12345`；只有带 `123` 键的遥控器时，先呼出数字条，逐个选中数字并按确认，最后选 **Done**，等 Developer mode 弹窗出现。将 Developer mode 设为 On，并把 **Host PC IP** 填为这台笔记本当前的局域网 IP。确认后按电视提示完整重启。电视 IP 可在电视网络设置或路由器客户端列表里查看。Host PC IP 是**电脑**地址，连接目标是**电视**地址，两者不要填反。
4. 需要签名时从电视开发者界面读取它自己的 DUID，并在这台笔记本上创建针对该电视的 Samsung 证书。DUID、私钥、证书密码和二维码登录资料只保存在当地电脑／电视，不贴到公开 issue 或提交到仓库。

三星官方的 [Tizen Studio 安装说明](https://developer.samsung.com/smarttv/develop/getting-started/setting-up-sdk/installing-tv-sdk.html)及[连接真机说明](https://developer.samsung.com/smarttv/develop/getting-started/using-sdk/tv-device.html)可用于核对开发者模式、证书和设备连接步骤。

## 按笔记本系统安装

**macOS：**安装 Node.js、Python 3、zsh、Tizen Studio、TV Extensions 和 Samsung Certificate Extension，确保 `sdb`、`tizen` 可运行。仓库提供的 `tools/setup.sh` 和 `tools/deploy.sh` 使用 macOS 的 `ifconfig -l` / `ipconfig getifaddr`，应在 macOS 上运行，不要直接拿到 Windows 或 Linux 执行。完成上面的 `npm ci` 和测试后：

```bash
zsh tools/setup.sh
zsh tools/deploy.sh
```

`setup.sh` 会核对笔记本网卡、电视 IP、开发者模式、DUID，并在仓库**外**建立本机配置和证书；三星授权需要用户自己在浏览器中完成。`deploy.sh` 会检查、签名、安装并尝试启动。它在打包时临时写入诊断地址，结束后应恢复 `app/js/config.js`；运行后检查 `git status --short`，不要提交或分享含个人局域网地址的改动。如果 `sdb` 连不上，先核对电视上 Host PC IP 与电脑当前 IP，随后重启电视再试。

**Windows：**当前 macOS 脚本**不支持 Windows**，也没有在全新 Windows 笔记本上验证过一键安装。安装 Tizen Studio、TV Extensions、Samsung Certificate Extension。用 Certificate Manager 为这台电视的 DUID 创建 Samsung TV 签名 profile，再用 Remote Device Manager 连接电视 `26101` 端口。可以通过 Tizen Studio 导入 `app/` 作为 TV Web 项目并使用 **Run As → Tizen Web Application**；详见 [README 的 Windows 流程](../README.md#安装与更新)。熟悉 CLI 的 Codex 也可参考仓库的 `tools/deploy.sh`：在 `app/` 中用 `tizen package -t wgt -s <本机profile> -- .` 打包，再用 `tizen install -n <新生成的文件名.wgt> -t <电视target>` 安装，最后用 `tizen run -p Q90TBili01.Bilibili -t <电视target>` 启动。`sdb devices` 可核对 target。请让新会话根据**本机实际 Tizen Studio 版本**确认命令参数与打包结果，不要沿用旧电脑上的 profile 名或签名包。

**Linux：**仓库没有已验证的 Linux 安装脚本；请根据 Samsung Tizen Studio 的 Linux 工具链和 Windows 手动流程逐步执行，记录实际结果，不要把 macOS 脚本当成跨平台脚本。

如果电视已有相同应用但由**不同作者证书**签名，更新可能无法直接覆盖；卸载重装可能清除电视内的登录和设置。先确认正在安装到正确的电视，再处理旧安装。安装显示成功也要在电视中实际打开、查看「设置」页版本；单纯 `sdb install` 报传输成功不足以证明新代码已运行。

## 安装后的最小验证

1. 电视「设置」页显示 **版本 1.0.17**，普通推荐视频可以播放／暂停。
2. 打开有多个分 P 的视频，切到中间或靠后的 P；播放时按下键，操作行能看到适用的「上一集」「下一集」，再按下键进入分 P 列表时焦点在当前 P。分别测试切换前后 P。
3. 打开 UP 主创建的**跨视频合集**，确认相邻集按钮和当前集定位；若合集超过 50 集，试试「更早集数／更晚集数」。在一个视频最后一 P 与下一视频的边界也检查一次。普通视频没有合集信息时不应出现无效按钮。
4. 抽查原有播放、返回键、评论面板和设置。发现问题时记录电视型号、Tizen/固件、应用版本、操作步骤及现象；公开反馈前删掉账号、DUID、IP 和令牌。

完成上述验证后，才能把这台新机型写入「已实测」范围。安装到朋友电视不需要 GitHub Actions、服务器、U 盘或让笔记本在播放时一直开机。
