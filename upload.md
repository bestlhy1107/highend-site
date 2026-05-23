git status
git add .
git commit -m "本次更新说明"
git push origin main


git add 是把改动加入暂存区，git commit 提交已暂存内容，git push origin main 把本地 main 更新发到远程 origin/main。

然后去阿里云服务器，进入项目目录，直接运行你已经建好的脚本：

cd /root/highend-site
./deploy.sh

你这个脚本的核心思路是对的：先 git pull --ff-only origin main 拉代码，再 npm install、npm run build，最后 pm2 restart。git pull --ff-only 只允许快进更新，分支发生分叉时会失败；Astro standalone 构建完成后会产出 ./dist/server/entry.mjs；PM2 则负责后台重启和常驻。

如果这次更新改了 .env 环境变量，比如后台账号、邮箱配置、数据库地址，不要只跑普通重启。PM2 官方说明，通过 CLI 重启时，新的环境变量默认不会自动更新进进程，必须带 --update-env。所以服务器上要这样跑：

cd /root/highend-site
set -a
source ./.env
set +a
pm2 restart highend-site --update-env
pm2 save

这样新环境变量才会真正进入运行进程。

如果这次更新改了数据库结构，你还要在服务器上额外执行一次远程数据库同步，再重启服务：

cd /root/highend-site
set -a
source ./.env
set +a
npx astro db push --remote
./deploy.sh

你现在项目里用了 Astro DB 远程库，这一步只在“表结构变了”时需要，普通文案、页面、样式修改不需要。Astro Node 仍然按 npm run build → node ./dist/server/entry.mjs 这套上线。

更新完成后，立刻验收这几项：

pm2 status
pm2 logs highend-site --lines 50
curl -I https://wanhe68.com
curl -I https://www.wanhe68.com
curl -I https://www.wanhe68.com/admin/login

PM2 官方文档说明，pm2 logs 可以直接看实时日志；只要进程 online、域名返回正常状态码，基本就说明这次官网更新已经生效。

你前面已经遇到过一次 git pull 被服务器本地文件挡住的情况。以后如果服务器提示“local changes would be overwritten by merge”，先在服务器里清掉运行时冲突文件，再重新部署：

cd /root/highend-site
git restore data/scores.json
git clean -f public/uploads/scores/
./deploy.sh