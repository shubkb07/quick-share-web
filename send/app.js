// send/app.js

class P2PFileSender {
    constructor() {
        this.peerConnection = null;
        this.dataChannel = null;
        this.file = null;
        this.chunkSize = 16384; // 16KB chunks
        this.currentChunk = 0;
        this.fileReader = new FileReader();
        this.pollInterval = null;
        this.pollCount = 0;
        this.maxPolls = 60; // 5 minutes at 5-second intervals
        this.transferComplete = false;
        this.stoppedBySelf = false;
        this.isTransferring = false;
        this.canCopyCode = true;
        this.initializeElements();
        this.initializeEventListeners();
        this.applyTheme();
    }

    initializeElements() {
        this.dropArea = document.getElementById('dropArea');
        this.fileInput = document.getElementById('fileInput');
        this.fileInfo = document.getElementById('fileInfo');
        this.fileName = document.getElementById('fileName');
        this.fileSize = document.getElementById('fileSize');
        this.connectionInfo = document.getElementById('connectionInfo');
        this.connectionCode = document.getElementById('connectionCode');
        this.connectionURL = document.getElementById('connectionURL');
        this.copyCodeBtn = document.getElementById('copyCodeBtn');
        this.shareCodeBtn = document.getElementById('shareCodeBtn');
        this.copyLinkBtn = document.getElementById('copyLinkBtn');
        this.shareLinkBtn = document.getElementById('shareLinkBtn');
        this.connectionStatus = document.getElementById('connectionStatus');
        this.progressBar = document.getElementById('progressBar');
        this.progressBarFill = document.getElementById('progressBarFill');
        this.transferStatus = document.getElementById('transferStatus');
        this.errorMessage = document.getElementById('errorMessage');
        this.notificationMessage = document.getElementById('notificationMessage');
        this.stopBtn = document.getElementById('stopBtn');
        this.themeSelect = document.getElementById('themeSelect');

        // Hide elements initially
        this.fileInfo.style.display = 'none';
        this.connectionInfo.style.display = 'none';
        this.progressBar.style.display = 'none';
        this.transferStatus.style.display = 'none';
        this.stopBtn.style.display = 'none';
    }

    initializeEventListeners() {
        // File selection events
        this.dropArea.addEventListener('click', () => this.fileInput.click());
        this.fileInput.addEventListener('change', (e) => this.handleFileSelect(e));
        this.dropArea.addEventListener('dragover', (e) => {
            e.preventDefault();
            this.dropArea.classList.add('dragover');
        });
        this.dropArea.addEventListener('dragleave', () => {
            this.dropArea.classList.remove('dragover');
        });
        this.dropArea.addEventListener('drop', (e) => {
            e.preventDefault();
            this.dropArea.classList.remove('dragover');
            this.handleFileDrop(e);
        });

        // File reader events
        this.fileReader.addEventListener('load', (e) => this.handleChunkRead(e));

        // Stop button event
        this.stopBtn.addEventListener('click', () => this.stopTransfer());

        // Copy and Share button events
        this.copyCodeBtn.addEventListener('click', () => this.copyCode());
        this.shareCodeBtn.addEventListener('click', () => this.shareCode());
        this.copyLinkBtn.addEventListener('click', () => this.copyLink());
        this.shareLinkBtn.addEventListener('click', () => this.shareLink());

        // Click events to copy code and URL (copy as is)
        this.canCopyCode = true;
        this.copyCodeHandler = () => {
            if (this.canCopyCode) {
                this.copyToClipboard(this.connectionCode.textContent);
            }
        };
        this.connectionCode.addEventListener('click', this.copyCodeHandler);
        this.connectionURL.addEventListener('click', () => this.copyToClipboard(this.connectionURL.textContent));

        // Theme switcher event
        this.themeSelect.addEventListener('change', () => this.changeTheme());
    }

    applyTheme() {
        const theme = localStorage.getItem('theme') || 'system';
        this.setTheme(theme);
        this.themeSelect.value = theme;
    }

    setTheme(theme) {
        if (theme === 'system') {
            const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
            document.documentElement.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
        } else {
            document.documentElement.setAttribute('data-theme', theme);
        }
        localStorage.setItem('theme', theme);
    }

    changeTheme() {
        const selectedTheme = this.themeSelect.value;
        this.setTheme(selectedTheme);
    }

    async initializePeerConnection() {
        this.peerConnection = new RTCPeerConnection({
            iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
        });

        this.dataChannel = this.peerConnection.createDataChannel('fileTransfer', {
            ordered: true
        });

        this.setupDataChannelHandlers();

        // Collect ICE candidates
        this.iceCandidates = [];
        this.peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                this.iceCandidates.push(event.candidate);
            }
        };

        // Create offer
        const offer = await this.peerConnection.createOffer();
        await this.peerConnection.setLocalDescription(offer);

        // Wait for ICE gathering to complete with a timeout
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

        // Send offer and ICE candidates to server
        const connectionData = {
            action: 'create_connection',
            sender_id: Date.now().toString(),
            connection_data: {
                sdp: this.peerConnection.localDescription.sdp,
                type: this.peerConnection.localDescription.type,
                iceCandidates: this.iceCandidates
            }
        };

        try {
            const response = await fetch('../connection/index.php', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(connectionData)
            });

            const result = await response.json();
            if (result.success) {
                this.connectionCode.textContent = result.code;
                const url = new URL(window.location.href);
                url.pathname = url.pathname.replace('send', 'receive');
                url.searchParams.set('code', result.code);
                this.connectionURL.textContent = url.toString();
                this.connectionInfo.style.display = 'block';
                this.dropArea.style.display = 'none'; // Hide drop area

                // Enable copy functionality
                this.canCopyCode = true;

                this.startPollingForAnswer(result.code);
            } else {
                throw new Error('Failed to create connection');
            }
        } catch (error) {
            this.showError('Connection setup failed: ' + error.message);
        }
    }

    setupDataChannelHandlers() {
        this.dataChannel.onopen = () => {
            this.connectionStatus.textContent = 'Receiver connected! Starting file transfer...';
            this.sendFileInfo();
            // Hide copy and share buttons once connected
            this.copyCodeBtn.style.display = 'none';
            this.shareCodeBtn.style.display = 'none';
            this.copyLinkBtn.style.display = 'none';
            this.shareLinkBtn.style.display = 'none';
            this.stopBtn.style.display = 'block'; // Show stop button
            this.progressBar.style.display = 'block'; // Show progress bar
            this.transferStatus.style.display = 'block'; // Show transfer status

            // Hide link and disable copy functionality for code text
            this.connectionURL.style.display = 'none';
            this.canCopyCode = false;
            this.connectionCode.removeEventListener('click', this.copyCodeHandler);

            this.isTransferring = true;
        };

        this.dataChannel.onclose = () => {
            if (!this.transferComplete && !this.stoppedBySelf) {
                this.showError('The receiver has stopped the file transfer.');
            }
            this.stopBtn.style.display = 'none'; // Hide stop button
            this.cleanup();
        };

        this.dataChannel.onerror = (error) => {
            this.showError('An error occurred during file transfer.');
            this.cleanup();
        };
    }

    startPollingForAnswer(code) {
        this.pollInterval = setInterval(async () => {
            this.pollCount++;
            if (this.pollCount > this.maxPolls) {
                clearInterval(this.pollInterval);
                this.showError('Receiver did not connect in time.');
                await this.deleteConnection(code);
                return;
            }

            const answerReceived = await this.checkForAnswer(code);
            if (answerReceived) {
                clearInterval(this.pollInterval);
            }
        }, 5000); // Every 5 seconds
    }

    async checkForAnswer(code) {
        try {
            const response = await fetch(`../connection/index.php?code=${code}`);
            const result = await response.json();

            if (result.success && result.data.is_connected) {
                if (this.isTransferring) {
                    this.showError('Another receiver is trying to connect. Transfer is already in progress.');
                    await this.deleteConnection(code);
                    this.cleanup();
                    return false;
                }

                const answerData = JSON.parse(result.data.connection_data);
                await this.peerConnection.setRemoteDescription(new RTCSessionDescription(answerData));

                // Add remote ICE candidates
                for (const candidate of answerData.iceCandidates) {
                    await this.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
                }

                return true;
            } else if (!result.success) {
                this.showError('Invalid or expired code.');
                return false;
            }
        } catch (error) {
            this.showError('An error occurred while checking for receiver.');
            console.error('Error polling for answer:', error);
        }
        return false;
    }

    handleFileSelect(event) {
        const file = event.target.files[0];
        if (file) {
            this.processFile(file);
        }
    }

    handleFileDrop(event) {
        const file = event.dataTransfer.files[0];
        if (file) {
            this.processFile(file);
        }
    }

    processFile(file) {
        this.file = file;
        this.fileName.textContent = file.name;
        this.fileSize.textContent = this.formatFileSize(file.size);
        this.fileInfo.style.display = 'block';
        this.initializePeerConnection();
    }

    sendFileInfo() {
        try {
            const fileInfo = {
                name: this.file.name,
                size: this.file.size,
                type: this.file.type
            };
            this.dataChannel.send(JSON.stringify({
                type: 'info',
                data: fileInfo
            }));
            this.sendFileData();
        } catch (error) {
            this.showError('Failed to send file information.');
        }
    }

    sendFileData() {
        if (this.currentChunk >= this.file.size) {
            // File transfer complete
            this.transferStatus.textContent = 'File transfer complete!';
            this.dataChannel.send(JSON.stringify({ type: 'complete' }));
            this.transferComplete = true;
            this.stopBtn.style.display = 'none'; // Hide stop button
            this.cleanup();
            return;
        }

        const chunk = this.file.slice(this.currentChunk, this.currentChunk + this.chunkSize);
        this.fileReader.readAsArrayBuffer(chunk);
    }

    handleChunkRead(event) {
        if (this.dataChannel.readyState === 'open') {
            this.dataChannel.send(event.target.result);
            this.currentChunk += event.target.result.byteLength;
            const progress = (this.currentChunk / this.file.size) * 100;
            this.progressBarFill.style.width = `${progress}%`;
            this.transferStatus.textContent = `Sending: ${Math.round(progress)}%`;

            // Continue sending data
            this.sendFileData();
        } else {
            this.showError('Connection was lost during file transfer.');
            this.cleanup();
        }
    }

    formatFileSize(bytes) {
        const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
        if (bytes === 0) return '0 Byte';
        const i = parseInt(Math.floor(Math.log(bytes) / Math.log(1024)));
        return Math.round(bytes / Math.pow(1024, i), 2) + ' ' + sizes[i];
    }

    showError(message) {
        this.errorMessage.textContent = message;
        this.errorMessage.style.display = 'block';
    }

    showNotification(message) {
        this.notificationMessage.textContent = message;
        this.notificationMessage.style.display = 'block';
        setTimeout(() => {
            this.notificationMessage.style.display = 'none';
        }, 3000);
    }

    async stopTransfer() {
        this.stoppedBySelf = true;
        this.showError('You have stopped the file transfer.');
        await this.deleteConnection(this.connectionCode.textContent);
        this.stopBtn.style.display = 'none'; // Hide stop button
        if (this.dataChannel) {
            this.dataChannel.close();
        }
        this.cleanup();
    }

    async deleteConnection(code) {
        try {
            await fetch(`../connection/index.php?action=delete&code=${code}`, {
                method: 'GET'
            });
        } catch (error) {
            console.error('Error deleting connection:', error);
        }
    }

    cleanup() {
        if (this.peerConnection) {
            this.peerConnection.close();
            this.peerConnection = null;
        }
        if (this.dataChannel) {
            this.dataChannel.close();
            this.dataChannel = null;
        }
        if (this.pollInterval) {
            clearInterval(this.pollInterval);
        }
    }

    copyToClipboard(text) {
        navigator.clipboard.writeText(text).then(() => {
            this.showNotification('Copied to clipboard');
        }).catch(err => {
            console.error('Could not copy text: ', err);
            this.showError('Failed to copy to clipboard.');
        });
    }

    copyCode() {
        const codeMessage = `Here is the code to receive the file: ${this.connectionCode.textContent}`;
        this.copyToClipboard(codeMessage);
    }

    shareCode() {
        const codeMessage = `Here is the code to receive the file: ${this.connectionCode.textContent}`;
        if (navigator.share) {
            navigator.share({
                title: 'QuickShare',
                text: codeMessage
            }).then(() => {
                this.showNotification('Code shared successfully');
            }).catch((error) => {
                console.error('Error sharing:', error);
                this.copyToClipboard(codeMessage);
            });
        } else {
            this.copyToClipboard(codeMessage);
        }
    }

    copyLink() {
        const url = this.connectionURL.textContent;
        this.copyToClipboard(url);
    }

    shareLink() {
        const linkMessage = `Click the link to receive the file: ${this.connectionURL.textContent}`;
        if (navigator.share) {
            navigator.share({
                title: 'QuickShare',
                text: linkMessage,
                url: this.connectionURL.textContent
            }).then(() => {
                this.showNotification('Link shared successfully');
            }).catch((error) => {
                console.error('Error sharing:', error);
                this.copyToClipboard(this.connectionURL.textContent);
            });
        } else {
            this.copyToClipboard(this.connectionURL.textContent);
        }
    }
}

// Initialize the sender when the page loads
window.addEventListener('load', () => {
    new P2PFileSender();
});
