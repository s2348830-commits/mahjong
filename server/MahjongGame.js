const { CONSTANTS, YakuHelper, ScoreCalculator, YakuEvaluator } = require('./YakuEvaluator');

function log(...args) {
    console.log('[MahjongGame]', ...args);
}

class MahjongGame {
    constructor(playerIds, room) {
        this.room = room;
        this.playerIds = playerIds;
        this.settings = room.settings;
        
        this.roundWind = '1z'; 
        this.kyoku = 1;        
        this.dealerIndex = 0;  
        this.honba = 0;        
        this.kyoutaku = 0;     
        this.points = {};
        
        let startPt = this.settings.startPoints || 25000;
        playerIds.forEach(id => { this.points[id] = startPt; });

        this.wall = [];
        this.deadWall = [];
        this.doraIndicators = [];
        this.uraDoraIndicators = [];
        this.kanCount = 0;
        this.kanPlayers = new Set();
        
        this.players = {};
        this.currentTurn = 0; 
        this.lastDiscardTile = null; 
        this.lastDiscardPlayer = null;
        
        this.phase = 'DRAW';
        this.actionResponses = {};
        this.waitingFor = [];
        this.winner = null;
        this.winningType = null; 
        this.winningYaku = null; 

        this.actionResolved = false;
        this.rinshan = false;
        this.chankanTile = null;
        this.isIppatsuValid = false;
        this.turnCount = 0;
        this.suukansanraPending = false;

        this.finalResults = null;
        this.endReason = null;
        
        this.turnTimer = null;

        this._setupManagers();
        this.startRound();
    }

    emitGameState() {
        if (this.room && typeof this.room.broadcastState === 'function') {
            this.room.broadcastState();
        }
    }

    parseThinkTime(str) {
        if (!str) return 15;
        let parts = str.split('+');
        if (parts.length === 2) return parseInt(parts[0]) + parseInt(parts[1]);
        return parseInt(str) || 15;
    }

    resetTimer() {
        clearTimeout(this.turnTimer);
        if (this.phase === 'FINISHED' || this.phase === 'FINISHED_GAME') return;
        
        let timeMs = this.parseThinkTime(this.settings.thinkTime) * 1000 + 2000;
        
        this.turnTimer = setTimeout(() => {
            this.handleTimeout();
        }, timeMs);
    }

    handleTimeout() {
        try {
            if (this.phase === 'DRAW') {
                let current = this.turnManager.getCurrent();
                let p = this.players[current];
                if (p) {
                    let tileIndex = p.hand.length - 1;
                    this.handlePlayerAction(current, { type: 'DISCARD', payload: { tileIndex } });
                }
            } else if (this.phase === 'ACTION_WAIT') {
                this.waitingFor.forEach(id => {
                    if (!this.actionResponses[id]) {
                        this.handlePlayerAction(id, { type: 'PASS' });
                    }
                });
            }
        } catch(e) { console.error('Timeout Error', e); }
    }

    _setupManagers() {
        const self = this;

        this.turnManager = {
            getCurrent: () => self.playerIds[self.currentTurn],
            next: () => {
                self.currentTurn = (self.currentTurn + 1) % self.playerIds.length;
                return self.playerIds[self.currentTurn];
            },
            isCurrentPlayer: (id) => self.playerIds[self.currentTurn] === id
        };

        this.handManager = {
            draw: (playerId) => {
                if (self.wall.length === 0) return false;
                self.players[playerId].hand.push(self.wall.pop());
                self.players[playerId].tempFuriten = false;
                return true;
            },
            drawRinshan: (playerId) => {
                if (self.kanCount >= 4) return false; 
                self.kanPlayers.add(playerId);
                self.players[playerId].hand.push(self.deadWall.pop());
                self.doraIndicators.push(self.deadWall[self.kanCount * 2 + 2]);
                self.uraDoraIndicators.push(self.deadWall[self.kanCount * 2 + 3]);
                self.kanCount++;
                self.wall.pop(); 
                
                if (self.kanCount === 4 && self.kanPlayers.size > 1) {
                    self.suukansanraPending = true;
                }
                return true;
            },
            discard: (playerId, tileIndex) => {
                if (!playerId || typeof playerId !== 'string') throw new Error('Invalid playerId');
                if (tileIndex < 0 || tileIndex >= self.players[playerId].hand.length) throw new Error('Invalid index');
                const tile = self.players[playerId].hand.splice(tileIndex, 1)[0];
                if (!tile || typeof tile !== 'string') throw new Error('Invalid tile');
                
                self.players[playerId].discards.push(tile);
                self.players[playerId].furitenDiscards.push(tile); 
                self.players[playerId].firstTurn = false;
                return tile;
            }
        };

        this.ai = {
            chooseDiscard: (playerId, level) => {
                let p = self.players[playerId];
                if (level === 'easy') return { type: 'DISCARD', payload: { tileIndex: p.hand.length - 1 } };

                let reachable = [];
                for (let i = 0; i < p.hand.length; i++) {
                    let testHand = [...p.hand]; testHand.splice(i, 1);
                    let winning = self.getWinningTiles(playerId, testHand);
                    if (winning.length > 0) reachable.push({ index: i, tile: p.hand[i], winningTiles: winning });
                }

                if (reachable.length > 0) {
                    reachable.sort((a, b) => b.winningTiles.length - a.winningTiles.length);
                    for (let r of reachable) {
                        let norm = YakuHelper.safeNormalize(r.tile);
                        if (!p.forbiddenDiscards.includes(norm)) {
                            if (r.winningTiles.length >= 4 || self.points[playerId] >= 1000) return { type: 'RIICHI' }; 
                            return { type: 'DISCARD', payload: { tileIndex: r.index } };
                        }
                    }
                }

                let hand = p.hand;
                let tileCounts = YakuHelper.countTiles(hand);
                let bestIndex = -1;
                let maxScore = -9999;
                
                let safeTiles = new Set();
                let isSomeoneRiichi = false;
                self.playerIds.forEach(id => {
                    if (id !== playerId && self.players[id].riichi) {
                        isSomeoneRiichi = true;
                        self.players[id].discards.forEach(d => safeTiles.add(YakuHelper.safeNormalize(d)));
                    }
                });

                let suitCounts = { m: 0, p: 0, s: 0, z: 0 };
                if (level === 'hard') {
                    hand.forEach(t => { suitCounts[t[1]]++; });
                }
                let targetSuit = null;
                if (level === 'hard') {
                    let maxSuit = ['m','p','s'].reduce((a, b) => suitCounts[a] > suitCounts[b] ? a : b);
                    if (suitCounts[maxSuit] >= 6) targetSuit = maxSuit;
                }

                for (let i = 0; i < hand.length; i++) {
                    let tile = hand[i];
                    let norm = YakuHelper.safeNormalize(tile);
                    
                    if (p.forbiddenDiscards.includes(norm)) continue;

                    let score = 0; 
                    let suit = norm[1]; let num = parseInt(norm[0]);

                    if (tileCounts[norm] >= 2) score -= 20; 
                    else {
                        if (suit !== 'z') {
                            let tPrev = (num - 1) + suit; let tNext = (num + 1) + suit;
                            let tPrev2 = (num - 2) + suit; let tNext2 = (num + 2) + suit;
                            if (tileCounts[tPrev] || tileCounts[tNext]) score -= 10; 
                            if (tileCounts[tPrev2] || tileCounts[tNext2]) score -= 5; 
                            if (num === 1 || num === 9) score += 5; 
                            if (level === 'hard' && num >= 3 && num <= 7) score -= 8;
                        } else {
                            score += 15; 
                            if (level === 'hard' && (CONSTANTS.SANGEN.includes(norm) || norm === self.roundWind || norm === CONSTANTS.WINDS[(self.playerIds.indexOf(playerId) - self.dealerIndex + self.playerIds.length) % self.playerIds.length])) {
                                if (tileCounts[norm] >= 2) score -= 30;
                            }
                        }
                    }

                    if (level === 'hard' && targetSuit) {
                        if (suit !== targetSuit && suit !== 'z') score += 40; 
                        if (suit === targetSuit) score -= 20; 
                    }

                    let isDora = self.doraIndicators.map(ind => YakuHelper.getDoraTile(ind)).includes(norm);
                    if (isDora) score -= 30; 
                    
                    if (isSomeoneRiichi) {
                        if (safeTiles.has(norm)) score += 100; 
                        else if (suit !== 'z') score -= 50; 
                    }

                    if (score > maxScore) { maxScore = score; bestIndex = i; }
                }
                
                if (bestIndex === -1) bestIndex = hand.length - 1;

                return { type: 'DISCARD', payload: { tileIndex: bestIndex } };
            }
        };
    }

    startRound() {
        log(`Round Start: ${this.roundWind} ${this.kyoku} Kyoku, Honba: ${this.honba}`);
        
        const tiles = [];
        for (let suit of ['m', 'p', 's']) {
            for (let i = 1; i <= 9; i++) { 
                if (this.settings.mode === 3 && suit === 'm' && i >= 2 && i <= 8) continue;
                for(let j=0; j<4; j++) tiles.push(i + suit); 
            }
        }
        for (let i = 1; i <= 7; i++) { for(let j=0; j<4; j++) tiles.push(i + 'z'); }
        
        if (this.settings.akaDora > 0) {
            let akaCount = this.settings.akaDora;
            let m5Idx = tiles.indexOf('5m'); if (m5Idx !== -1 && akaCount >= 1) tiles[m5Idx] = '0m';
            let p5Idx = tiles.indexOf('5p'); if (p5Idx !== -1 && akaCount >= 2) tiles[p5Idx] = '0p';
            let s5Idx = tiles.indexOf('5s'); if (s5Idx !== -1 && akaCount >= 3) tiles[s5Idx] = '0s';
            if (akaCount === 4) { let p5Idx2 = tiles.lastIndexOf('5p'); if (p5Idx2 !== -1) tiles[p5Idx2] = '0p'; }
        }
        this.wall = tiles.sort(() => Math.random() - 0.5);

        this.deadWall = this.wall.splice(0, 14);
        this.doraIndicators = [this.deadWall[0]];
        this.uraDoraIndicators = [this.deadWall[1]];
        this.kanCount = 0;
        this.kanPlayers.clear();
        
        this.players = {};
        this.playerIds.forEach(id => {
            this.players[id] = { 
                hand: [], discards: [], furitenDiscards: [], melds: [], 
                riichi: false, doubleRiichi: false, openHand: false,
                tempFuriten: false, riichiFuriten: false, firstTurn: true,
                kita: 0, forbiddenDiscards: [], pao: null,
                riichiIndex: -1 
            };
        });
        
        this.currentTurn = this.dealerIndex; 
        this.lastDiscardTile = null; 
        this.lastDiscardPlayer = null;
        
        this.phase = 'DRAW';
        this.actionResponses = {};
        this.waitingFor = [];
        this.winner = null;
        this.winningType = null; 
        this.winningYaku = null; 

        this.actionResolved = false;
        this.rinshan = false;
        this.chankanTile = null;
        this.isIppatsuValid = false;
        this.turnCount = 0;
        this.suukansanraPending = false;

        YakuHelper.winningTilesCache.clear();

        this.playerIds.forEach(id => {
            for (let i = 0; i < 13; i++) { this.players[id].hand.push(this.wall.pop()); }
        });
        
        this.handManager.draw(this.turnManager.getCurrent());
        this.emitGameState();
        this.triggerAILogic(this.turnManager.getCurrent());
        
        this.resetTimer();
    }

    checkGameEnd() {
        let isEnd = false;
        let endReason = '';

        if (this.settings.tobi) {
            for (const id of this.playerIds) {
                if (this.points[id] < 0) {
                    isEnd = true;
                    endReason = 'トビ終了';
                    break;
                }
            }
        }

        if (!isEnd) {
            const isEastOnly = this.settings.length === 'east';
            const isSouthOnly = this.settings.length === 'south';
            const windIndex = CONSTANTS.WINDS.indexOf(this.roundWind); 

            if (isEastOnly && windIndex >= 1) { 
                isEnd = true; endReason = '東風戦終了';
            } else if (isSouthOnly && windIndex >= 2) { 
                isEnd = true; endReason = '半荘戦終了';
            }
        }

        if (isEnd) {
            clearTimeout(this.turnTimer);
            const sortedPlayers = [...this.playerIds].sort((a, b) => this.points[b] - this.points[a]);
            const finalResults = sortedPlayers.map((id, index) => ({
                id, rank: index + 1, points: this.points[id]
            }));
            this.room.handleGameEnd(finalResults, endReason);
            return true;
        }
        return false;
    }

    nextRound(isDealerWin, isDealerTenpai) {
        if (this.checkGameEnd()) return;

        if (isDealerWin || (this.winningType === 'RYUUKYOKU' && isDealerTenpai)) {
            this.honba++; 
        } else {
            this.dealerIndex = (this.dealerIndex + 1) % this.playerIds.length;
            this.kyoku++;
            if (this.winningType !== 'RYUUKYOKU') this.honba = 0; 
            else this.honba++;
            
            if (this.kyoku > this.playerIds.length) {
                this.kyoku = 1;
                let wIdx = CONSTANTS.WINDS.indexOf(this.roundWind);
                this.roundWind = CONSTANTS.WINDS[(wIdx + 1) % 4];
            }
        }

        if (this.checkGameEnd()) return;
        this.startRound();
    }

    handleRyuukyoku(reason = '荒牌平局') {
        clearTimeout(this.turnTimer);
        log(`Ryuukyoku: ${reason}`);
        
        if (reason === '荒牌平局') {
            let nagashiWinners = [];
            let nagashiYakuList = [];
            
            this.playerIds.forEach(id => {
                let p = this.players[id];
                if (p.discards.length > 0 && p.discards.length === p.furitenDiscards.length) {
                    let isAllYaochu = p.discards.every(d => CONSTANTS.YAOCHU.includes(YakuHelper.safeNormalize(d)));
                    if (isAllYaochu) {
                        nagashiWinners.push(id);
                        let isDealer = (this.playerIds.indexOf(id) === this.dealerIndex);
                        let point = ScoreCalculator.calculate(5, 20, isDealer, true); 
                        nagashiYakuList.push({ han: 5, fu: 20, yaku: ['流し満貫'], point: point });
                    }
                }
            });

            if (nagashiWinners.length > 0) {
                this.phase = 'FINISHED';
                this.winningType = 'TSUMO';
                this.winner = nagashiWinners;
                this.winningYaku = nagashiYakuList;
                
                let isDealerWin = false;
                nagashiWinners.forEach((pId, idx) => {
                    let yakuData = nagashiYakuList[idx];
                    let pInfo = yakuData.point;
                    let isD = (this.playerIds.indexOf(pId) === this.dealerIndex);
                    if (isD) isDealerWin = true;

                    if (pInfo.dealerPay === 0) {
                        let pay = pInfo.nonDealerPay;
                        this.playerIds.forEach(id => { if (id !== pId) this.points[id] -= pay; });
                        let totalGet = pay * (this.playerIds.length - 1);
                        yakuData.point.total = totalGet;
                        this.points[pId] += totalGet + (this.kyoutaku * CONSTANTS.COST.RIICHI);
                    } else {
                        let dPay = pInfo.dealerPay;
                        let nPay = pInfo.nonDealerPay;
                        this.playerIds.forEach(id => {
                            if (id !== pId) {
                                let isD2 = (this.playerIds.indexOf(id) === this.dealerIndex);
                                this.points[id] -= isD2 ? dPay : nPay;
                            }
                        });
                        let totalGet = dPay + nPay * (this.playerIds.length - 2);
                        yakuData.point.total = totalGet;
                        this.points[pId] += totalGet + (this.kyoutaku * CONSTANTS.COST.RIICHI);
                    }
                    if (idx === 0) this.kyoutaku = 0;
                    this.players[pId].openHand = true; 
                });
                
                this.emitGameState();
                setTimeout(() => this.nextRound(isDealerWin, true), 7000);
                return;
            }
        }

        this.phase = 'FINISHED';
        this.winningType = 'RYUUKYOKU';
        
        let resultMsg = [reason];
        let isDealerTenpai = false;

        this.winner = ['流局'];
        if (reason === '荒牌平局') {
            let tenpaiPlayers = []; let notenPlayers = [];
            this.playerIds.forEach(id => {
                if (this.isTenpai(id)) {
                    tenpaiPlayers.push(id);
                    if (this.playerIds.indexOf(id) === this.dealerIndex) isDealerTenpai = true;
                    this.players[id].openHand = true; 
                } else {
                    notenPlayers.push(id);
                    this.players[id].openHand = false; 
                }
            });

            if (tenpaiPlayers.length === 0) resultMsg.push("全員ノーテン");
            else if (tenpaiPlayers.length === this.playerIds.length) resultMsg.push("全員聴牌");
            else {
                resultMsg.push(`聴牌: ${tenpaiPlayers.join(', ')}`);
                let pay = CONSTANTS.COST.RYUUKYOKU / notenPlayers.length; 
                let get = CONSTANTS.COST.RYUUKYOKU / tenpaiPlayers.length;
                tenpaiPlayers.forEach(id => this.points[id] += get);
                notenPlayers.forEach(id => this.points[id] -= pay);
                resultMsg.push(`罰符: 聴牌+${get} / ノーテン-${pay}`);
            }
        } else {
            isDealerTenpai = true; 
            this.playerIds.forEach(id => this.players[id].openHand = true);
        }

        this.winningYaku = [{ han: 0, fu: 0, point: { total: 0, isTsumo: false }, yaku: resultMsg }];
        this.emitGameState();
        setTimeout(() => this.nextRound(false, isDealerTenpai), 7000);
    }

    checkPao(playerId, tileNorm, discarderId) {
        let p = this.players[playerId];
        let sangenCount = p.melds.filter(m => m.isOpen && CONSTANTS.SANGEN.includes(YakuHelper.safeNormalize(m.tile))).length;
        let windsCount = p.melds.filter(m => m.isOpen && CONSTANTS.WINDS.includes(YakuHelper.safeNormalize(m.tile))).length;
        
        if (sangenCount === 3 && CONSTANTS.SANGEN.includes(tileNorm)) {
            p.pao = discarderId;
        } else if (windsCount === 4 && CONSTANTS.WINDS.includes(tileNorm)) {
            p.pao = discarderId;
        }
    }

    checkWin(playerId, winTile, isTsumo, isChankan = false) {
        let player = this.players[playerId];
        let actualWinTile = winTile || player.hand[player.hand.length - 1];
        let playerIndex = this.playerIds.indexOf(playerId);
        
        let jikazeIdx = (playerIndex - this.dealerIndex + this.playerIds.length) % this.playerIds.length;
        
        let stateObj = {
            winTileRaw: actualWinTile, isTsumo: isTsumo, isRiichi: player.riichi, isDoubleRiichi: player.doubleRiichi,
            isIppatsu: player.riichi && this.isIppatsuValid, isRinshan: this.rinshan, isChankan: isChankan,
            isHoutei: (!isTsumo && this.wall.length === 0), isHaitei: (isTsumo && this.wall.length === 0),
            isFirstTurn: player.firstTurn, kanCount: this.kanCount, isDealer: playerIndex === this.dealerIndex,
            isTenhou: (isTsumo && player.firstTurn && playerIndex === this.dealerIndex),
            isChiihou: (isTsumo && player.firstTurn && playerIndex !== this.dealerIndex && this.kanCount === 0),
            bakaze: this.roundWind, jikaze: CONSTANTS.WINDS[jikazeIdx], 
            doraIndicators: this.doraIndicators, uraDoraIndicators: this.uraDoraIndicators, settings: this.settings,
            kitaCount: player.kita
        };
        try {
            return YakuEvaluator.evaluate(player.hand, player.melds, stateObj);
        } catch(e) {
            console.error("Yaku Evaluator Error", e); return null;
        }
    }

    getWinningTiles(playerId, testHand = null, assumeRiichi = false) {
        let p = this.players[playerId];
        let hand = testHand || p.hand;
        let playerIndex = this.playerIds.indexOf(playerId);
        let jikazeIdx = (playerIndex - this.dealerIndex + this.playerIds.length) % this.playerIds.length;
        
        let winning = [];
        for (let winTile of CONSTANTS.TILES) {
            let totalCount = hand.filter(t => t === winTile).length;
            p.melds.forEach(m => { if (m.tile === winTile) totalCount += (m.type === 'kantsu' ? 4 : 3); });
            if (totalCount >= 4) continue;

            let isRiichiState = p.riichi || assumeRiichi;

            let state = { 
                winTileRaw: winTile, isTsumo: false, isRiichi: isRiichiState, bakaze: this.roundWind, jikaze: CONSTANTS.WINDS[jikazeIdx], 
                doraIndicators: [], uraDoraIndicators: [], kitaCount: p.kita, settings: this.settings, isFirstTurn: p.firstTurn, 
                kanCount: this.kanCount, isDealer: playerIndex === this.dealerIndex 
            };
            try {
                if (YakuEvaluator.evaluate([...hand, winTile], p.melds, state)) {
                    winning.push(winTile);
                }
            } catch(e) {}
        }
        return winning;
    }

    isTenpai(playerId) {
        let p = this.players[playerId];
        let hLen = p.hand.length;
        let isMenzen = p.melds.filter(m => m.isOpen).length === 0;

        if (hLen % 3 === 1) return this.getWinningTiles(playerId, p.hand, isMenzen).length > 0;
        if (hLen % 3 === 2) {
            for (let i = 0; i < p.hand.length; i++) {
                let testHand = [...p.hand]; testHand.splice(i, 1);
                if (this.getWinningTiles(playerId, testHand, isMenzen).length > 0) return true;
            }
        }
        return false;
    }

    isFuriten(playerId) {
        let p = this.players[playerId];
        if (p.tempFuriten || p.riichiFuriten) return true;
        let winningTiles = this.getWinningTiles(playerId);
        for (let wt of winningTiles) {
            let normWt = YakuHelper.safeNormalize(wt);
            if (p.furitenDiscards.some(d => YakuHelper.safeNormalize(d) === normWt)) return true;
        }
        return false;
    }

    canRon(playerId, tile, isChankan = false) { 
        if (this.isFuriten(playerId)) return false; 
        return this.checkWin(playerId, tile, false, isChankan) !== null; 
    }

    getChiOptions(playerId, tile) {
        if (this.settings.mode === 3) return []; 
        const p = this.players[playerId];
        if (p.riichi) return [];
        const norm = YakuHelper.safeNormalize(tile);
        if (!norm || norm.includes('z')) return [];
        
        const suit = norm[1];
        const num = parseInt(norm[0]);
        const counts = YakuHelper.countTiles(p.hand);
        let options = [];
        
        if (num >= 3 && counts[(num-2)+suit] > 0 && counts[(num-1)+suit] > 0) options.push([(num-2)+suit, (num-1)+suit]);
        if (num >= 2 && num <= 8 && counts[(num-1)+suit] > 0 && counts[(num+1)+suit] > 0) options.push([(num-1)+suit, (num+1)+suit]);
        if (num <= 7 && counts[(num+1)+suit] > 0 && counts[(num+2)+suit] > 0) options.push([(num+1)+suit, (num+2)+suit]);
        return options;
    }

    getKanOptions(playerId) {
        const p = this.players[playerId];
        if (p.riichi) return { ankan: [], kakan: [] }; 
        const counts = YakuHelper.countTiles(p.hand);
        let ankan = []; let kakan = [];
        
        for (const [tile, count] of Object.entries(counts)) {
            if (count === 4) ankan.push(tile);
        }
        p.melds.forEach(m => {
            if (m.type === 'koutsu' && m.isOpen) {
                const normMeld = YakuHelper.safeNormalize(m.tile);
                if (counts[normMeld] > 0) kakan.push(normMeld);
            }
        });
        return { ankan, kakan };
    }

    handlePlayerDiscard(playerId, tileIndex) {
        try {
            const tileCode = this.players[playerId].hand[tileIndex];
            if (!tileCode) return;
            const normCode = YakuHelper.safeNormalize(tileCode);
            
            if (this.players[playerId].forbiddenDiscards && this.players[playerId].forbiddenDiscards.includes(normCode)) {
                return; 
            }
            this.players[playerId].forbiddenDiscards = [];

            this.lastDiscardTile = this.handManager.discard(playerId, tileIndex);
        } catch (e) {
            console.error('Discard Error', e); return;
        }
        
        this.lastDiscardPlayer = playerId;
        this.actionResponses = {};
        this.waitingFor = [];
        this.actionResolved = false; 
        this.rinshan = false; 
        
        const discardIdx = this.playerIds.indexOf(playerId);

        this.playerIds.forEach(id => {
            if (id !== playerId) {
                let canR = this.canRon(id, this.lastDiscardTile);
                let canP = !this.players[id].riichi && this.players[id].hand.filter(t => YakuHelper.safeNormalize(t) === YakuHelper.safeNormalize(this.lastDiscardTile)).length >= 3; 
                if (!canP) canP = !this.players[id].riichi && this.players[id].hand.filter(t => YakuHelper.safeNormalize(t) === YakuHelper.safeNormalize(this.lastDiscardTile)).length >= 2; 
                
                let canC = false;
                if (!this.players[id].riichi && this.playerIds.indexOf(id) === (discardIdx + 1) % this.playerIds.length) {
                    canC = this.getChiOptions(id, this.lastDiscardTile).length > 0;
                }

                if (canR || canP || canC) this.waitingFor.push(id);
                else this.actionResponses[id] = { type: 'PASS' }; 
            }
        });

        if (this.waitingFor.length > 0) {
            this.phase = 'ACTION_WAIT';
            this.emitGameState();
            this.triggerAILogic(null); 
            this.resetTimer();
        } else {
            if (this.suukansanraPending) {
                this.handleRyuukyoku('四槓散了');
                return;
            }
            this.proceedToNextTurn();
        }
    }

    proceedToNextTurn() {
        this.turnCount++;
        this.playerIds.forEach(id => this.players[id].tempFuriten = false);
        
        if (this.turnCount === 4 && this.settings.mode === 4) {
            let noMelds = this.playerIds.every(id => this.players[id].melds.length === 0);
            if (noMelds) {
                let firstDiscard = this.players[this.playerIds[0]].discards[0];
                if (firstDiscard && ['1z','2z','3z','4z'].includes(YakuHelper.safeNormalize(firstDiscard))) {
                    let allSame = this.playerIds.every(id => {
                        let d = this.players[id].discards[0];
                        return d && YakuHelper.safeNormalize(d) === YakuHelper.safeNormalize(firstDiscard);
                    });
                    if (allSame) { this.handleRyuukyoku('四風連打'); return; }
                }
            }
        }
        
        if (this.playerIds.filter(id => this.players[id].riichi).length === this.settings.mode) {
            this.handleRyuukyoku(this.settings.mode === 3 ? '三家立直' : '四家立直'); return;
        }

        this.phase = 'DRAW';
        let nextId = this.turnManager.next();
        if (!this.handManager.draw(nextId)) {
            this.handleRyuukyoku('荒牌平局');
            return;
        }
        this.isIppatsuValid = false; 
        this.emitGameState();
        this.triggerAILogic(nextId);
        this.resetTimer();
    }

    resolveActions() {
        if (this.actionResolved) return; 

        let allResponded = this.waitingFor.every(id => this.actionResponses[id]);
        if (!allResponded) return;

        this.actionResolved = true; 

        let ronPlayers = []; 
        let ponPlayer = null;
        let minkanPlayer = null;
        let chiPlayer = null;
        let chiTiles = null;

        let discardIdx = this.playerIds.indexOf(this.lastDiscardPlayer);
        
        for (let i = 1; i < this.playerIds.length; i++) {
            let idx = (discardIdx + i) % this.playerIds.length;
            let id = this.playerIds[idx];
            let res = this.actionResponses[id];
            
            if (res?.type === 'RON') ronPlayers.push(id);
            else if (res?.type === 'PON' && !ponPlayer && !minkanPlayer) ponPlayer = id;
            else if (res?.type === 'MINKAN' && !ponPlayer && !minkanPlayer) minkanPlayer = id;
            else if (res?.type === 'CHI' && !chiPlayer && i === 1) { 
                chiPlayer = id;
                chiTiles = res.payload.tiles;
            }
            else if (res === 'PASS' || res?.type === 'PASS') {
                if (this.canRon(id, this.lastDiscardTile, this.chankanTile !== null)) {
                    this.players[id].tempFuriten = true;
                    if (this.players[id].riichi) this.players[id].riichiFuriten = true;
                }
            }
        }

        if (ronPlayers.length > 0) {
            clearTimeout(this.turnTimer);
            this.phase = 'FINISHED';
            this.winner = ronPlayers;
            this.winningType = ronPlayers.length === 1 ? 'RON' : 'RON_MULTI';
            let actualWinTile = this.chankanTile !== null ? this.chankanTile : this.lastDiscardTile;
            this.winningYaku = ronPlayers.map(pId => this.checkWin(pId, actualWinTile, false, this.chankanTile !== null));
            
            let isDealerWin = false;
            ronPlayers.forEach((pId, idx) => {
                this.players[pId].hand.push(actualWinTile);
                let yakuData = this.winningYaku[idx];
                let pt = yakuData.point.total + (this.honba * CONSTANTS.COST.HONBA);
                
                let paoPlayer = null;
                if (this.players[pId].pao && (yakuData.yaku.includes('大三元') || yakuData.yaku.includes('大四喜'))) {
                    paoPlayer = this.players[pId].pao;
                }

                if (paoPlayer && paoPlayer !== this.lastDiscardPlayer) {
                    let halfPt = Math.ceil(pt / 2);
                    this.points[this.lastDiscardPlayer] -= (pt - halfPt);
                    this.points[paoPlayer] -= halfPt;
                } else {
                    this.points[this.lastDiscardPlayer] -= pt;
                }
                
                this.points[pId] += pt;
                yakuData.point.total = pt; 
                
                if (idx === 0) { 
                    this.points[pId] += (this.kyoutaku * CONSTANTS.COST.RIICHI);
                    this.kyoutaku = 0;
                }
                if (this.playerIds.indexOf(pId) === this.dealerIndex) isDealerWin = true;
            });

            ronPlayers.forEach(id => this.players[id].openHand = true);
            this.emitGameState();
            setTimeout(() => this.nextRound(isDealerWin, true), 7000);

        } else if (this.chankanTile !== null) {
            let kakanPlayer = this.lastDiscardPlayer; 
            this.chankanTile = null;
            if (this.handManager.drawRinshan(kakanPlayer)) {
                this.phase = 'DRAW';
                this.rinshan = true;
                this.emitGameState();
                this.triggerAILogic(kakanPlayer);
                this.resetTimer();
            } else {
                this.handleRyuukyoku('四槓散了');
            }

        } else if (ponPlayer || minkanPlayer) {
            this.isIppatsuValid = false; 
            this.playerIds.forEach(id => this.players[id].tempFuriten = false);

            let activeId = ponPlayer || minkanPlayer;
            let player = this.players[activeId];
            let t = this.lastDiscardTile; 
            let normT = YakuHelper.safeNormalize(t);
            
            player.firstTurn = false;
            this.players[this.lastDiscardPlayer].discards.pop(); 
            
            let c = 0;
            let removeCount = ponPlayer ? 2 : 3;
            for (let i = player.hand.length - 1; i >= 0; i--) {
                if (YakuHelper.safeNormalize(player.hand[i]) === normT && c < removeCount) { 
                    player.hand.splice(i, 1); c++; 
                }
            }
            
            let activeIdx = this.playerIds.indexOf(activeId);
            let fromWho = (discardIdx - activeIdx + this.playerIds.length) % this.playerIds.length;

            if (ponPlayer) {
                player.forbiddenDiscards = [normT];
                player.melds.push({ type: 'koutsu', tile: t, isOpen: true, fromWho: fromWho }); 
                this.checkPao(activeId, normT, this.lastDiscardPlayer); 
                
                this.currentTurn = this.playerIds.indexOf(activeId);
                this.actionResponses = {}; this.waitingFor = [];
                this.phase = 'DRAW'; 
                this.emitGameState();
                this.triggerAILogic(activeId); 
                this.resetTimer();
            } else if (minkanPlayer) {
                player.melds.push({ type: 'kantsu', tile: t, isOpen: true, fromWho: fromWho }); 
                this.checkPao(activeId, normT, this.lastDiscardPlayer); 
                
                this.currentTurn = this.playerIds.indexOf(activeId);
                this.actionResponses = {}; this.waitingFor = [];
                if (this.handManager.drawRinshan(activeId)) {
                    this.phase = 'DRAW';
                    this.rinshan = true;
                    this.emitGameState();
                    this.triggerAILogic(activeId);
                    this.resetTimer();
                } else {
                    this.handleRyuukyoku('四槓散了');
                }
            }

        } else if (chiPlayer) {
            this.isIppatsuValid = false; 
            this.playerIds.forEach(id => this.players[id].tempFuriten = false);

            let activeId = chiPlayer;
            let player = this.players[activeId];
            let t = this.lastDiscardTile; 
            let normT = YakuHelper.safeNormalize(t);
            
            player.firstTurn = false;
            this.players[this.lastDiscardPlayer].discards.pop(); 

            for (let ct of chiTiles) {
                let idx = player.hand.findIndex(h => YakuHelper.safeNormalize(h) === YakuHelper.safeNormalize(ct));
                if (idx !== -1) player.hand.splice(idx, 1);
            }

            let numT = parseInt(normT[0]);
            let suitT = normT[1];
            let normChi = chiTiles.map(ct => YakuHelper.safeNormalize(ct)).sort();
            let numC1 = parseInt(normChi[0][0]);
            let numC2 = parseInt(normChi[1][0]);

            let forbidden = [normT];
            if (numC1 === numT + 1 && numC2 === numT + 2 && numT + 3 <= 9) forbidden.push(`${numT + 3}${suitT}`);
            if (numC1 === numT - 2 && numC2 === numT - 1 && numT - 3 >= 1) forbidden.push(`${numT - 3}${suitT}`);
            player.forbiddenDiscards = forbidden;

            let meldTiles = [t, ...chiTiles].sort();
            let activeIdx = this.playerIds.indexOf(activeId);
            let fromWho = (discardIdx - activeIdx + this.playerIds.length) % this.playerIds.length;
            player.melds.push({ type: 'shuntsu', tiles: meldTiles, isOpen: true, fromWho: fromWho, calledTile: t }); 
            
            this.currentTurn = this.playerIds.indexOf(activeId);
            this.actionResponses = {}; this.waitingFor = [];
            this.phase = 'DRAW'; 
            this.emitGameState();
            this.triggerAILogic(activeId); 
            this.resetTimer();

        } else {
            if (this.suukansanraPending) {
                this.handleRyuukyoku('四槓散了');
                return;
            }
            this.proceedToNextTurn();
        }
    }

    handlePlayerAction(playerId, action) {
        if (this.phase === 'FINISHED') return;

        if (this.phase === 'DRAW') {
            if (!this.turnManager.isCurrentPlayer(playerId)) return;

            if (action.type === 'KITA' && this.settings.mode === 3) {
                const player = this.players[playerId];
                let idx = player.hand.findIndex(t => YakuHelper.safeNormalize(t) === '4z');
                if (idx !== -1) {
                    player.hand.splice(idx, 1);
                    player.kita++;
                    if (this.handManager.draw(playerId)) {
                        this.rinshan = true;
                        this.emitGameState();
                        this.triggerAILogic(playerId);
                        this.resetTimer();
                    } else {
                        this.handleRyuukyoku('荒牌平局');
                    }
                }
                return;
            }

            if (action.type === 'KYUUSHU') {
                this.handleRyuukyoku('九種九牌');
                return;
            }

            if (action.type === 'RIICHI') {
                if (this.points[playerId] < CONSTANTS.COST.RIICHI) return; 
                let discards = [];
                let p = this.players[playerId];
                let isMenzen = p.melds.filter(m => m.isOpen).length === 0;

                for (let i = 0; i < p.hand.length; i++) {
                    let testHand = [...p.hand]; testHand.splice(i, 1);
                    let winning = this.getWinningTiles(playerId, testHand, isMenzen);
                    if (winning.length > 0) discards.push({ index: i, tile: p.hand[i], winningTiles: winning });
                }

                if (discards.length > 0) {
                    const playerInfo = this.room.players.get(playerId);
                    if (playerInfo && playerInfo.isAI) {
                        this.handlePlayerAction(playerId, { type: 'DO_RIICHI', payload: { tileIndex: discards[0].index } });
                    } else if (playerInfo && playerInfo.ws) {
                        playerInfo.ws.send(JSON.stringify({ type: 'REACH_OPTIONS', payload: { discards } }));
                    }
                }
                return;
            }

            if (action.type === 'DO_RIICHI') {
                this.players[playerId].riichi = true;
                this.players[playerId].riichiIndex = this.players[playerId].discards.length;
                if (this.players[playerId].firstTurn) this.players[playerId].doubleRiichi = true;
                this.points[playerId] -= CONSTANTS.COST.RIICHI; 
                this.kyoutaku++;
                this.isIppatsuValid = true; 
                this.rinshan = false; 
                
                // ① DO_RIICHI 実行後に必ず state を再送信する
                this.emitGameState();
                
                this.handlePlayerDiscard(playerId, action.payload.tileIndex);
                return;
            }

            if (action.type === 'ANKAN' || action.type === 'KAKAN') {
                const targetTile = action.payload.tile;
                const player = this.players[playerId];
                
                if (action.type === 'ANKAN') {
                    let c = 0;
                    for (let i = player.hand.length - 1; i >= 0; i--) {
                        if (YakuHelper.safeNormalize(player.hand[i]) === YakuHelper.safeNormalize(targetTile) && c < 4) { 
                            player.hand.splice(i, 1); c++; 
                        }
                    }
                    player.melds.push({ type: 'kantsu', tile: targetTile, isOpen: false, fromWho: 0 }); 
                    
                    if (this.handManager.drawRinshan(playerId)) {
                        this.rinshan = true;
                        this.emitGameState();
                        this.triggerAILogic(playerId);
                        this.resetTimer();
                    } else {
                        this.handleRyuukyoku('四槓散了');
                    }
                } else if (action.type === 'KAKAN') {
                    const meldIdx = player.melds.findIndex(m => m.type === 'koutsu' && m.isOpen && YakuHelper.safeNormalize(m.tile) === YakuHelper.safeNormalize(targetTile));
                    if (meldIdx !== -1) {
                        player.melds[meldIdx].type = 'kantsu'; 
                        let handIdx = player.hand.findIndex(h => YakuHelper.safeNormalize(h) === YakuHelper.safeNormalize(targetTile));
                        if(handIdx !== -1) player.hand.splice(handIdx, 1);

                        this.chankanTile = targetTile;
                        this.lastDiscardPlayer = playerId; 
                        this.actionResponses = {};
                        this.waitingFor = [];
                        this.actionResolved = false;

                        this.playerIds.forEach(id => {
                            if (id !== playerId) {
                                if (this.canRon(id, targetTile, true)) this.waitingFor.push(id);
                            }
                        });

                        if (this.waitingFor.length > 0) {
                            this.phase = 'ACTION_WAIT';
                            this.emitGameState();
                            this.triggerAILogic(null);
                            this.resetTimer();
                        } else {
                            this.chankanTile = null;
                            if (this.handManager.drawRinshan(playerId)) {
                                this.rinshan = true;
                                this.emitGameState();
                                this.triggerAILogic(playerId);
                                this.resetTimer();
                            } else {
                                this.handleRyuukyoku('四槓散了');
                            }
                        }
                    }
                }
                return;
            }

            if (action.type === 'DISCARD') {
                this.rinshan = false; 
                this.handlePlayerDiscard(playerId, action.payload.tileIndex);
            } else if (action.type === 'TSUMO') {
                let yakuResult = this.checkWin(playerId, null, true);
                if (yakuResult) {
                    clearTimeout(this.turnTimer);
                    this.rinshan = false; 
                    this.phase = 'FINISHED'; this.winner = [playerId]; this.winningType = 'TSUMO'; this.winningYaku = [yakuResult]; 
                    
                    let pInfo = yakuResult.point;
                    let isDealerWin = (playerId === this.playerIds[this.dealerIndex]);
                    
                    let paoPlayer = null;
                    if (this.players[playerId].pao && (yakuResult.yaku.includes('大三元') || yakuResult.yaku.includes('大四喜'))) {
                        paoPlayer = this.players[playerId].pao;
                    }

                    if (paoPlayer) {
                        let totalPay = pInfo.total + (this.honba * CONSTANTS.COST.TSUMO_HONBA * (this.playerIds.length - 1));
                        this.points[paoPlayer] -= totalPay;
                        this.points[playerId] += totalPay + (this.kyoutaku * CONSTANTS.COST.RIICHI);
                        yakuResult.point.total = totalPay;
                    } else {
                        if (pInfo.dealerPay === 0) { 
                            let pay = pInfo.nonDealerPay + (this.honba * CONSTANTS.COST.TSUMO_HONBA);
                            this.playerIds.forEach(id => { if (id !== playerId) this.points[id] -= pay; });
                            let totalGet = pay * (this.playerIds.length - 1);
                            yakuResult.point.total = totalGet;
                            this.points[playerId] += totalGet + (this.kyoutaku * CONSTANTS.COST.RIICHI);
                        } else { 
                            let dPay = pInfo.dealerPay + (this.honba * CONSTANTS.COST.TSUMO_HONBA);
                            let nPay = pInfo.nonDealerPay + (this.honba * CONSTANTS.COST.TSUMO_HONBA);
                            this.playerIds.forEach(id => {
                                if (id !== playerId) {
                                    let isD = (this.playerIds.indexOf(id) === this.dealerIndex);
                                    this.points[id] -= isD ? dPay : nPay;
                                }
                            });
                            let totalGet = dPay + nPay * (this.playerIds.length - 2);
                            yakuResult.point.total = totalGet;
                            this.points[playerId] += totalGet + (this.kyoutaku * CONSTANTS.COST.RIICHI);
                        }
                    }
                    this.kyoutaku = 0;

                    this.players[playerId].openHand = true;
                    this.emitGameState();
                    setTimeout(() => this.nextRound(isDealerWin, true), 7000); 
                }
            }
        } 
        else if (this.phase === 'ACTION_WAIT') {
            if (playerId === this.lastDiscardPlayer || !this.waitingFor.includes(playerId)) return;
            
            let actualTargetTile = this.chankanTile !== null ? this.chankanTile : this.lastDiscardTile;

            if (action.type === 'RON' && !this.isFuriten(playerId) && this.checkWin(playerId, actualTargetTile, false, this.chankanTile !== null)) {
                this.actionResponses[playerId] = { type: 'RON' };
            } 
            else if (this.chankanTile === null) {
                if (action.type === 'MINKAN' && !this.players[playerId].riichi && this.players[playerId].hand.filter(t => YakuHelper.safeNormalize(t) === YakuHelper.safeNormalize(this.lastDiscardTile)).length >= 3) {
                    this.actionResponses[playerId] = { type: 'MINKAN' };
                } else if (action.type === 'PON' && !this.players[playerId].riichi && this.players[playerId].hand.filter(t => YakuHelper.safeNormalize(t) === YakuHelper.safeNormalize(this.lastDiscardTile)).length >= 2) {
                    this.actionResponses[playerId] = { type: 'PON' };
                } else if (action.type === 'CHI' && !this.players[playerId].riichi && action.payload && action.payload.tiles) {
                    this.actionResponses[playerId] = { type: 'CHI', payload: { tiles: action.payload.tiles } };
                } else {
                    this.actionResponses[playerId] = { type: 'PASS' }; 
                }
            } else {
                this.actionResponses[playerId] = { type: 'PASS' }; 
            }
            this.resolveActions();
        }
    }

    triggerAILogic(playerId) {
        if (playerId) {
            let player = this.players[playerId];
            const playerInfo = this.room.players.get(playerId);
            let isBot = playerInfo && playerInfo.isAI;

            if (this.phase === 'DRAW' && this.turnManager.isCurrentPlayer(playerId)) {
                setTimeout(() => {
                    if (this.phase !== 'DRAW') return;
                    
                    if (isBot && this.settings.mode === 3 && player.hand.some(t => t.endsWith('4z'))) {
                        this.handlePlayerAction(playerId, { type: 'KITA' });
                        return;
                    }

                    if (isBot) {
                        let canWin = this.checkWin(playerId, null, true);
                        if (canWin) {
                            this.handlePlayerAction(playerId, { type: 'TSUMO' });
                        } else {
                            if (player.riichi) {
                                this.handlePlayerAction(playerId, { type: 'DISCARD', payload: { tileIndex: player.hand.length - 1 }});
                                return;
                            }
                            let level = this.settings.cpuLevel || 'normal';
                            let bestAction = this.ai.chooseDiscard(playerId, level);
                            this.handlePlayerAction(playerId, bestAction);
                        }
                    } else {
                        let canWin = this.checkWin(playerId, null, true);
                        if (player.riichi && !canWin) {
                            this.handlePlayerAction(playerId, { type: 'DISCARD', payload: { tileIndex: player.hand.length - 1 }});
                        }
                    }
                }, 1000);
            }
        }
        
        if (this.phase === 'ACTION_WAIT') {
            this.waitingFor.forEach(id => {
                const playerInfo = this.room.players.get(id);
                if (playerInfo && playerInfo.isAI) {
                    setTimeout(() => {
                        if (this.phase !== 'ACTION_WAIT') return;
                        let p = this.players[id];
                        let level = this.settings.cpuLevel || 'normal';
                        let actualTargetTile = this.chankanTile !== null ? this.chankanTile : this.lastDiscardTile;
                        
                        if (!this.isFuriten(id) && this.checkWin(id, actualTargetTile, false, this.chankanTile !== null)) {
                            this.handlePlayerAction(id, { type: 'RON' });
                        } 
                        else if (this.chankanTile === null && !p.riichi) {
                            let discNorm = YakuHelper.safeNormalize(this.lastDiscardTile);
                            let counts = YakuHelper.countTiles(p.hand);
                            let jikazeIdx = (this.playerIds.indexOf(id) - this.dealerIndex + this.playerIds.length) % this.playerIds.length;
                            let isYakuhai = CONSTANTS.SANGEN.includes(discNorm) || discNorm === this.roundWind || discNorm === CONSTANTS.WINDS[jikazeIdx];
                            
                            if (isYakuhai && counts[discNorm] >= 2) {
                                this.handlePlayerAction(id, { type: 'PON' });
                            } else if (level === 'hard') {
                                let isTanyaoTile = !!discNorm.match(/^[2-8][mps]$/);
                                if (isTanyaoTile && counts[discNorm] >= 2) {
                                    this.handlePlayerAction(id, { type: 'PON' });
                                } else {
                                    let chiOpts = this.getChiOptions(id, this.lastDiscardTile);
                                    let tanyaoChi = chiOpts.find(opt => opt.every(t => !!YakuHelper.safeNormalize(t).match(/^[2-8][mps]$/)));
                                    if (isTanyaoTile && tanyaoChi && this.actionResponses[id] === undefined) {
                                        this.handlePlayerAction(id, { type: 'CHI', payload: { tiles: tanyaoChi }});
                                    } else {
                                        this.handlePlayerAction(id, { type: 'PASS' });
                                    }
                                }
                            } else {
                                this.handlePlayerAction(id, { type: 'PASS' });
                            }
                        } else {
                            this.handlePlayerAction(id, { type: 'PASS' });
                        }
                    }, 800);
                }
            });
        }
    }

    getClientState(targetPlayerId) {
        const maskedHands = {}; const mappedMelds = {}; const mappedDiscards = {}; const mappedRiichi = {}; const mappedKita = {}; const mappedRiichiIndex = {};
        const mappedPlayers = this.playerIds.map(id => ({ id, points: this.points[id], isRiichi: this.players[id].riichi }));

        this.playerIds.forEach(id => {
            let p = this.players[id];
            if (id === targetPlayerId || this.phase === 'FINISHED' || this.room.settings.openHands || p.openHand) maskedHands[id] = p.hand;
            else maskedHands[id] = p.hand.map(() => 'back');
            mappedMelds[id] = p.melds; mappedDiscards[id] = p.discards; mappedRiichi[id] = p.riichi; mappedKita[id] = p.kita; mappedRiichiIndex[id] = p.riichiIndex;
        });

        let allowedActions = [];
        let chiOptions = [];
        let kanOptions = { ankan: [], kakan: [] };
        let forbiddenDiscards = [];
        
        // ② viewerId ごとに winningTiles を計算して state に含める
        let winningTiles = [];
        let pTarget = this.players[targetPlayerId];
        let isMenzenTarget = pTarget.melds.filter(m => m.isOpen).length === 0;

        if (this.isTenpai(targetPlayerId)) {
            if (pTarget.hand.length % 3 === 2) {
                // ツモ番中(14枚)の場合は、引いた牌を除外して計算
                let baseHandForWinning = [...pTarget.hand];
                baseHandForWinning.pop();
                winningTiles = this.getWinningTiles(targetPlayerId, baseHandForWinning, isMenzenTarget);
            } else {
                // 順番待ちなど(13枚)の場合はそのまま計算
                winningTiles = this.getWinningTiles(targetPlayerId, pTarget.hand, isMenzenTarget);
            }
        }

        if (this.phase === 'DRAW' && this.turnManager.isCurrentPlayer(targetPlayerId)) {
            forbiddenDiscards = pTarget.forbiddenDiscards || [];
            
            if (pTarget.firstTurn && pTarget.melds.length === 0 && pTarget.hand.length % 3 === 2) {
                let yaochuCount = new Set(pTarget.hand.map(t => YakuHelper.safeNormalize(t)).filter(t => t && t.match(/[19z]/))).size;
                if (yaochuCount >= 9) allowedActions.push('KYUUSHU');
            }

            if (pTarget.hand.length % 3 === 2 && !pTarget.riichi) {
                if (this.checkWin(targetPlayerId, null, true)) allowedActions.push('TSUMO');
                
                if (this.points[targetPlayerId] >= 1000 && this.isTenpai(targetPlayerId) && isMenzenTarget) {
                    allowedActions.push('RIICHI');
                }
                
                kanOptions = this.getKanOptions(targetPlayerId);
                if (kanOptions.ankan.length > 0) allowedActions.push('ANKAN');
                if (kanOptions.kakan.length > 0) allowedActions.push('KAKAN');
                
                if (this.settings.mode === 3 && pTarget.hand.some(t => YakuHelper.safeNormalize(t) === '4z')) {
                    allowedActions.push('KITA');
                }
            } else if (pTarget.hand.length % 3 === 2 && pTarget.riichi) {
                if (this.checkWin(targetPlayerId, null, true)) allowedActions.push('TSUMO');
            }
        } else if (this.phase === 'ACTION_WAIT' && this.waitingFor.includes(targetPlayerId)) {
            if (!this.actionResponses[targetPlayerId]) {
                let actualTargetTile = this.chankanTile !== null ? this.chankanTile : this.lastDiscardTile;
                if (!this.isFuriten(targetPlayerId) && this.checkWin(targetPlayerId, actualTargetTile, false, this.chankanTile !== null)) {
                    allowedActions.push('RON');
                }
                
                if (this.chankanTile === null && !pTarget.riichi) {
                    let handNorm = pTarget.hand.map(t => YakuHelper.safeNormalize(t));
                    let discNorm = YakuHelper.safeNormalize(this.lastDiscardTile);
                    let count = handNorm.filter(t => t === discNorm).length;
                    
                    if (count >= 3) allowedActions.push('MINKAN');
                    if (count >= 2) allowedActions.push('PON');
                    
                    chiOptions = this.getChiOptions(targetPlayerId, this.lastDiscardTile);
                    if (chiOptions.length > 0) allowedActions.push('CHI');
                }
                allowedActions.push('PASS'); 
            }
        }

        let roundName = CONSTANTS.WINDS[['1z','2z','3z','4z'].indexOf(this.roundWind)].replace('z', '') + this.kyoku + '局';

        return {
            phase: this.phase, turnPlayerId: this.turnManager.getCurrent(), wallCount: this.wall.length,
            hands: maskedHands, melds: mappedMelds, discards: mappedDiscards, allowedActions: allowedActions,
            chiOptions: chiOptions, kanOptions: kanOptions, forbiddenDiscards: forbiddenDiscards,
            lastDiscard: { playerId: this.lastDiscardPlayer, tile: this.chankanTile !== null ? this.chankanTile : this.lastDiscardTile },
            winner: this.winner, winningType: this.winningType, winningYaku: this.winningYaku, 
            riichiPlayers: mappedRiichi, // ③ riichiPlayers を確実に送信
            kitaPlayers: mappedKita, riichiIndex: mappedRiichiIndex, doraIndicators: this.doraIndicators,
            players: mappedPlayers, kyoutaku: this.kyoutaku,
            roundInfo: `${roundName} ${this.honba}本場`,
            finalResults: this.finalResults, endReason: this.endReason,
            winningTiles: winningTiles, winningTiles: winningTiles // 追加: 待ち牌情報
        };
    }
}

module.exports = MahjongGame;