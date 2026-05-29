class WebRTCManager {
    constructor() {
        this.socket = null;
        this.peerConnection = null;
        this.dataChannel = null;
        this.roomCode = null;
        this.isHost = false;

        // Callbacks
        this.onRoomCreated = null;
        this.onJoinSuccess = null;
        this.onJoinError = null;
        this.onPeerJoined = null;
        this.onPeerDisconnected = null;
        this.onDataReceived = null;
        this.onDataChannelOpen = null;

        // Turn Servers for WebRTC
        this.configuration = {
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' }
            ]
        };
    }

    connectToServer() {
        if (!this.socket) {
            // Assumes server runs on localhost:3000 during dev
            // Update to actual IP/domain for production
            this.socket = io('http://localhost:3000');
            this.setupSocketListeners();
        }
    }

    setupSocketListeners() {
        this.socket.on('room_created', (code) => {
            this.roomCode = code;
            this.isHost = true;
            if (this.onRoomCreated) this.onRoomCreated(code);
        });

        this.socket.on('join_success', (code) => {
            this.roomCode = code;
            this.isHost = false;
            if (this.onJoinSuccess) this.onJoinSuccess(code);
            // Joiner will now wait for offer from Host, or Joiner can create Offer.
            // Usually, Host creates the offer.
        });

        this.socket.on('join_error', (errorMsg) => {
            if (this.onJoinError) this.onJoinError(errorMsg);
        });

        this.socket.on('peer_joined', async (peerSocketId) => {
            if (this.onPeerJoined) this.onPeerJoined();
            
            // Host creates PeerConnection and Offer
            if (this.isHost) {
                this.createPeerConnection();
                // Host creates Data Channel
                this.dataChannel = this.peerConnection.createDataChannel('tictactoe_game');
                this.setupDataChannel();

                const offer = await this.peerConnection.createOffer();
                await this.peerConnection.setLocalDescription(offer);
                
                this.socket.emit('signal', {
                    roomCode: this.roomCode,
                    signalData: { type: 'offer', offer: offer }
                });
            }
        });

        this.socket.on('peer_disconnected', () => {
            if (this.onPeerDisconnected) this.onPeerDisconnected();
            this.reset();
        });

        this.socket.on('signal', async (data) => {
            if (!this.peerConnection) {
                this.createPeerConnection();
            }

            const signalData = data.signalData;

            if (signalData.type === 'offer') {
                // Joiner receives offer
                await this.peerConnection.setRemoteDescription(new RTCSessionDescription(signalData.offer));
                const answer = await this.peerConnection.createAnswer();
                await this.peerConnection.setLocalDescription(answer);
                
                this.socket.emit('signal', {
                    roomCode: this.roomCode,
                    signalData: { type: 'answer', answer: answer }
                });
            } else if (signalData.type === 'answer') {
                // Host receives answer
                await this.peerConnection.setRemoteDescription(new RTCSessionDescription(signalData.answer));
            } else if (signalData.type === 'ice_candidate') {
                try {
                    await this.peerConnection.addIceCandidate(new RTCIceCandidate(signalData.candidate));
                } catch (e) {
                    console.error('Error adding received ice candidate', e);
                }
            }
        });
    }

    createPeerConnection() {
        this.peerConnection = new RTCPeerConnection(this.configuration);

        this.peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                this.socket.emit('signal', {
                    roomCode: this.roomCode,
                    signalData: { type: 'ice_candidate', candidate: event.candidate }
                });
            }
        };

        // For Joiner to receive the Data Channel created by Host
        this.peerConnection.ondatachannel = (event) => {
            this.dataChannel = event.channel;
            this.setupDataChannel();
        };
    }

    setupDataChannel() {
        this.dataChannel.onopen = () => {
            console.log('Data channel open');
            if (this.onDataChannelOpen) this.onDataChannelOpen();
        };

        this.dataChannel.onmessage = (event) => {
            const data = JSON.parse(event.data);
            if (this.onDataReceived) this.onDataReceived(data);
        };

        this.dataChannel.onclose = () => {
            console.log('Data channel closed');
            if (this.onPeerDisconnected) this.onPeerDisconnected();
        };
    }

    hostMatch() {
        this.connectToServer();
        this.socket.emit('host_match');
    }

    joinMatch(code) {
        this.connectToServer();
        this.socket.emit('join_match', code);
    }

    quickJoin() {
        this.connectToServer();
        this.socket.emit('quick_join');
    }

    sendData(data) {
        if (this.dataChannel && this.dataChannel.readyState === 'open') {
            this.dataChannel.send(JSON.stringify(data));
        }
    }

    reset() {
        if (this.dataChannel) {
            this.dataChannel.close();
            this.dataChannel = null;
        }
        if (this.peerConnection) {
            this.peerConnection.close();
            this.peerConnection = null;
        }
        if (this.socket) {
            this.socket.disconnect();
            this.socket = null;
        }
        this.roomCode = null;
        this.isHost = false;
    }
}

// Global instance
window.webRTCManager = new WebRTCManager();
