echo "Starting Lan-Chat..."
docker load -i lan-chat.tar
docker run -d --name lan-chat-app -p 5000:5000 lan-chat