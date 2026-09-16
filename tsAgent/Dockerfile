# tsAgent 镜像：Bun 原生跑 TS（无需编译步骤）
# 默认 = 在线服务精简版：embedding 走 dashscope（EMBED_BACKEND env），不烤 Python（扫描/复杂件在笔记本解析后推服务器 Qdrant）
# 需要服务器也能全量解析（pytools 三件套+VL 桥）→ 解开下面"可选解析全家桶"三行
# bun 主次版本与本机锁文件生成器对齐（本机 1.3.14），防 lock 格式不认
FROM oven/bun:1.3-slim
WORKDIR /app

COPY package.json bun.lock ./
# frozen 装锁定的依赖树；linux 原生模块（jieba）由 bun 按平台自动选包
RUN bun install --frozen-lockfile --production

COPY . .

# ── 解析全家桶：9/7 晚转正。text 家族（md/txt/csv）没有手写容灾，
#    md_to_blocks 的块结构只活在 pytools 里；/ingest 上传口以后收 pdf/docx 也靠它。
#    pip 走腾讯云 pypi 全量镜像（机器就在腾讯内网；清华源缺 pymupdf4llm）；
#    PEP668 铁腕（bookworm 禁全局装）→ --break-system-packages 放行
#    9/7 深夜血泪：deb.debian.org 拉 9.6M 索引跑了 7 分钟 → apt 也钉腾讯内网源（trixie 用 deb822 格式）
RUN sed -i 's|deb.debian.org|mirrors.cloud.tencent.com|g' /etc/apt/sources.list.d/debian.sources \
	&& apt-get update && apt-get install -y --no-install-recommends python3 python3-pip && rm -rf /var/lib/apt/lists/*
RUN pip3 install --no-cache-dir --break-system-packages -i https://mirrors.cloud.tencent.com/pypi/simple -r pytools/requirements.txt

EXPOSE 8123
CMD ["bun", "run", "src/service/server.ts"]
