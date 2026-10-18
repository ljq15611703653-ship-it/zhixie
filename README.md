# 智械危机征召令

回答 20 个问题，剧情跟着你的回答一路改写，最后生成一张“智械危机时，你是：”的海报。

- **完整版（接模型）**：用 `app.js` 跑在自己的服务器上，见下文。
- **GitHub Pages 版**：https://ljq15611703653-ship-it.github.io/zhixie/ 只能用内置模板出题。pincc 等不允许网页直接调用的接口，在这里接不上模型。

## 在腾讯云服务器上部署（约 5 分钟）

需要 Node 18 及以上（`node -v` 查看）。

```bash
git clone https://github.com/ljq15611703653-ship-it/zhixie.git
cd zhixie
LLM_API_KEY=你的key INVITE_CODE=自己定一串邀请码 nohup node app.js > zhixie.log 2>&1 &
```

然后在腾讯云控制台的**安全组**里放行 TCP 8787 端口。发给同学的链接：

```
http://服务器公网IP:8787/#i=邀请码
```

- key 只存在服务器上，网页里看不到。
- 没有邀请码的人也能打开页面，但只能用模板出题，不会花你的额度。
- 默认模型 `gpt-5.6-terra`，接口 `https://v2-as.pincc.ai/v1`。用 `LLM_MODEL`、`LLM_BASE_URL` 可以换。
- 默认限额：全站每天 3000 次模型调用（完整玩一遍约 17 次），每个 IP 每分钟 30 次、每天 200 次。用 `DAILY_CAP`、`IP_PER_MIN`、`IP_PER_DAY` 可以改。

更新：`git pull`，然后停掉旧进程（`pkill -f "node app.js"`）再按上面的命令启动一次。

## 修改

整个游戏就是一个 `index.html`。`app.js` 负责提供网页和转发模型请求。
