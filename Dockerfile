# 正式機的映像檔（fly.toml、docs/deploy.md）：建好前端，放進 Rust 伺服器的映像檔，同一個網址送出（ADR 0012）。

# 前端：網址底下沒有子路徑，不設 BASE_PATH。
FROM node:26-trixie-slim AS frontend
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# 伺服器：build.rs 用 node 打包流程核心、算指紋（ADR 0013），所以要 node 和上面裝好的 node_modules；
# 跟前端用同一份，兩邊的指紋才一樣。
FROM rust:1.98-trixie AS server
COPY --from=frontend /usr/local/bin/node /usr/local/bin/node
WORKDIR /src
COPY --from=frontend /src /src
RUN cd server && cargo build --release --locked

FROM debian:trixie-slim
# 連 Neon、Resend、R2、Pwned Passwords 都走 TLS，要有根憑證。
# 每天的備份（#265）跑 pg_dump：版本要跟資料庫一樣是 18。Debian trixie 自己的是 17（Neon 的備份範本也寫 17，不能照抄），
# 所以從 PostgreSQL 官方的 apt 套件庫（PGDG）裝 postgresql-client-18，PATH 指到它，不會拿到別版。
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates postgresql-common \
    && /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh -y \
    && apt-get install -y --no-install-recommends postgresql-client-18 \
    && rm -rf /var/lib/apt/lists/*
ENV PATH=/usr/lib/postgresql/18/bin:$PATH
WORKDIR /app
COPY --from=server /src/server/target/release/cheer-server /app/cheer-server
COPY --from=frontend /src/build /app/build
ENV LISTEN_ADDR=0.0.0.0:8080 SITE_DIR=/app/build
EXPOSE 8080
CMD ["/app/cheer-server"]
