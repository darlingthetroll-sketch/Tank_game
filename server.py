from flask import Flask, render_template, request
from flask_socketio import SocketIO, emit, join_room
import random, string

app = Flask(__name__)
socketio = SocketIO(app,
    cors_allowed_origins="*",
    async_mode="threading",
    logger=False,
    engineio_logger=False
)

rooms = {}
MAX_PLAYERS = 4

def make_rid():
    chars = string.ascii_uppercase + string.digits
    while True:
        rid = ''.join(random.choices(chars, k=5))
        if rid not in rooms:
            return rid

def next_slot(room):
    used = {p["slot"] for p in room["players"].values()}
    for s in range(MAX_PLAYERS):
        if s not in used:
            return s
    return None

def broadcast(rid, event, data, exclude=None):
    for pid in rooms[rid]["players"]:
        if pid != exclude:
            socketio.emit(event, data, to=pid)

@app.route("/")
def index():
    return render_template("index.html")

@socketio.on("connect")
def on_connect():
    print(f"[CONNECT] {request.sid[:8]}")

@socketio.on("create_room")
def on_create_room(data):
    pid  = request.sid
    name = data.get("name", "Player1")[:16]
    rid  = make_rid()
    rooms[rid] = {
        "seed": random.randint(0, 999999),
        "host": pid,
        "started": False,
        "settings": {"maze_complexity":100, "game_mode":"infinite", "score_limit":10},
        "players": {
            pid: {"id": pid, "name": name, "slot": 0,
                  "hp": 100, "alive": True, "score": 0, "x": 0, "y": 0, "angle": 0}
        }
    }
    join_room(rid)
    emit("room_created", {"room": rid, "slot": 0})
    print(f"[CREATE] {name} room={rid}")

@socketio.on("join_room_req")
def on_join_room(data):
    pid  = request.sid
    name = data.get("name", "Player")[:16]
    rid  = data.get("room", "").strip().upper()

    if rid not in rooms:
        emit("room_error", {"msg": f"Không tìm thấy phòng '{rid}'"}); return
    room = rooms[rid]
    if room.get("started"):
        emit("room_error", {"msg": "Trận đấu đã bắt đầu"}); return
    if len(room["players"]) >= MAX_PLAYERS:
        emit("room_error", {"msg": f"Phòng đã đầy ({MAX_PLAYERS}/{MAX_PLAYERS})"}); return

    slot = next_slot(room)
    room["players"][pid] = {
        "id": pid, "name": name, "slot": slot,
        "hp": 100, "alive": True, "score": 0, "x": 0, "y": 0, "angle": 0
    }
    join_room(rid)
    print(f"[JOIN] {name} slot={slot} room={rid}")

    existing = [{"id": p["id"], "name": p["name"], "slot": p["slot"]}
                for p in room["players"].values() if p["id"] != pid]
    emit("room_joined", {
        "room": rid, "slot": slot,
        "maze_seed": room["seed"],
        "existing_players": existing,
        "settings": room.get("settings", {})
    })

    broadcast(rid, "player_ready", {
        "id": pid, "name": name, "slot": slot,
        "count": len(room["players"])
    }, exclude=pid)
    print(f"[READY] room={rid} count={len(room['players'])}")

@socketio.on("start_game")
def on_start_game(data):
    pid = request.sid
    rid = data.get("room")
    if not rid or rid not in rooms: return
    room = rooms[rid]
    if room["host"] != pid:
        emit("room_error", {"msg": "Chỉ chủ phòng mới được bắt đầu"}); return
    if len(room["players"]) < 2:
        emit("room_error", {"msg": "Cần ít nhất 2 người chơi"}); return

    # Cập nhật settings từ host lúc bắt đầu (host chỉnh xong mới bấm bắt đầu)
    if any(k in data for k in ("maze_complexity", "game_mode", "score_limit")):
        room["settings"] = {
            "maze_complexity": max(0, min(100, int(data.get("maze_complexity", 100)))),
            "game_mode":       data.get("game_mode", "infinite"),
            "score_limit":     max(3, min(50, int(data.get("score_limit", 10)))),
        }

    room["started"] = True
    player_list = [
        {"id": p["id"], "name": p["name"], "slot": p["slot"]}
        for p in room["players"].values()
    ]
    settings = room.get("settings", {"maze_complexity":100,"game_mode":"infinite","score_limit":10})
    print(f"[START] room={rid} settings={settings} players={[p['name'] for p in player_list]}")
    socketio.emit("game_start", {
        "maze_seed": room["seed"],
        "players":   player_list,
        "settings":  settings
    }, to=rid)

@socketio.on("move")
def on_move(data):
    pid = request.sid; rid = data.get("room")
    if not rid or rid not in rooms: return
    room = rooms[rid]
    if pid not in room["players"]: return
    p = room["players"][pid]
    p["x"] = data.get("x", 0); p["y"] = data.get("y", 0)
    p["angle"] = data.get("angle", 0); p["alive"] = data.get("alive", True)
    broadcast(rid, "peer_move", {
        "id": pid, "x": p["x"], "y": p["y"],
        "angle": p["angle"], "alive": p["alive"]
    }, exclude=pid)

@socketio.on("bullet_spawn")
def on_bullet_spawn(data):
    pid = request.sid; rid = data.get("room")
    if not rid or rid not in rooms: return
    broadcast(rid, "bullet_spawn", data, exclude=pid)

@socketio.on("bullet_hit")
def on_bullet_hit(data):
    pid = request.sid; rid = data.get("room")
    if not rid or rid not in rooms: return
    room = rooms[rid]
    tid = data.get("targetId"); sid2 = data.get("shooterId")
    new_hp = data.get("hp", 100)

    if tid and tid in room["players"]:
        cur_hp = room["players"][tid]["hp"]
        # Dedup: chỉ xử lý nếu HP thực sự giảm
        if new_hp >= cur_hp and cur_hp > 0:
            return
        room["players"][tid]["hp"]    = new_hp
        room["players"][tid]["alive"] = not data.get("killed", False)

    # Dùng shooterScore từ client (client đã tính đúng)
    if data.get("killed") and sid2 and sid2 in room["players"]:
        new_score = data.get("shooterScore", room["players"][sid2].get("score", 0))
        room["players"][sid2]["score"] = new_score
        data["shooterScore"] = new_score  # đảm bảo relay đúng giá trị

    # Relay cho tất cả (trừ người gửi)
    for other in room["players"]:
        if other != pid:
            socketio.emit("bullet_hit", data, to=other)

@socketio.on("laser_fire")
def on_laser_fire(data):
    pid = request.sid; rid = data.get("room")
    if not rid or rid not in rooms: return
    room = rooms[rid]
    tid = data.get("targetId"); sid2 = data.get("shooterId")
    if tid and tid in room["players"]:
        room["players"][tid]["hp"] = 0; room["players"][tid]["alive"] = False
    if sid2 and sid2 in room["players"]:
        room["players"][sid2]["score"] = data.get("shooterScore", 0)
    broadcast(rid, "laser_fire", data, exclude=pid)

@socketio.on("gift_spawn")
def on_gift_spawn(data):
    pid = request.sid; rid = data.get("room")
    if not rid or rid not in rooms: return
    broadcast(rid, "gift_spawn", data, exclude=pid)

@socketio.on("gift_pickup")
def on_gift_pickup(data):
    pid = request.sid; rid = data.get("room")
    if not rid or rid not in rooms: return
    broadcast(rid, "gift_pickup", data, exclude=pid)

@socketio.on("notify_death")
def on_notify_death(data):
    pid = request.sid; rid = data.get("room")
    if not rid or rid not in rooms: return
    room = rooms[rid]
    target_id  = data.get("targetId")
    shooter_id = data.get("shooterId")
    if target_id and target_id in room["players"]:
        room["players"][target_id]["hp"]    = 0
        room["players"][target_id]["alive"] = False
    if shooter_id and shooter_id in room["players"]:
        room["players"][shooter_id]["score"] = room["players"][shooter_id].get("score", 0) + 1
    if target_id and target_id in room["players"]:
        socketio.emit("you_died", {"shooterId": shooter_id}, to=target_id)

@socketio.on("respawn")
def on_respawn(data):
    pid = request.sid; rid = data.get("room")
    if not rid or rid not in rooms: return
    room = rooms[rid]
    rpid = data.get("pid", pid)
    if rpid in room["players"]:
        p = room["players"][rpid]
        p["hp"] = 100; p["alive"] = True
        p["x"]  = data.get("x", p.get("x", 0))
        p["y"]  = data.get("y", p.get("y", 0))
    broadcast(rid, "peer_respawn", {
        "pid": rpid, "x": data.get("x", 0), "y": data.get("y", 0)
    }, exclude=pid)

@socketio.on("chat_msg")
def on_chat_msg(data):
    pid = request.sid; rid = data.get("room")
    if not rid or rid not in rooms: return
    if pid not in rooms[rid]["players"]: return
    text = str(data.get("text", ""))[:200].strip()
    if not text: return
    name = str(data.get("name", "?"))[:16]
    slot = int(data.get("slot", 0))
    broadcast(rid, "chat_msg", {"name": name, "text": text, "slot": slot}, exclude=pid)


@socketio.on("game_over")
def on_game_over(data):
    pid = request.sid; rid = data.get("room")
    if not rid or rid not in rooms: return
    room = rooms[rid]
    if room["host"] != pid: return  # chỉ host emit game_over
    rankings = data.get("rankings", [])
    broadcast(rid, "game_over", {"rankings": rankings}, exclude=pid)
    print(f"[GAME_OVER] room={rid}")

@socketio.on("rocket_fire")
def on_rocket_fire(data):
    pid = request.sid; rid = data.get("room")
    if not rid or rid not in rooms: return
    broadcast(rid, "rocket_fire", data, exclude=pid)

@socketio.on("rocket_pos")
def on_rocket_pos(data):
    pid = request.sid; rid = data.get("room")
    if not rid or rid not in rooms: return
    broadcast(rid, "rocket_pos", data, exclude=pid)

@socketio.on("rocket_done")
def on_rocket_done(data):
    pid = request.sid; rid = data.get("room")
    if not rid or rid not in rooms: return
    broadcast(rid, "rocket_done", data, exclude=pid)


@socketio.on("disconnect")
def on_disconnect(*args):
    pid = request.sid
    print(f"[DISCONNECT] {pid[:8]}")
    for rid, room in list(rooms.items()):
        if pid in room["players"]:
            pname = room["players"][pid]["name"]
            print(f"[LEAVE] {pname} left {rid}")
            del room["players"][pid]
            socketio.emit("peer_left", {"id": pid}, to=rid)
            if not room["players"]:
                del rooms[rid]; print(f"[DEL] room {rid} deleted")
            break

if __name__ == "__main__":
    print("=" * 50)
    print("Tank Maze — http://0.0.0.0:5000")
    print("=" * 50)
    socketio.run(app, host="0.0.0.0", port=5000, debug=False, allow_unsafe_werkzeug=True)