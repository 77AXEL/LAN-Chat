from datetime import datetime, timedelta
from flask import Flask, render_template, request, session, jsonify
from flask_socketio import SocketIO, emit
from flask_session import Session
import secrets
import os

app = Flask(__name__)

SECRET_KEY_FILE = 'secret_key.txt'
if os.path.exists(SECRET_KEY_FILE):
    with open(SECRET_KEY_FILE, 'r') as f:
        app.config['SECRET_KEY'] = f.read().strip()
else:
    secret_key = secrets.token_hex(32)
    with open(SECRET_KEY_FILE, 'w') as f:
        f.write(secret_key)
    app.config['SECRET_KEY'] = secret_key

app.config['SESSION_TYPE'] = 'filesystem'
app.config['SESSION_PERMANENT'] = True
app.config['SESSION_COOKIE_NAME'] = 'lan_chat_session'
app.config['SESSION_COOKIE_HTTPONLY'] = True
app.config['SESSION_COOKIE_SAMESITE'] = 'Lax'
app.config['PERMANENT_SESSION_LIFETIME'] = timedelta(days=30)
Session(app)

socketio = SocketIO(app, async_mode='threading', cors_allowed_origins="*")

sid_to_user = {}
user_to_sid = {}
username_to_session = {}

def user_list_payload():
    return {"users": sorted(list(user_to_sid.keys()))}

@app.route("/", methods=["GET"])
def index():
    return render_template("index.html")

@app.route("/api/login", methods=["POST"])
def login():
    data = request.json
    desired = data.get("username", "").strip()
    
    if not desired:
        return "", 400

    final = desired
    suffix = 1
    existing_lower = {u.lower() for u in user_to_sid.keys()}
    
    current_user = session.get('username')
    if current_user and current_user.lower() == desired.lower():
        final = current_user
    else:
        while final.lower() in existing_lower:
            suffix += 1
            final = f"{desired}({suffix})"

    if 'session_id' not in session:
        session['session_id'] = secrets.token_urlsafe(32)
    
    session['username'] = final
    session.permanent = True
    
    print(f"HTTP Login: {final} (session_id: {session['session_id'][:8]}...)")
    return jsonify({"username": final})

@app.route("/api/logout", methods=["POST"])
def logout():
    username = session.get('username')
    print(f"HTTP Logout request from: {username}")
    
    if username:
        session.pop('username', None)
        session.pop('session_id', None)
        session.clear()
        
    return jsonify({"status": "logged_out"})

@socketio.on("connect")
def on_connect():    
    stored_username = session.get('username')
    session_id = session.get('session_id')
    
    if stored_username and session_id:
        
        current_owner_sid = user_to_sid.get(stored_username)
        
        if current_owner_sid and current_owner_sid != request.sid:
            if username_to_session.get(stored_username) == session_id:
                sid_to_user.pop(current_owner_sid, None)
            else:
                emit("user_list", user_list_payload())
                return
        
        sid_to_user[request.sid] = stored_username
        user_to_sid[stored_username] = request.sid
        username_to_session[stored_username] = session_id
        
        print(f"Auto-login successful: {stored_username} (sid: {request.sid})")
        emit("auto_login", {"username": stored_username})
        emit("user_joined", {"username": stored_username}, broadcast=True, include_self=False)
        emit("user_list", user_list_payload(), broadcast=True)
    else:
        emit("request_login")
        emit("user_list", user_list_payload())

@socketio.on("join")
def on_join():
    stored_username = session.get('username')
    session_id = session.get('session_id')
    
    if not stored_username:
        emit("request_login")
        return

    sid_to_user[request.sid] = stored_username
    user_to_sid[stored_username] = request.sid
    username_to_session[stored_username] = session_id
        
    emit("auto_login", {"username": stored_username})
    emit("user_joined", {"username": stored_username}, broadcast=True, include_self=False)
    emit("user_list", user_list_payload(), broadcast=True)

@socketio.on("logout")
def on_logout():
    username = sid_to_user.get(request.sid)
    session_id = session.get('session_id')
        
    if username:
        sid_to_user.pop(request.sid, None)
        user_to_sid.pop(username, None)
        username_to_session.pop(username, None)
        
        session.clear()
        
        print(f"User logged out: {username}")
        emit("user_left", {"username": username}, broadcast=True)
        emit("user_list", user_list_payload(), broadcast=True)
        emit("logout_ok")

@socketio.on("disconnect")
def on_disconnect(*args):
    username = sid_to_user.pop(request.sid, None)
    if username:
        user_to_sid.pop(username, None)
        emit("user_left", {"username": username}, broadcast=True)
        emit("user_list", user_list_payload(), broadcast=True)

@socketio.on("private_message")
def on_private_message(data):
    if not data:
        emit("system", {"text": "Invalid message data"})
        return
        
    sender = sid_to_user.get(request.sid)
    to_user = data.get("to")
    text = (data.get("text") or "").strip()

    if not sender:
        emit("system", {"text": "Set a username first."})
        return
    if not to_user:
        emit("system", {"text": "Please select a recipient."})
        return
    if not text:
        emit("system", {"text": "Message cannot be empty."})
        return

    ts = datetime.now().strftime("%H:%M")
    target_sid = user_to_sid.get(to_user)

    if not target_sid:
        emit("system", {"text": f"User '{to_user}' is offline or not found."})
        return

    message_payload = {
        "from": sender, 
        "to": to_user, 
        "text": text, 
        "time": ts
    }
    
    emit("receive_message", message_payload, room=target_sid)
    emit("receive_message", message_payload, room=request.sid)
    

@socketio.on("typing")
def on_typing(data):
    if not data:
        return
        
    sender = sid_to_user.get(request.sid)
    to_user = data.get("to")
    is_typing = bool(data.get("is_typing"))

    target_sid = user_to_sid.get(to_user)
    if sender and target_sid:
        emit("typing", {"from": sender, "is_typing": is_typing}, room=target_sid)

@socketio.on("get_user_list")
def on_get_user_list():
    emit("user_list", user_list_payload())

@socketio.on_error_default
def default_error_handler(e):
    emit("system", {"text": "An error occurred. Please try again."})

if __name__ == "__main__":
    socketio.run(app, host="0.0.0.0", port=5000, debug=True, allow_unsafe_werkzeug=True)