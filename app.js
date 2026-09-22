const socket = io();

let selectedMode = "video";
let currentMode = "video";

let localStream = null;
let peerConnection = null;
let currentRoom = null;
let connected = false;
let isSearching = false;

const modeNames = {
    video: "Video Chat",
    voice: "Voice Chat",
    text: "Text Chat"
};

const $ = (id) => document.getElementById(id);

const modeButtons = document.querySelectorAll(".mode-card");

modeButtons.forEach((button) => {
    button.addEventListener("click", () => {
        modeButtons.forEach((item) => item.classList.remove("active"));

        button.classList.add("active");
        selectedMode = button.dataset.mode;

        $("selectedMode").textContent = modeNames[selectedMode];
    });
});

$("findButton").addEventListener("click", () => {
    startChat(selectedMode);
});

$("closeChat").addEventListener("click", () => {
    leaveChat(true);
});

$("cancelSearch").addEventListener("click", () => {
    leaveChat(true);
});

$("nextButton").addEventListener("click", () => {
    nextStranger();
});

$("endButton").addEventListener("click", () => {
    leaveChat(true);
});

$("muteButton").addEventListener("click", () => {
    if (!localStream) return;

    const audioTrack = localStream.getAudioTracks()[0];

    if (!audioTrack) return;

    audioTrack.enabled = !audioTrack.enabled;

    $("muteButton").textContent = audioTrack.enabled ? "🎙️" : "🔇";
});

$("cameraButton").addEventListener("click", () => {
    if (!localStream) return;

    const videoTrack = localStream.getVideoTracks()[0];

    if (!videoTrack) return;

    videoTrack.enabled = !videoTrack.enabled;

    $("cameraButton").textContent = videoTrack.enabled ? "📹" : "🚫";
});

$("messageForm").addEventListener("submit", (event) => {
    event.preventDefault();

    const input = $("messageInput");
    const message = input.value.trim();

    if (!message || !connected || !currentRoom) return;

    addMessage(message, true);

    socket.emit("chat-message", {
        room: currentRoom,
        message
    });

    input.value = "";
    input.focus();
});

async function startChat(mode) {
    currentMode = mode;
    isSearching = true;
    connected = false;

    $("chatScreen").classList.remove("hidden");
    $("chatMode").textContent = modeNames[mode];
    $("chatStatus").textContent = "Finding a stranger...";

    $("waitingBox").classList.remove("hidden");
    $("videoArea").classList.add("hidden");
    $("voiceArea").classList.add("hidden");
    $("textArea").classList.add("hidden");
    $("controls").classList.add("hidden");

    $("waitingText").textContent = "Waiting for someone to join...";

    clearMessages();

    await stopLocalStream();
    closePeerConnection();

    if (mode !== "text") {
        try {
            localStream = await navigator.mediaDevices.getUserMedia({
                video: mode === "video",
                audio: true
            });

            $("localVideo").srcObject = localStream;
        } catch (error) {
            console.error(error);

            $("waitingText").textContent =
                "Camera/microphone permission is required for this chat.";

            return;
        }
    }

    socket.emit("find-stranger", { mode });
}

function showConnectedScreen() {
    isSearching = false;
    connected = true;

    $("waitingBox").classList.add("hidden");
    $("controls").classList.remove("hidden");

    if (currentMode === "video") {
        $("videoArea").classList.remove("hidden");
        $("remotePlaceholder").classList.remove("hidden");
    }

    if (currentMode === "voice") {
        $("voiceArea").classList.remove("hidden");
    }

    if (currentMode === "text") {
        $("textArea").classList.remove("hidden");
        $("messageInput").focus();
    }

    $("chatStatus").textContent = "Connected";
}

async function createPeerConnection(isCaller) {
    closePeerConnection();

    peerConnection = new RTCPeerConnection({
        iceServers: [
            {
                urls: "stun:stun.l.google.com:19302"
            },
            {
                urls: "stun:stun1.l.google.com:19302"
            }
        ]
    });

    if (localStream) {
        localStream.getTracks().forEach((track) => {
            peerConnection.addTrack(track, localStream);
        });
    }

    peerConnection.ontrack = (event) => {
        const stream = event.streams[0];

        if (currentMode === "video") {
            $("remoteVideo").srcObject = stream;
            $("remotePlaceholder").classList.add("hidden");
        } else if (currentMode === "voice") {
            $("remoteAudio").srcObject = stream;
        }
    };

    peerConnection.onicecandidate = (event) => {
        if (!event.candidate || !currentRoom) return;

        socket.emit("signal", {
            room: currentRoom,
            data: {
                candidate: event.candidate
            }
        });
    };

    peerConnection.onconnectionstatechange = () => {
        if (!peerConnection) return;

        if (
            peerConnection.connectionState === "failed" ||
            peerConnection.connectionState === "disconnected"
        ) {
            $("chatStatus").textContent = "Connection interrupted";
        }
    };

    if (isCaller) {
        const offer = await peerConnection.createOffer();

        await peerConnection.setLocalDescription(offer);

        socket.emit("signal", {
            room: currentRoom,
            data: {
                description: peerConnection.localDescription
            }
        });
    }
}

socket.on("waiting", () => {
    $("chatStatus").textContent = "Finding a stranger...";
    $("waitingText").textContent = "Waiting for someone to join...";
});

socket.on("matched", async ({ room, initiator }) => {
    currentRoom = room;

    showConnectedScreen();

    if (currentMode === "text") {
        addSystemMessage("You are connected. Say hello 👋");
        return;
    }

    await createPeerConnection(initiator);
});

socket.on("signal", async (data) => {
    try {
        if (!peerConnection) {
            await createPeerConnection(false);
        }

        if (data.description) {
            await peerConnection.setRemoteDescription(
                new RTCSessionDescription(data.description)
            );

            if (data.description.type === "offer") {
                const answer = await peerConnection.createAnswer();

                await peerConnection.setLocalDescription(answer);

                socket.emit("signal", {
                    room: currentRoom,
                    data: {
                        description: peerConnection.localDescription
                    }
                });
            }
        }

        if (data.candidate) {
            await peerConnection.addIceCandidate(
                new RTCIceCandidate(data.candidate)
            );
        }
    } catch (error) {
        console.error("WebRTC error:", error);
    }
});

socket.on("chat-message", (message) => {
    addMessage(message, false);
});

socket.on("stranger-left", () => {
    connected = false;
    isSearching = false;

    closePeerConnection();
    stopLocalStream();

    $("chatStatus").textContent = "Stranger left";
    $("waitingBox").classList.remove("hidden");
    $("videoArea").classList.add("hidden");
    $("voiceArea").classList.add("hidden");
    $("textArea").classList.add("hidden");
    $("controls").classList.remove("hidden");
    $("waitingText").textContent = "Your stranger left the chat.";

    addSystemMessage("Stranger left. Click Next Stranger to continue.");
});

async function nextStranger() {
    if (isSearching) return;

    socket.emit("leave-room");

    connected = false;
    currentRoom = null;

    closePeerConnection();
    await stopLocalStream();

    startChat(currentMode);
}

function leaveChat(goHome) {
    socket.emit("leave-room");

    connected = false;
    isSearching = false;
    currentRoom = null;

    closePeerConnection();
    stopLocalStream();

    $("chatScreen").classList.add("hidden");

    if (goHome) {
        $("chatStatus").textContent = "Finding a stranger...";
    }
}

function closePeerConnection() {
    if (!peerConnection) return;

    peerConnection.ontrack = null;
    peerConnection.onicecandidate = null;
    peerConnection.close();
    peerConnection = null;
}

async function stopLocalStream() {
    if (!localStream) return;

    localStream.getTracks().forEach((track) => track.stop());

    localStream = null;

    $("localVideo").srcObject = null;
    $("remoteVideo").srcObject = null;
    $("remoteAudio").srcObject = null;
}

function clearMessages() {
    $("messages").innerHTML = "";
}

function addSystemMessage(text) {
    const message = document.createElement("div");
    message.className = "system-message";
    message.textContent = text;

    $("messages").appendChild(message);
    $("messages").scrollTop = $("messages").scrollHeight;
}

function addMessage(text, mine) {
    const message = document.createElement("div");

    message.className = mine ? "bubble mine" : "bubble";
    message.textContent = text;

    $("messages").appendChild(message);
    $("messages").scrollTop = $("messages").scrollHeight;
}
