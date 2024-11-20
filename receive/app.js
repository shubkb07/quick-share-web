// receive/app.js

class P2PFileReceiver {
    constructor() {
        // Initialize properties
        this.peerConnection = null;
        this.dataChannel = null;
        this.receivedSize = 0;
        this.fileInfo = null;
        this.fileChunks = [];
        this.transferComplete = false;
        this.stoppedBySelf = false;
        this.initializeElements();
        this.initializeEventListeners();
        this.checkForCodeInURL();
        this.applyTheme();
    }

    // Initialize DOM elements
    initializeElements() {
        this.codeInputArea = document.getElementById('codeInputArea');
        this.connectionCodeInput = document.getElementById('connectionCode');
        this.connectBtn = document.getElementById('connectBtn');
        this.fileInfoDiv = document.getElementById('fileInfo');
        this.fileNameSpan = document.getElementById('fileName');
        this.fileSizeSpan = document.getElementById('fileSize');
        this.progressBar = document.getElementById('progressBar');
        this.progressBarFill = document.getElementById('progressBarFill');
        this.connectionStatus = document.getElementById('connectionStatus');
        this.transferStatus = document.getElementById('transferStatus');
        this.errorMessage = document.getElementById('errorMessage');
        this.notificationMessage = document.getElementById('notificationMessage');
        this.downloadBtn = document.getElementById('downloadBtn');
        this.stopBtn = document.getElementById('stopBtn');
        this.themeSelect = document.getElementById('themeSelect');

        // Hide elements initially
        this.fileInfoDiv.style.display = 'none';
        this.progressBar.style.display = 'none';
        this.stopBtn.style.display = 'none';
        this.downloadBtn.style.display = 'none';
    }

    // Initialize event listeners
    initializeEventListeners() {
        this.connectBtn.addEventListener('click', () => this.connect());
        this.downloadBtn.addEventListener('click', () => this.downloadFile());
        this.stopBtn.addEventListener('click', () => this.stopTransfer());
        this.connectionCodeInput.addEventListener('input', (e) => {
            e.target.value = e.target.value.toUpperCase();
        });

        // Theme switcher event
        this.themeSelect.addEventListener('change', () => this.changeTheme());
    }

    // Apply saved theme or default to system preference
    applyTheme() {
        const theme = localStorage.getItem('theme') || 'system';
        this.setTheme(theme);
        this.themeSelect.value = theme;
    }

    // Set theme
    setTheme(theme) {
        if (theme === 'system') {
            const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
            document.documentElement.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
        } else {
            document.documentElement.setAttribute('data-theme', theme);
        }
        localStorage.setItem('theme', theme);
    }

    // Change theme based on selection
    changeTheme() {
        const selectedTheme = this.themeSelect.value;
        this.setTheme(selectedTheme);
    }

    // Connect to sender using code
    async connect() {
        const code = this.connectionCodeInput.value.trim();
        if (!code) {
            this.showError('Please enter a connection code.');
            return;
        }

        this.connectBtn.disabled = true;
        this.connectionStatus.textContent = 'Connecting...';

        try {
            // Get the connection offer
            const response = await fetch(`../connection/index.php?code=${code}`);
            const result = await response.json();

            if (!result.success) {
                throw new Error('Invalid or expired connection code.');
            }

            // Parse the connection data
            const connectionData = JSON.parse(result.data.connection_data);

            await this.initializePeerConnection(code, connectionData);
        } catch (error) {
            this.showError('Connection failed: ' + error.message);
            this.connectBtn.disabled = false;
        }
    }

    // Initialize RTCPeerConnection
    async initializePeerConnection(code, offerData) {
        this.peerConnection = new RTCPeerConnection({
            iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
        });

        // Set up DataChannel event handlers
        this.peerConnection.ondatachannel = (event) => {
            const dataChannel = event.channel;
            this.setupDataChannelHandlers(dataChannel);
        };

        // Collect ICE candidates
        this.iceCandidates = [];
        this.peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                this.iceCandidates.push(event.candidate);
            }
        };

        // Set the remote description (offer)
        await this.peerConnection.setRemoteDescription(new RTCSessionDescription({
            sdp: offerData.sdp,
            type: offerData.type
        }));

        // Add remote ICE candidates
        for (const candidate of offerData.iceCandidates) {
            await this.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
        }

        // Create and set local description (answer)
        const answer = await this.peerConnection.createAnswer();
        await this.peerConnection.setLocalDescription(answer);

        // Wait for ICE gathering to complete with timeout
        await new Promise((resolve) => {
            let timeout = setTimeout(() => {
                resolve();
            }, 3000); // 3 seconds timeout

            if (this.peerConnection.iceGatheringState === 'complete') {
                clearTimeout(timeout);
                resolve();
            } else {
                const checkState = () => {
                    if (this.peerConnection.iceGatheringState === 'complete') {
                        clearTimeout(timeout);
                        this.peerConnection.removeEventListener('icegatheringstatechange', checkState);
                        resolve();
                    }
                };
                this.peerConnection.addEventListener('icegatheringstatechange', checkState);
            }
        });

        // Send the answer and ICE candidates back to server
        const connectionData = {
            action: 'update_connection',
            code: code,
            connection_data: {
                sdp: this.peerConnection.localDescription.sdp,
                type: this.peerConnection.localDescription.type,
                iceCandidates: this.iceCandidates
            }
        };

        const response = await fetch('../connection/index.php', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(connectionData)
        });

        if (!response.ok) {
            throw new Error('Failed to send answer.');
        }

        this.connectionStatus.textContent = 'Connected to sender. Preparing to receive file...';

        // Hide connect button and show stop button
        this.connectBtn.style.display = 'none';
        this.stopBtn.style.display = 'block';
    }

    // Set up DataChannel event handlers
    setupDataChannelHandlers(dataChannel) {
        this.dataChannel = dataChannel;

        dataChannel.onmessage = (event) => {
            if (typeof event.data === 'string') {
                try {
                    const message = JSON.parse(event.data);
                    if (message.type === 'info') {
                        this.handleFileInfo(message.data);
                    } else if (message.type === 'complete') {
                        this.handleTransferComplete();
                    }
                } catch (e) {
                    console.error('Error parsing message:', e);
                }
            } else {
                this.handleFileChunk(event.data);
            }
        };

        dataChannel.onopen = () => {
            this.connectionStatus.textContent = 'File transfer started...';
            this.progressBar.style.display = 'block'; // Show progress bar
            this.transferStatus.style.display = 'block'; // Show transfer status
        };

        dataChannel.onclose = () => {
            if (!this.transferComplete && !this.stoppedBySelf) {
                this.showError('The sender has stopped the file transfer.');
            }
            this.stopBtn.style.display = 'none'; // Hide stop button
            this.cleanup();
        };

        dataChannel.onerror = (error) => {
            this.showError('An error occurred during file transfer.');
            this.cleanup();
        };
    }

    // Handle received file information
    handleFileInfo(info) {
        this.fileInfo = info;
        this.fileNameSpan.textContent = info.name;
        this.fileSizeSpan.textContent = this.formatFileSize(info.size);
        this.fileInfoDiv.style.display = 'block';
        this.fileChunks = [];
        this.receivedSize = 0;
    }

    // Handle received file chunk
    handleFileChunk(chunk) {
        this.fileChunks.push(chunk);
        this.receivedSize += chunk.byteLength;
        const progress = (this.receivedSize / this.fileInfo.size) * 100;
        this.progressBarFill.style.width = `${progress}%`;
        this.transferStatus.textContent = `Receiving: ${Math.round(progress)}%`;
    }

    // Handle transfer completion
    handleTransferComplete() {
        this.transferStatus.textContent = 'File transfer complete!';
        this.downloadBtn.style.display = 'block';
        this.downloadFile(); // Auto-download
        this.transferComplete = true;
        this.stopBtn.style.display = 'none'; // Hide stop button
        this.cleanup();
    }

    // Download the received file
    downloadFile() {
        const blob = new Blob(this.fileChunks, { type: this.fileInfo.type });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = this.fileInfo.name;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    // Format file size for display
    formatFileSize(bytes) {
        const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
        if (bytes === 0) return '0 Byte';
        const i = parseInt(Math.floor(Math.log(bytes) / Math.log(1024)));
        return Math.round(bytes / Math.pow(1024, i), 2) + ' ' + sizes[i];
    }

    // Display error message
    showError(message) {
        this.errorMessage.textContent = message;
        this.errorMessage.style.display = 'block';
    }

    // Display notification message
    showNotification(message) {
        this.notificationMessage.textContent = message;
        this.notificationMessage.style.display = 'block';
        setTimeout(() => {
            this.notificationMessage.style.display = 'none';
        }, 3000);
    }

    // Stop file transfer
    async stopTransfer() {
        this.stoppedBySelf = true;
        this.showError('You have stopped the file transfer.');
        await this.deleteConnection(this.connectionCodeInput.value.trim());
        this.stopBtn.style.display = 'none'; // Hide stop button
        if (this.dataChannel) {
            this.dataChannel.close();
        }
        this.cleanup();
    }

    // Delete connection from server
    async deleteConnection(code) {
        try {
            await fetch(`../connection/index.php?action=delete&code=${code}`, {
                method: 'GET'
            });
        } catch (error) {
            console.error('Error deleting connection:', error);
        }
    }

    // Cleanup resources
    cleanup() {
        if (this.peerConnection) {
            this.peerConnection.close();
            this.peerConnection = null;
        }
    }

    // Check for connection code in URL and auto-connect
    checkForCodeInURL() {
        const params = new URLSearchParams(window.location.search);
        const code = params.get('code');
        if (code) {
            this.connectionCodeInput.value = code.toUpperCase();
            this.connect();
        }
    }
}

// Initialize the receiver when the page loads
window.addEventListener('load', () => {
    new P2PFileReceiver();
});
