class MahjongGame {
    constructor(playerIds, room) {
        this.room = room;
        this.playerIds = playerIds;
        this.wall = this.generateWall();
        this.hands = {};
        this.discards = {};
        this.melds = {}; // ★追加: 鳴き（ポン）の管理
        this.turnIndex = 0;
        
        // 状態管理
        this.phase = 'DRAW'; // 'DRAW', 'ACTION_WAIT', 'FINISHED'
        this.lastDiscard = null; 
        this.actionResponses = {};
        this.winner = null;
        this.winningType = null; 
        this.winningYaku = null; 
        
        this.riichiPlayers = {};

        playerIds.forEach(id => {
            this.hands[id] = [];
            this.discards[id] = [];
            this.melds[id] = [];
            this.riichiPlayers[id] = false;
        });
    }

    generateWall() {
        const tiles = [];
        const suits = ['m', 'p', 's'];
        for (let suit of suits) {
            for (let i = 1; i <= 9; i++) {
                for(let j=0; j<4; j++) tiles.push(i + suit);
            }
        }
        for (let i = 1; i <= 7; i++) {
            for(let j=0; j<4; j++) tiles.push(i + 'z');
        }
        return tiles.sort(() => Math.random() - 0.5);
    }

    start() {
        this.playerIds.forEach(id => {
            for (let i = 0; i < 13; i++) {
                this.hands[id].push(this.wall.pop());
            }
        });
        this.phase = 'DRAW';
        this.drawTile(this.playerIds[this.turnIndex]);
        this.room.broadcastState();
        this.triggerAILogic(this.playerIds[this.turnIndex]);
    }

    drawTile(playerId) {
        if (this.wall.length > 0) {
            this.hands[playerId].push(this.wall.pop());
        }
    }

    // 鳴きを含めた和了判定エンジン
    evaluateHand(tilesFree, playerMelds, isMenzen, winTile, isTsumo, isRiichi, bakaze, jikaze) {
        let counts = {};
        tilesFree.forEach(t => counts[t] = (counts[t] || 0) + 1);

        let maxHan = 0;
        let bestYaku = [];
        let allTiles = [...tilesFree];
        playerMelds.forEach(m => {
            if (m.type === 'koutsu') {
                allTiles.push(m.tile, m.tile, m.tile);
            }
        });
        let allTilesStr = allTiles.join('');

        // 1. 国士無双 (門前のみ)
        if (isMenzen && tilesFree.length === 14) {
            const yaochu = ['1m','9m','1p','9p','1s','9s','1z','2z','3z','4z','5z','6z','7z'];
            if (yaochu.every(y => counts[y] >= 1)) {
                let yaku = ['国士無双'];
                if (isTsumo) yaku.push('門前清自摸和');
                return { han: 13, yaku };
            }
        }

        // 2. 七対子 (門前のみ)
        if (isMenzen && tilesFree.length === 14) {
            let pairs = Object.keys(counts).filter(k => counts[k] === 2).length;
            if (pairs === 7) {
                let han = 2; let yaku = ['七対子'];
                if (!allTilesStr.match(/[19z]/)) { han += 1; yaku.push('タンヤオ'); }
                if (isRiichi) { han += 1; yaku.push('立直'); }
                if (isTsumo) { han += 1; yaku.push('門前清自摸和'); }
                return { han, yaku };
            }
        }

        // 3. 一般形の探索
        let patterns = [];
        const searchStandard = (currentCounts, melds, pair) => {
            let keys = Object.keys(currentCounts).filter(k => currentCounts[k] > 0).sort();
            if (keys.length === 0) {
                if (melds.length === 4 && pair) patterns.push({ melds: melds.slice(), pair });
                return;
            }
            let first = keys[0];
            
            if (!pair && currentCounts[first] >= 2) {
                currentCounts[first] -= 2;
                searchStandard(currentCounts, melds, first);
                currentCounts[first] += 2;
            }
            if (currentCounts[first] >= 3) {
                currentCounts[first] -= 3;
                melds.push({ type: 'koutsu', tile: first });
                searchStandard(currentCounts, melds, pair);
                melds.pop();
                currentCounts[first] += 3;
            }
            let suit = first[1]; let num = parseInt(first[0]);
            if (suit !== 'z' && num <= 7) {
                let t2 = (num+1)+suit; let t3 = (num+2)+suit;
                if (currentCounts[t2] > 0 && currentCounts[t3] > 0) {
                    currentCounts[first]--; currentCounts[t2]--; currentCounts[t3]--;
                    melds.push({ type: 'shuntsu', tiles: [first, t2, t3] });
                    searchStandard(currentCounts, melds, pair);
                    melds.pop();
                    currentCounts[first]++; currentCounts[t2]++; currentCounts[t3]++;
                }
            }
        };

        // 探索開始 (既存の鳴き面子を初期状態として渡す)
        searchStandard({...counts}, [...playerMelds], null);

        // 4. 役の判定
        for (let pat of patterns) {
            let han = 0; let yaku = [];
            let { melds, pair } = pat;

            if (isRiichi && isMenzen) { han += 1; yaku.push('立直'); }
            if (isTsumo && isMenzen) { han += 1; yaku.push('門前清自摸和'); }
            if (!allTilesStr.match(/[19z]/)) { han += 1; yaku.push('タンヤオ'); }

            let koutsu = melds.filter(m => m.type === 'koutsu');
            let yakuhaiCount = 0;
            koutsu.forEach(m => {
                if (m.tile === '5z') { yakuhaiCount++; yaku.push('白'); }
                if (m.tile === '6z') { yakuhaiCount++; yaku.push('發'); }
                if (m.tile === '7z') { yakuhaiCount++; yaku.push('中'); }
                if (m.tile === bakaze) { yakuhaiCount++; yaku.push('場風'); }
                if (m.tile === jikaze) { yakuhaiCount++; yaku.push('自風'); }
            });
            han += yakuhaiCount;

            // 染め手
            let hasZ = allTilesStr.match(/[z]/);
            if (!allTilesStr.match(/[m]/) || !allTilesStr.match(/[p]/) || !allTilesStr.match(/[s]/)) {
                let someHan = isMenzen ? 3 : 2;
                let chinHan = isMenzen ? 6 : 5;
                if (hasZ) { han += someHan; yaku.push('混一色'); }
                else { han += chinHan; yaku.push('清一色'); }
            }

            if (koutsu.length === 4) { han += 2; yaku.push('対々和'); }

            if (han > maxHan) { maxHan = han; bestYaku = yaku; }
        }

        return { han: maxHan, yaku: bestYaku };
    }

    checkYaku(playerId, winTile, isTsumo) {
        let tilesFree = [...this.hands[playerId]];
        if (!isTsumo && winTile) tilesFree.push(winTile);
        
        let playerMelds = this.melds[playerId] || [];
        let isMenzen = playerMelds.length === 0;

        let playerIndex = this.playerIds.indexOf(playerId);
        const winds = ['1z', '2z', '3z', '4z'];
        let jikaze = winds[playerIndex % 4];
        let bakaze = '1z';

        let result = this.evaluateHand(tilesFree, playerMelds, isMenzen, winTile, isTsumo, this.riichiPlayers[playerId], bakaze, jikaze);
        return result.han >= 1 ? result : null;
    }

    canRiichi(playerId) {
        if (this.riichiPlayers[playerId]) return false; 
        if (this.melds[playerId] && this.melds[playerId].length > 0) return false; // 鳴いている場合はリーチ不可
        
        let currentHand = this.hands[playerId];
        if (currentHand.length !== 14) return false;

        const allTiles = [
            '1m','2m','3m','4m','5m','6m','7m','8m','9m',
            '1p','2p','3p','4p','5p','6p','7p','8p','9p',
            '1s','2s','3s','4s','5s','6s','7s','8s','9s',
            '1z','2z','3z','4z','5z','6z','7z'
        ];
        let uniqueDiscards = [...new Set(currentHand)];

        for (let i = 0; i < uniqueDiscards.length; i++) {
            let discardTile = uniqueDiscards[i];
            let testHand = [...currentHand];
            testHand.splice(testHand.indexOf(discardTile), 1); 
            
            for (let j = 0; j < allTiles.length; j++) {
                let winTile = allTiles[j];
                if (testHand.filter(t => t === winTile).length === 4) continue;
                
                let result = this.evaluateHand([...testHand, winTile], [], true, winTile, false, true, '1z', '1z');
                if (result.han > 0) return true;
            }
        }
        return false;
    }

    handlePlayerAction(playerId, action) {
        if (this.phase === 'FINISHED') return;

        if (this.phase === 'DRAW') {
            if (playerId !== this.playerIds[this.turnIndex]) return;

            if (action.type === 'RIICHI') {
                if (this.canRiichi(playerId)) {
                    this.riichiPlayers[playerId] = true;
                    this.room.broadcastState();
                }
                return;
            }

            if (action.type === 'DISCARD') {
                const tileIndex = action.payload.tileIndex;
                const tile = this.hands[playerId].splice(tileIndex, 1)[0];
                this.discards[playerId].push(tile);
                this.lastDiscard = { playerId, tile };
                
                this.phase = 'ACTION_WAIT';
                this.actionResponses = {};
                
                let needsWait = false;
                this.playerIds.forEach(id => {
                    if (id !== playerId) {
                        // ロン判定
                        let canRon = this.checkYaku(id, tile, false);
                        // ポン判定（手牌に同じ牌が2枚以上あるか）
                        let sameCount = this.hands[id].filter(t => t === tile).length;
                        let canPon = sameCount >= 2 && !this.riichiPlayers[id];

                        if (canRon || canPon) {
                            needsWait = true;
                        } else {
                            this.actionResponses[id] = 'PASS';
                        }
                    }
                });

                if (!needsWait) {
                    this.phase = 'DRAW';
                    this.turnIndex = (this.turnIndex + 1) % this.playerIds.length;
                    this.drawTile(this.playerIds[this.turnIndex]);
                }

                this.room.broadcastState();

                if (needsWait) {
                    this.playerIds.forEach(id => {
                        if (id !== playerId && !this.actionResponses[id]) this.triggerAILogic(id);
                    });
                } else {
                    this.triggerAILogic(this.playerIds[this.turnIndex]);
                }

            } else if (action.type === 'TSUMO') {
                let lastTile = this.hands[playerId][this.hands[playerId].length - 1];
                let yakuResult = this.checkYaku(playerId, lastTile, true);
                if (yakuResult) {
                    this.phase = 'FINISHED';
                    this.winner = playerId;
                    this.winningType = 'TSUMO';
                    this.winningYaku = yakuResult; 
                    this.room.broadcastState();
                    setTimeout(() => this.room.endGame(), 7000); 
                }
            }
        } 
        else if (this.phase === 'ACTION_WAIT') {
            if (playerId === this.lastDiscard.playerId) return;

            if (action.type === 'RON') {
                let yakuResult = this.checkYaku(playerId, this.lastDiscard.tile, false);
                if (yakuResult) {
                    this.phase = 'FINISHED';
                    this.winner = playerId;
                    this.winningType = 'RON';
                    this.winningYaku = yakuResult;
                    this.hands[playerId].push(this.lastDiscard.tile); 
                    this.room.broadcastState();
                    setTimeout(() => this.room.endGame(), 7000);
                }
                
            } else if (action.type === 'PON') {
                // 手牌から該当の牌を2枚削除
                let t = this.lastDiscard.tile;
                let c = 0;
                for (let i = this.hands[playerId].length - 1; i >= 0; i--) {
                    if (this.hands[playerId][i] === t && c < 2) {
                        this.hands[playerId].splice(i, 1);
                        c++;
                    }
                }
                this.melds[playerId].push({ type: 'koutsu', tile: t });
                
                // ターンを移して打牌待ちに強制遷移
                this.turnIndex = this.playerIds.indexOf(playerId);
                this.phase = 'DRAW';
                this.actionResponses = {};
                this.room.broadcastState();

            } else if (action.type === 'PASS') {
                this.actionResponses[playerId] = 'PASS';
                const allPassed = this.playerIds.every(id => 
                    id === this.lastDiscard.playerId || this.actionResponses[id] === 'PASS'
                );

                if (allPassed) {
                    this.phase = 'DRAW';
                    this.turnIndex = (this.turnIndex + 1) % this.playerIds.length;
                    this.drawTile(this.playerIds[this.turnIndex]);
                    this.room.broadcastState();
                    this.triggerAILogic(this.playerIds[this.turnIndex]);
                }
            }
        }
    }

    triggerAILogic(playerId) {
        const playerInfo = this.room.players.get(playerId);
        if (!playerInfo || !playerInfo.isAI) return;

        if (this.phase === 'DRAW' && playerId === this.playerIds[this.turnIndex]) {
            setTimeout(() => {
                if (this.phase !== 'DRAW') return;
                
                let lastTile = this.hands[playerId][this.hands[playerId].length - 1];
                if (this.checkYaku(playerId, lastTile, true)) {
                    this.handlePlayerAction(playerId, { type: 'TSUMO' });
                } else {
                    if (this.canRiichi(playerId)) {
                        this.handlePlayerAction(playerId, { type: 'RIICHI' });
                    }
                    this.handlePlayerAction(playerId, { type: 'DISCARD', payload: { tileIndex: this.hands[playerId].length - 1 }});
                }
            }, 1000);
        } else if (this.phase === 'ACTION_WAIT' && playerId !== this.lastDiscard.playerId && !this.actionResponses[playerId]) {
            setTimeout(() => {
                if (this.phase !== 'ACTION_WAIT') return;
                
                if (this.checkYaku(playerId, this.lastDiscard.tile, false)) {
                    this.handlePlayerAction(playerId, { type: 'RON' });
                } else {
                    this.handlePlayerAction(playerId, { type: 'PASS' }); // AIはポンスキップ
                }
            }, 800);
        }
    }

    getClientState(targetPlayerId) {
        const maskedHands = {};
        this.playerIds.forEach(id => {
            if (id === targetPlayerId || this.phase === 'FINISHED' || this.room.settings.openHands) {
                maskedHands[id] = this.hands[id];
            } else {
                maskedHands[id] = this.hands[id].map(() => 'back');
            }
        });

        let allowedActions = [];
        if (this.phase === 'DRAW' && targetPlayerId === this.playerIds[this.turnIndex]) {
            // ツモは14枚の時（もしくはポン後以外）に判定
            if (this.hands[targetPlayerId].length % 3 === 2) {
                let lastTile = this.hands[targetPlayerId][this.hands[targetPlayerId].length - 1];
                if (this.checkYaku(targetPlayerId, lastTile, true)) {
                    allowedActions.push('TSUMO');
                }
            }
            if (this.canRiichi(targetPlayerId)) allowedActions.push('RIICHI');
        } else if (this.phase === 'ACTION_WAIT' && targetPlayerId !== this.lastDiscard.playerId) {
            if (!this.actionResponses[targetPlayerId]) {
                if (this.checkYaku(targetPlayerId, this.lastDiscard.tile, false)) allowedActions.push('RON');
                let sameCount = this.hands[targetPlayerId].filter(t => t === this.lastDiscard.tile).length;
                if (sameCount >= 2 && !this.riichiPlayers[targetPlayerId]) allowedActions.push('PON');
                allowedActions.push('PASS'); 
            }
        }

        return {
            phase: this.phase,
            turnPlayerId: this.playerIds[this.turnIndex],
            wallCount: this.wall.length,
            hands: maskedHands,
            melds: this.melds, // ★ポンした牌をクライアントに送る
            discards: this.discards,
            allowedActions: allowedActions,
            lastDiscard: this.lastDiscard,
            winner: this.winner,
            winningType: this.winningType,
            winningYaku: this.winningYaku,
            riichiPlayers: this.riichiPlayers
        };
    }
}
module.exports = MahjongGame;