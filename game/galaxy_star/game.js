    (function() {
      var canvas = document.getElementById('gameCanvas');
      if (!canvas) return;
      var ctx = canvas.getContext('2d');
      if (!ctx) return;

      var VIRTUAL_WIDTH = 720;
      var VIRTUAL_HEIGHT = 1030;

      canvas.width = VIRTUAL_WIDTH;
      canvas.height = VIRTUAL_HEIGHT;

      // Layout configuration
      var IMG_SIZE = 675;
      var IMG_X = 22.5;
      var IMG_Y = 102.5; // Shifted 20 points down from 82.5 (total 30 points from original)
      var scale = IMG_SIZE / 800; // 0.84375

      // Exact Center coordinates of the 8 planets (Shifted 20 points down to 440px)
      var CENTER_X = IMG_X + (400 * scale); // 360px
      var CENTER_Y = IMG_Y + (400 * scale); // 440px

      var PLANET_RADIUS = 58;
      var EQUAL_ORBIT_RADIUS = 268;

      // ======================================================================
      // 24/7 ZERO-TRUST WEBSOCKET & ATOMIC REDIS ENGINE CLIENT
      // ======================================================================
      var urlParams = new URLSearchParams(window.location.search);
      var currentUid = urlParams.get('uid') || '';
      var currentSessionToken = urlParams.get('token') || '';
      var gameWs = null;
      var serverRoundId = 0;
      var serverPhase = 'BETTING';
      var serverTimeLeft = 15;
      var serverPlanetPools = {};
      var isSyncedWithServer = false;

      function connectGameWebSocket() {
        var statusEl = document.getElementById('loadingStatusText');
        var overlayEl = document.getElementById('gameLoadingOverlay');

        var protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        var host = window.location.host;
        var wsUrl = protocol + '//' + host + '/ws/games/galaxy_star?uid=' + encodeURIComponent(currentUid) + '&token=' + encodeURIComponent(currentSessionToken);

        if (statusEl) statusEl.textContent = 'Verifying Authenticated Vault...';

        try {
          gameWs = new WebSocket(wsUrl);

          gameWs.onopen = function() {
            if (statusEl) statusEl.textContent = 'Synchronizing Live 24/7 Round...';
          };

          gameWs.onmessage = function(event) {
            try {
              var data = JSON.parse(event.data);

              if (data.event === 'INIT_SYNC') {
                isSyncedWithServer = true;
                serverRoundId = data.roundId;
                serverPhase = data.phase;
                serverTimeLeft = data.timeLeft;
                serverPlanetPools = data.planetPools || {};

                if (data.user && typeof data.user.coins === 'number') {
                  userCoins = data.user.coins;
                }

                if (statusEl) statusEl.textContent = 'Connected! Entering Galaxy...';
                setTimeout(function() {
                  if (overlayEl) overlayEl.classList.add('fade-out');
                }, 400);
              }

              if (data.event === 'TICK') {
                serverRoundId = data.roundId;
                serverPhase = data.phase;
                serverTimeLeft = data.timeLeft;
                serverPlanetPools = data.planetPools || {};
              }

              if (data.event === 'ROUND_LOCKED') {
                serverPhase = 'LOCKED';
                serverTimeLeft = data.timeLeft;
                serverPlanetPools = data.planetPools || {};
              }

              if (data.event === 'ROUND_RESULT') {
                serverPhase = 'RESULT';
              }

              if (data.event === 'BET_SUCCESS') {
                if (typeof data.remainingCoins === 'number') {
                  userCoins = data.remainingCoins;
                }
              }

              if (data.event === 'BET_FAILED') {
                alert('⚠️ Bet Failed: ' + (data.message || 'Error'));
              }
            } catch(e) {}
          };

          gameWs.onclose = function() {
            setTimeout(connectGameWebSocket, 2500);
          };
          gameWs.onerror = function() {
            setTimeout(function() {
              if (overlayEl) overlayEl.classList.add('fade-out');
            }, 2000);
          };
        } catch(err) {
          setTimeout(function() {
            if (overlayEl) overlayEl.classList.add('fade-out');
          }, 2000);
        }
      }

      connectGameWebSocket();

      // Generate Persistent Cosmic Stars for Galaxy Background
      var stars = [];
      for (var i = 0; i < 180; i++) {
        stars.push({
          x: Math.random() * VIRTUAL_WIDTH,
          y: Math.random() * VIRTUAL_HEIGHT,
          radius: Math.random() * 1.4 + 0.35,
          baseAlpha: Math.random() * 0.55 + 0.2,
          twinkleSpeed: Math.random() * 2.5 + 1.2,
          isBlue: Math.random() > 0.4
        });
      }

      // 8 Planets with exact 100% equal distances (268px), 45-degree equidistant angles, multipliers and HD textures
      var PLANET_CONFIGS = [
        {
          name: 'Mercury',
          multiplier: '5X',
          angleDeg: 270,
          radius: PLANET_RADIUS,
          baseColor: '#e2e8f0', rimColor: 'rgba(241, 245, 249, 0.95)',
          haloColor: 'rgba(203, 213, 225, 0.45)',
          haloStop: 'rgba(203, 213, 225, 0.22)',
          spinSpeed: 0.02,
          type: 'mercury'
        },
        {
          name: 'Venus',
          multiplier: '5X',
          angleDeg: 315,
          radius: PLANET_RADIUS,
          baseColor: '#eab308', rimColor: 'rgba(254, 240, 138, 0.9)',
          haloColor: 'rgba(234, 179, 8, 0.55)',
          haloStop: 'rgba(234, 179, 8, 0.22)',
          spinSpeed: 0.015,
          type: 'venus'
        },
        {
          name: 'Earth',
          multiplier: '3X',
          angleDeg: 0,
          radius: PLANET_RADIUS,
          baseColor: '#0284c7', rimColor: 'rgba(56, 189, 248, 0.9)',
          haloColor: 'rgba(14, 165, 233, 0.55)',
          haloStop: 'rgba(14, 165, 233, 0.22)',
          spinSpeed: 0.025,
          type: 'earth'
        },
        {
          name: 'Mars',
          multiplier: '5X',
          angleDeg: 45,
          radius: PLANET_RADIUS,
          baseColor: '#dc2626', rimColor: 'rgba(248, 113, 113, 0.9)',
          haloColor: 'rgba(239, 68, 68, 0.55)',
          haloStop: 'rgba(239, 68, 68, 0.22)',
          spinSpeed: 0.022,
          type: 'mars'
        },
        {
          name: 'Jupiter',
          multiplier: '10X',
          angleDeg: 90,
          radius: PLANET_RADIUS,
          baseColor: '#e879f9', rimColor: 'rgba(244, 114, 182, 0.95)',
          haloColor: 'rgba(236, 72, 153, 0.55)',
          haloStop: 'rgba(236, 72, 153, 0.22)',
          spinSpeed: 0.035,
          type: 'jupiter'
        },
        {
          name: 'Neptune',
          multiplier: '15X',
          angleDeg: 135,
          radius: PLANET_RADIUS,
          baseColor: '#1d4ed8', rimColor: 'rgba(96, 165, 250, 0.95)',
          haloColor: 'rgba(37, 99, 235, 0.7)',
          haloStop: 'rgba(37, 99, 235, 0.22)',
          spinSpeed: 0.02,
          type: 'neptune'
        },
        {
          name: 'Uranus',
          multiplier: '25X',
          angleDeg: 180,
          radius: PLANET_RADIUS,
          baseColor: '#38bdf8', rimColor: 'rgba(125, 211, 252, 0.95)',
          haloColor: 'rgba(56, 189, 248, 0.65)',
          haloStop: 'rgba(56, 189, 248, 0.22)',
          spinSpeed: 0.018,
          hasSubtleRing: true,
          type: 'uranus'
        },
        {
          name: 'Saturn',
          multiplier: '50X',
          angleDeg: 225,
          radius: PLANET_RADIUS,
          baseColor: '#f59e0b', rimColor: 'rgba(253, 230, 138, 0.95)',
          haloColor: 'rgba(245, 158, 11, 0.65)',
          haloStop: 'rgba(245, 158, 11, 0.22)',
          spinSpeed: 0.03,
          hasRing: true,
          type: 'saturn'
        }
      ];

      var PLANETS = PLANET_CONFIGS.map(function(cfg) {
        var radAng = (cfg.angleDeg * Math.PI) / 180;
        var exactX = CENTER_X + Math.cos(radAng) * EQUAL_ORBIT_RADIUS;
        var exactY = CENTER_Y + Math.sin(radAng) * EQUAL_ORBIT_RADIUS;
        return {
          name: cfg.name,
          multiplier: cfg.multiplier,
          angleDeg: cfg.angleDeg,
          radius: cfg.radius,
          baseColor: cfg.baseColor,
          rimColor: cfg.rimColor,
          haloColor: cfg.haloColor,
          haloStop: cfg.haloStop,
          spinSpeed: cfg.spinSpeed,
          type: cfg.type,
          hasRing: cfg.hasRing,
          hasSubtleRing: cfg.hasSubtleRing,
          exactX: exactX,
          exactY: exactY,
          radAng: radAng,
          dist: EQUAL_ORBIT_RADIUS
        };
      });

      // 100% DETERMINISTIC PSEUDO-RANDOM SEEDED WINNER ALGORITHM (GLOBAL SYNCHRONIZED ACROSS ALL USERS)
      function getSeededWinnerIndex(roundId) {
        var safeRound = Math.floor(Math.abs(roundId));
        var seed = (safeRound * 9301 + 49297) % 233280;
        seed = (seed * 9301 + 49297) % 233280;
        var roll = seed % 100; // 0 to 99

        if (roll < 40) return 2;      // Earth (3X): 40% (0 to 39)
        else if (roll < 50) return 0; // Mercury (5X): 10% (40 to 49)
        else if (roll < 60) return 1; // Venus (5X): 10% (50 to 59)
        else if (roll < 70) return 3; // Mars (5X): 10% (60 to 69)
        else if (roll < 82) return 4; // Jupiter (10X): 12% (70 to 81)
        else if (roll < 90) return 5; // Neptune (15X): 8% (82 to 89)
        else if (roll < 97) return 6; // Uranus (25X): 7% (90 to 96)
        else return 7;                // Saturn (50X): 3% (97 to 99)
      }

      // RARE MOON CRASH PROBABILITY TABLE (Total 100%):
      // 92% Black Hole (Earth 3X), 4% 5X Crash, 2% Jupiter 10X Crash, 1% Neptune 15X Crash, 1% Saturn 50X Jackpot!
      function getSeededMoonCrashBonus(roundId) {
        var safeRound = Math.floor(Math.abs(roundId));
        var seed = (safeRound * 1259 + 38711) % 10000;
        var roll = seed % 100; // 0 to 99

        if (roll < 92) {
          return { isTriggered: false, targetIdx: 2 };
        } else if (roll < 96) {
          var fiveXOptions = [0, 1, 3];
          var targetIdx = fiveXOptions[seed % fiveXOptions.length];
          return { isTriggered: true, targetIdx: targetIdx };
        } else if (roll < 98) {
          return { isTriggered: true, targetIdx: 4 };
        } else if (roll < 99) {
          return { isTriggered: true, targetIdx: 5 };
        } else {
          return { isTriggered: true, targetIdx: 7 };
        }
      }

      var planetBetsRef = { current: {} };
      var userCoins = 10000;
      if (window.AndroidGameBridge && typeof window.AndroidGameBridge.getUserCoins === 'function') {
        userCoins = window.AndroidGameBridge.getUserCoins();
      }
      window.updateExternalUserCoins = function(newCoins) {
        userCoins = newCoins;
      };
      var selectedChipIdx = 1;
      var selectedChip = 100;
      var lastClearedRound = -1;
      var lastPayoutRound = -1;
      var winnerHistory = [];
      var time = Date.now() / 1000;

      // Initialize winnerHistory with last 6 rounds using exact 42-second global cycle
      var initRound = Math.floor(time / 42);
      for (var h = 6; h >= 1; h--) {
        var hRound = Math.max(0, initRound - h);
        winnerHistory.push(getSeededWinnerIndex(hRound));
      }

      // DRAW ULTRA-DARK MIDNIGHT NAVY GALAXY BACKGROUND
      function drawGalaxyBackground(animTime) {
        var baseGrad = ctx.createLinearGradient(0, 0, 0, VIRTUAL_HEIGHT);
        baseGrad.addColorStop(0, '#01040a');
        baseGrad.addColorStop(0.3, '#020817');
        baseGrad.addColorStop(0.5, '#010612');
        baseGrad.addColorStop(0.7, '#020919');
        baseGrad.addColorStop(1, '#000206');
        ctx.fillStyle = baseGrad;
        ctx.fillRect(0, 0, VIRTUAL_WIDTH, VIRTUAL_HEIGHT);

        var neb1 = ctx.createRadialGradient(220, 280, 40, 220, 280, 280);
        neb1.addColorStop(0, 'rgba(8, 47, 73, 0.16)');
        neb1.addColorStop(0.5, 'rgba(15, 23, 42, 0.12)');
        neb1.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = neb1;
        ctx.fillRect(0, 0, VIRTUAL_WIDTH, VIRTUAL_HEIGHT);

        var neb2 = ctx.createRadialGradient(480, 560, 50, 480, 560, 320);
        neb2.addColorStop(0, 'rgba(12, 35, 90, 0.15)');
        neb2.addColorStop(0.5, 'rgba(10, 15, 30, 0.10)');
        neb2.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = neb2;
        ctx.fillRect(0, 0, VIRTUAL_WIDTH, VIRTUAL_HEIGHT);

        stars.forEach(function(s) {
          var twinkle = Math.sin(animTime * s.twinkleSpeed + s.x) * 0.35;
          var currentAlpha = Math.max(0.08, Math.min(1, s.baseAlpha + twinkle));

          ctx.fillStyle = s.isBlue
            ? 'rgba(186, 230, 253, ' + (currentAlpha * 0.85) + ')'
            : 'rgba(255, 255, 255, ' + currentAlpha + ')';

          ctx.beginPath();
          ctx.arc(s.x, s.y, s.radius, 0, Math.PI * 2);
          ctx.fill();
        });
      }

      // TRANSLUCENT GRAVITATIONAL BLACK HOLE (BLENDED WITH GALAXY BACKGROUND)
      function drawBlackHole(cx, cy, animTime, activeWinnerIndex) {
        ctx.save();
        var bhRadius = 74;

        var voidGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, bhRadius * 1.55);
        voidGrad.addColorStop(0, 'rgba(1, 4, 12, 0.78)');
        voidGrad.addColorStop(0.5, 'rgba(2, 8, 22, 0.50)');
        voidGrad.addColorStop(0.8, 'rgba(3, 12, 30, 0.22)');
        voidGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = voidGrad;
        ctx.beginPath();
        ctx.arc(cx, cy, bhRadius * 1.55, 0, Math.PI * 2);
        ctx.fill();

        for (var s = 0; s < 6; s++) {
          var baseAngle = animTime * 1.2 + (s * (Math.PI * 2 / 6));
          ctx.save();
          ctx.beginPath();
          for (var t = 0; t <= 1; t += 0.05) {
            var r = (bhRadius * 1.38) - (t * (bhRadius * 0.78));
            var angle = baseAngle + (t * 1.6);
            var px = cx + Math.cos(angle) * r;
            var py = cy + Math.sin(angle) * r;
            if (t === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          }
          ctx.strokeStyle = 'rgba(56, 189, 248, 0.10)';
          ctx.lineWidth = 2.4;
          ctx.stroke();
          ctx.restore();
        }

        var coreGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, bhRadius * 0.85);
        coreGrad.addColorStop(0, 'rgba(0, 2, 8, 0.80)');
        coreGrad.addColorStop(0.7, 'rgba(1, 5, 15, 0.48)');
        coreGrad.addColorStop(1, 'rgba(2, 6, 20, 0)');
        ctx.fillStyle = coreGrad;
        ctx.beginPath();
        ctx.arc(cx, cy, bhRadius * 0.85, 0, Math.PI * 2);
        ctx.fill();

        // 4. PRECISE 42-SECOND GAME CYCLE:
        // Phase 1: BETTING (0s - 22s) -> 22s
        // Phase 2: ORBITING (22s - 36s) -> 14s
        // Phase 3: SUCTION (36s - 37s) -> 1s
        // Phase 4: WINNER (37s - 41s) -> 4s
        // Phase 5: RESET (41s - 42s) -> 1s
        var TOTAL_CYCLE = 42;
        var cycleTime = animTime % TOTAL_CYCLE;
        var roundNumber = Math.floor(animTime / TOTAL_CYCLE);
        var winnerIndex = activeWinnerIndex !== undefined ? activeWinnerIndex : getSeededWinnerIndex(roundNumber);

        var timerText = '';
        var phaseLabel = '';
        var isUrgent = false;

        if (isSyncedWithServer) {
          timerText = '' + Math.max(0, serverTimeLeft);
          phaseLabel = serverPhase;
          isUrgent = (serverPhase === 'BETTING' && serverTimeLeft <= 4);
        } else if (cycleTime < 22) {
          // Phase 1: BETTING (0s - 22s) -> 22 to 0 countdown
          var secondsLeft = Math.max(0, Math.ceil(22 - cycleTime));
          timerText = '' + secondsLeft;
          phaseLabel = 'BETTING';
          isUrgent = secondsLeft <= 4;
        } else if (cycleTime < 36) {
          // Phase 2: ORBITING (22s - 36s) -> 14 seconds (Action 0s to 14s)
          var orbitElapsed = cycleTime - 22;
          var secondsLeft = Math.max(0, Math.ceil(14 - orbitElapsed));
          timerText = '' + secondsLeft;
          phaseLabel = 'ORBITING';
          isUrgent = secondsLeft <= 3;
        } else if (cycleTime < 37) {
          // Phase 3: SUCTION (36s - 37s) -> 1 second (Action 14s to 15s)
          timerText = '1';
          phaseLabel = 'SUCTION';
          isUrgent = true;
        } else if (cycleTime < 41) {
          // Phase 4: WINNER (37s - 41s) -> 4 seconds (Action 15s to 19s)
          var winnerElapsed = cycleTime - 37;
          var secondsLeft = Math.max(0, Math.ceil(4 - winnerElapsed));
          timerText = '' + secondsLeft;
          phaseLabel = 'WINNER!';
          isUrgent = false;
        } else {
          // Phase 5: RESET & RETURN (41s - 42s) -> 1 second (Action 19s to 20s)
          timerText = '0';
          phaseLabel = 'RESET';
          isUrgent = false;
        }

        ctx.save();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = '900 34px system-ui, -apple-system, sans-serif';

        ctx.shadowColor = (phaseLabel === 'WINNER!')
          ? 'rgba(250, 204, 21, 0.95)'
          : isUrgent
            ? 'rgba(239, 68, 68, 0.95)'
            : (cycleTime < 22)
              ? 'rgba(56, 189, 248, 0.85)'
              : 'rgba(234, 179, 8, 0.95)';
        ctx.shadowBlur = 12;

        ctx.strokeStyle = 'rgba(0, 0, 0, 0.95)';
        ctx.lineWidth = 4.5;
        ctx.strokeText(timerText, cx, cy - 6);

        ctx.fillStyle = (phaseLabel === 'WINNER!')
          ? '#fef08a'
          : isUrgent
            ? '#ef4444'
            : (cycleTime < 22)
              ? '#ffffff'
              : '#fef08a';
        ctx.fillText(timerText, cx, cy - 6);

        ctx.font = '900 11px system-ui, -apple-system, sans-serif';
        ctx.shadowColor = 'rgba(0, 0, 0, 0.95)';
        ctx.shadowBlur = 6;
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.92)';
        ctx.lineWidth = 3.5;
        ctx.strokeText(phaseLabel, cx, cy + 18);

        ctx.fillStyle = (phaseLabel === 'WINNER!')
          ? '#facc15'
          : isUrgent
            ? '#fca5a5'
            : (cycleTime < 22)
              ? '#38bdf8'
              : '#eab308';
        ctx.fillText(phaseLabel, cx, cy + 18);

        ctx.restore();
        ctx.restore();
      }

      function drawPlanet(p, cx, cy, rad, spinAngle, showText, customFontSize) {
        if (showText === undefined) showText = true;
        if (p.haloColor) {
          ctx.save();
          var haloGrad = ctx.createRadialGradient(cx, cy, rad * 0.75, cx, cy, rad * 1.55);
          haloGrad.addColorStop(0, p.haloColor);
          haloGrad.addColorStop(0.55, p.haloStop || 'rgba(0,0,0,0.22)');
          haloGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
          ctx.fillStyle = haloGrad;
          ctx.beginPath();
          ctx.arc(cx, cy, rad * 1.55, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }

        if (p.hasRing) {
          ctx.save();
          ctx.translate(cx, cy);
          ctx.rotate(-0.32);

          ctx.beginPath();
          ctx.ellipse(0, 0, rad * 1.95, rad * 0.52, 0, Math.PI, Math.PI * 2);
          ctx.strokeStyle = 'rgba(245, 158, 11, 0.75)';
          ctx.lineWidth = 14;
          ctx.stroke();

          ctx.beginPath();
          ctx.ellipse(0, 0, rad * 1.62, rad * 0.44, 0, Math.PI, Math.PI * 2);
          ctx.strokeStyle = 'rgba(254, 240, 138, 0.95)';
          ctx.lineWidth = 5;
          ctx.stroke();

          ctx.beginPath();
          ctx.ellipse(0, 0, rad * 1.35, rad * 0.36, 0, Math.PI, Math.PI * 2);
          ctx.strokeStyle = 'rgba(180, 83, 9, 0.85)';
          ctx.lineWidth = 4;
          ctx.stroke();

          ctx.restore();
        }

        if (p.hasSubtleRing) {
          ctx.save();
          ctx.translate(cx, cy);
          ctx.rotate(0.95);
          ctx.beginPath();
          ctx.ellipse(0, 0, rad * 1.52, rad * 0.28, 0, Math.PI, Math.PI * 2);
          ctx.strokeStyle = 'rgba(103, 232, 249, 0.85)';
          ctx.lineWidth = 4.5;
          ctx.stroke();
          ctx.restore();
        }

        ctx.save();
        ctx.beginPath();
 