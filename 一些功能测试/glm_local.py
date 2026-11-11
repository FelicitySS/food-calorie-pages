#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
GLM 图片识别工作台 · 本地代理服务

用法：
    cd 一些功能测试
    python3 glm_local.py

然后在浏览器打开：http://127.0.0.1:8765

作用：
    1. 在 8765 端口托管当前文件夹里的 HTML 页面
    2. 提供 /api/analyze 接口，把请求转发到智谱 API，绕开浏览器跨域限制

只依赖 Python 标准库，无需安装任何第三方包。
"""

import json
import os
import sys
import urllib.error
import urllib.request
from http.server import HTTPServer, SimpleHTTPRequestHandler

HOST = "127.0.0.1"
PORT = 8765
UPSTREAM = "https://open.bigmodel.cn/api/paas/v4/chat/completions"
TIMEOUT = 120  # 秒；免费模型繁忙时可能较慢

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
INDEX_FILE = "GLM_图片识别工作台.html"


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=BASE_DIR, **kwargs)

    # ---------- 静态文件 ----------
    def do_GET(self):
        if self.path in ("/", "/index.html"):
            self.path = "/" + INDEX_FILE
        return super().do_GET()

    # ---------- 代理接口 ----------
    def do_POST(self):
        if self.path.rstrip("/") != "/api/analyze":
            self.send_json(404, {"error": {"message": "未知接口：" + self.path}})
            return

        try:
            length = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(length).decode("utf-8"))
        except Exception:
            self.send_json(400, {"error": {"message": "请求体不是合法的 JSON"}})
            return

        api_key = (body.get("api_key") or "").strip()
        payload = body.get("payload")
        if not api_key:
            self.send_json(400, {"error": {"message": "缺少 api_key"}})
            return
        if not isinstance(payload, dict):
            self.send_json(400, {"error": {"message": "缺少 payload"}})
            return

        req = urllib.request.Request(
            UPSTREAM,
            data=json.dumps(payload).encode("utf-8"),
            method="POST",
            headers={
                "Content-Type": "application/json",
                "Authorization": "Bearer " + api_key,
            },
        )

        try:
            with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
                self.send_bytes(resp.status, resp.read())
        except urllib.error.HTTPError as e:
            # 把智谱返回的错误原样转给页面
            self.send_bytes(e.code, e.read())
        except Exception as e:
            self.send_json(502, {"error": {"message": f"转发请求失败：{e}"}})

    # ---------- 工具 ----------
    def send_json(self, status, obj):
        self.send_bytes(status, json.dumps(obj, ensure_ascii=False).encode("utf-8"))

    def send_bytes(self, status, data):
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        try:
            self.wfile.write(data)
        except BrokenPipeError:
            pass

    def log_message(self, fmt, *args):
        sys.stderr.write("[glm_local] %s\n" % (fmt % args))


def main():
    index_path = os.path.join(BASE_DIR, INDEX_FILE)
    if not os.path.exists(index_path):
        print(f"警告：未找到 {INDEX_FILE}，请确认它和本脚本在同一文件夹。")

    server = HTTPServer((HOST, PORT), Handler)
    print(f"GLM 图片识别工作台已启动：http://{HOST}:{PORT}")
    print("按 Ctrl+C 停止服务。")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n已停止。")
        server.server_close()


if __name__ == "__main__":
    main()
