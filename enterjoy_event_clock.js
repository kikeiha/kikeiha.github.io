(function () {
    'use strict';

    const USE_24HCLOCK = false;
    const SHOW_BORDER = false;
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const clockDisplayId = 'tampermonkey-synced-clock';
    const channelName = 'synchronized-clock-channel';

    function applyClockStyles(element) {
        element.style.position = 'fixed';
        element.style.bottom = '10px';
        element.style.right = '10px';
        element.style.fontFamily = 'Arial, sans-serif';
        element.style.fontSize = '18px';
        element.style.color = '#FFFFFF';
        element.style.backgroundColor = 'rgba(0, 0, 0, 1)';
        if (SHOW_BORDER) {
            element.style.border = '1px solid rgba(255, 255, 255, 1)';
        }
        element.style.padding = '5px 8px';
        element.style.borderRadius = '5px';
        element.style.zIndex = '9999';
        element.style.width = '120px';
        element.style.height = '30px';
        element.style.boxSizing = 'border-box';
        element.style.display = 'flex';
        element.style.justifyContent = 'center';
        element.style.alignItems = 'center';
        element.style.textAlign = 'center';
    }

    function applyLinkWrapperStyles(element) {
        element.style.textDecoration = 'none';
        element.style.display = 'inline-block';
        element.style.position = 'fixed';
        element.style.bottom = '10px';
        element.style.right = '10px';
        element.style.zIndex = '9999';
    }

    let syncInterval;
    let clockDisplay;
    let broadcastChannel;
    let beepPreTriggered = false;
    let beepLowTriggered = false;
    let beepHighTriggered = false;

    if (window.self !== window.top) return;

    function createClockDisplay() {
        const linkWrapper = document.createElement('a');
        linkWrapper.href = 'https://enterjoy.day/bbs/board.php?bo_table=free';
        linkWrapper.target = '_blank';
        applyLinkWrapperStyles(linkWrapper);

        clockDisplay = document.createElement('div');
        clockDisplay.id = clockDisplayId;
        applyClockStyles(clockDisplay);

        linkWrapper.appendChild(clockDisplay);
        document.body.appendChild(linkWrapper);
    }

    function updateClock(timestamp) {
        if (!clockDisplay) {
            createClockDisplay();
        }
        const date = new Date(timestamp);
        let hours = date.getHours();
        const minutes = date.getMinutes().toString().padStart(2, '0');
        const seconds = date.getSeconds().toString().padStart(2, '0');

        if (USE_24HCLOCK) {
            const hours24 = hours.toString().padStart(2, '0');
            clockDisplay.textContent = `${hours24}:${minutes}:${seconds}`;
        } else {
            const meridiem = hours >= 12 ? 'PM' : 'AM';
            hours = hours % 12 || 12;
            clockDisplay.textContent = `${hours}:${minutes}:${seconds} ${meridiem}`;
        }
    }

    function playBeep(frequency, duration, volume = 0.5) {
        if (audioContext.state === 'suspended') {
            audioContext.resume();
        }

        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();

        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);

        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(frequency, audioContext.currentTime);

        gainNode.gain.setValueAtTime(volume, audioContext.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + duration / 1000);

        oscillator.start(audioContext.currentTime);
        oscillator.stop(audioContext.currentTime + duration / 1000);
    }

    function playBeepLow(frequency = 440, duration = 200) {
        playBeep(frequency, duration);
    }

    function playBeepHigh(frequency = 880, duration = 1500) {
        playBeep(frequency, duration);
    }

    function checkAndTriggerAlarms(timestamp) {
        const date = new Date(timestamp);
        const minutes = date.getMinutes();
        const seconds = date.getSeconds();

        const isBeepPreTime = minutes == 29 || minutes == 59;
        if (isBeepPreTime) {
            if (!beepPreTriggered) beepPreTriggered = true;
            clockDisplay.style.background = (seconds % 2 === 0) ? 'rgba(255, 0, 0, 1)' : 'rgba(0, 0, 0, 1)';
        } else {
            beepPreTriggered = false;
        }

        const isBeepLowTime = (seconds >= 30 && (minutes == 29 || minutes == 59));
        if (isBeepLowTime) {
            if (seconds % 2 === 0 && !beepLowTriggered) {
                playBeepLow();
                beepLowTriggered = true;
            } else {
                beepLowTriggered = false;
            }
            clockDisplay.style.background = (seconds % 2 === 0) ? 'rgba(255, 0, 0, 1)' : 'rgba(0, 0, 0, 1)';
        } else {
            beepLowTriggered = false;
        }

        const isBeepHighTime = (seconds == 0 && (minutes == 0 || minutes == 30));
        if (isBeepHighTime) {
            if (!beepHighTriggered) {
                beepHighTriggered = true;
                playBeepHigh();
            }
            clockDisplay.style.background = 'rgba(255, 0, 0, 1)';
            return;
        } else {
            beepHighTriggered = false;
        }

        if ((minutes !== 29 && minutes !== 59) || ((minutes === 0 || minutes === 30) && seconds !== 0)) {
            clockDisplay.style.background = 'rgba(0, 0, 0, 1)';
        }
    }

    function setupBroadcastChannel() {
        if (typeof BroadcastChannel === 'undefined') return;

        broadcastChannel = new BroadcastChannel(channelName);
        let isLeader = true;
        let lastTimestamp = Date.now();

        broadcastChannel.onmessage = (event) => {
            const data = event.data;
            if (data.type === 'SYNC_TIME') {
                if (isLeader && data.timestamp > lastTimestamp) {
                    isLeader = false;
                    clearInterval(syncInterval);
                }
                lastTimestamp = data.timestamp;
                updateClock(data.timestamp);
            }
        };

        syncInterval = setInterval(() => {
            if (isLeader) {
                const timestamp = Date.now();
                broadcastChannel.postMessage({ type: 'SYNC_TIME', timestamp });
                updateClock(timestamp);
                checkAndTriggerAlarms(timestamp);
            }
        }, 100);

        window.addEventListener('beforeunload', () => {
            if (isLeader) broadcastChannel.postMessage({ type: 'LEADER_CLOSED' });
            broadcastChannel.close();
        });

        broadcastChannel.onmessage = (event) => {
            const data = event.data;
            if (data.type === 'LEADER_CLOSED' && !isLeader) {
                isLeader = true;
                syncInterval = setInterval(() => {
                    if (isLeader) {
                        const timestamp = Date.now();
                        broadcastChannel.postMessage({ type: 'SYNC_TIME', timestamp });
                        updateClock(timestamp);
                        checkAndTriggerAlarms(timestamp);
                    }
                }, 100);
            } else if (data.type === 'SYNC_TIME') {
                lastTimestamp = data.timestamp;
                updateClock(data.timestamp);
            }
        };
    }

    createClockDisplay();
    setupBroadcastChannel();
})();