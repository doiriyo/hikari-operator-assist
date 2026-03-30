# 必要ライブラリ: pip install winsdk flask flask-cors
# 自動起動設定: Windowsタスクスケジューラで「ログオン時」にpythonw.exeで実行

import re
import time
import threading
import sys

try:
    from winsdk.windows.ui.notifications.management import UserNotificationListener
    from winsdk.windows.ui.notifications import NotificationKinds
    import asyncio
except ImportError:
    print("エラー: winsdkライブラリが見つかりません。")
    print("pip install winsdk を実行してください。")
    sys.exit(1)

from flask import Flask, jsonify
from flask_cors import CORS

# --- 共有状態 ---
latest_call = {"phone": None, "timestamp": None}

PHONE_PATTERN = re.compile(r'(0\d{1,4}[-\s]?\d{1,4}[-\s]?\d{4}|0\d{9,10})')


# =============================================================
# 通知監視
# =============================================================

async def poll_notifications():
    """Windows通知を定期的にポーリングして電話番号を検知する。"""
    listener = UserNotificationListener.current
    access = await listener.request_access_async()
    # access == 0: Allowed
    if access != 0:
        print(f"通知アクセスが拒否されました (code={access})。設定で通知アクセスを許可してください。")
        return

    seen_ids = set()

    while True:
        try:
            notifications = await listener.get_notifications_async(NotificationKinds.TOAST)
            for n in notifications:
                nid = n.id
                if nid in seen_ids:
                    continue
                seen_ids.add(nid)

                # 通知テキストを取得
                try:
                    text_sequence = n.notification.visual.get_binding(
                        "ToastGeneric"
                    ).get_text_elements()
                    parts = []
                    for i in range(text_sequence.size):
                        parts.append(text_sequence.get_at(i).text)
                    text = " ".join(parts)
                except Exception:
                    continue

                match = PHONE_PATTERN.search(text)
                if match:
                    phone = re.sub(r'[-\s]', '', match.group(1))
                    latest_call["phone"] = phone
                    latest_call["timestamp"] = int(time.time())
                    print(f"着信検知: {phone}")
        except Exception as e:
            print(f"通知取得エラー: {e}")

        await asyncio.sleep(2)


def start_notification_watcher():
    """通知監視ループを別スレッドで実行する。"""
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    loop.run_until_complete(poll_notifications())


# =============================================================
# Flask HTTPサーバー
# =============================================================

app = Flask(__name__)
CORS(app)


@app.route("/latest-call", methods=["GET"])
def get_latest_call():
    return jsonify(latest_call)


@app.route("/clear", methods=["POST"])
def clear_call():
    latest_call["phone"] = None
    latest_call["timestamp"] = None
    return jsonify({"success": True})


# =============================================================
# エントリーポイント
# =============================================================

if __name__ == "__main__":
    # 通知監視スレッドを開始
    watcher_thread = threading.Thread(target=start_notification_watcher, daemon=True)
    watcher_thread.start()
    print("通知監視を開始しました。")

    # Flaskサーバーをポートフォールバック付きで起動
    for port in (3456, 3457, 3458):
        try:
            print(f"HTTPサーバーを起動します: http://localhost:{port}")
            app.run(host="127.0.0.1", port=port)
            break
        except OSError as e:
            print(f"ポート {port} で起動失敗: {e}")
    else:
        print("エラー: すべてのポート (3456-3458) が使用中です。終了します。")
        sys.exit(1)
