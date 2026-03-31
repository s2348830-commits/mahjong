class MahjongGame {
    constructor(playerIds, room) {
        this.room = room;
        this.playerIds = playerIds;
        this.wall = this.generateWall();
        
        // ⑧ データ構造の統一
        this.players = {};
        playerIds.forEach(id => {
            this.players[id] = {
                hand: [],
                discards: [],
                melds: [],
                riichi: false
            };
        });
        
        // 状態管理
        this.currentTurn = 0; 
        this.lastDiscardTile = null; 
        this.lastDiscardPlayer = null;
        
        this.phase = 'DRAW'; // 'DRAW', 'ACTION_WAIT', 'FINISHED'
        this.actionResponses = {};
        this.waitingFor = []; // 応答待ちのプレイヤーIDリスト
        
        this.winner = null;
        this.winningType = null; 
        this.winningYaku = null; 
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
                this.players[id].hand.push(this.wall.pop());
            }
        });
        this.phase = 'DRAW';
        this.drawTile(this.playerIds[this.currentTurn]);
        this.room.broadcastState();
        this.triggerAILogic(this.playerIds[this.currentTurn]);
    }

    drawTile(playerId) {
        if (this.wall.length > 0) {
            this.players[playerId].hand.push(this.wall.pop());
        }
    }

    // ① 役の完全実装
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

        // 国士無双
        if (isMenzen && tilesFree.length === 14) {
            const yaochu = ['1m','9m','1p','9p','1s','9s','1z','2z','3z','4z','5z','6z','7z'];
            if (yaochu.every(y => counts[y] >= 1)) {
                let yaku = ['国士無双'];
                if (isTsumo) yaku.push('門前清自摸和');
                return { han: 13, yaku };
            }
        }

        // 七対子
        if (isMenzen && tilesFree.length === 14) {
            let pairs = Object.keys(counts).filter(k => counts[k] === 2).length;
            if (pairs === 7) {
                let han = 2; let yaku = ['七対子'];
                if (!allTilesStr.match(/[19z]/)) { han += 1; yaku.push('タンヤオ'); }
                if (isRiichi) { han += 1; yaku.push('立直'); }
                if (isTsumo) { han += 1; yaku.push('門前清自摸和'); }
                if (!allTilesStr.match(/[m]/) || !allTilesStr.match(/[p]/) || !allTilesStr.match(/[s]/)) {
                    if (allTilesStr.match(/[z]/)) { han += 3; yaku.push('混一色'); }
                    else { han += 6; yaku.push('清一色'); }
                }
                return { han, yaku };
            }
        }

        // 一般形の探索
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

        searchStandard({...counts}, [...playerMelds], null);

        // 役の判定
        for (let pat of patterns) {
            let han = 0; let yaku = [];
            let { melds, pair } = pat;

            if (isRiichi && isMenzen) { han += 1; yaku.push('立直'); }
            if (isTsumo && isMenzen) { han += 1; yaku.push('門前清自摸和'); }
            if (!allTilesStr.match(/[19z]/)) { han += 1; yaku.push('タンヤオ'); }

            let shuntsu = melds.filter(m => m.type === 'shuntsu');
            let koutsu = melds.filter(m => m.type === 'koutsu');

            // 役牌
            let yakuhaiCount = 0;
            koutsu.forEach(m => {
                if (m.tile === '5z') { yakuhaiCount++; yaku.push('白'); }
                if (m.tile === '6z') { yakuhaiCount++; yaku.push('發'); }
                if (m.tile === '7z') { yakuhaiCount++; yaku.push('中'); }
                if (m.tile === bakaze) { yakuhaiCount++; yaku.push('場風'); }
                if (m.tile === jikaze) { yakuhaiCount++; yaku.push('自風'); }
            });
            han += yakuhaiCount;

            // 平和
            if (shuntsu.length === 4 && !['5z','6z','7z',bakaze,jikaze].includes(pair) && isMenzen) {
                let isRyanmen = shuntsu.some(s => {
                    if (s.tiles.includes(winTile)) {
                        let wNum = parseInt(winTile[0]);
                        let sNums = s.tiles.map(t => parseInt(t[0]));
                        if ((wNum === sNums[0] && wNum !== 7) || (wNum === sNums[2] && wNum !== 3)) return true;
                    }
                    return false;
                });
                if (isRyanmen) { han += 1; yaku.push('平和'); }
            }

            // 一盃口
            if (isMenzen) {
                let iipeiko = 0;
                let sStr = shuntsu.map(s => s.tiles.join('')).sort();
                for(let i=0; i<sStr.length-1; i++) {
                    if(sStr[i] === sStr[i+1]) { iipeiko++; i++; }
                }
                if (iipeiko >= 1) { han += 1; yaku.push('一盃口'); }
            }

            // 対々和
            if (koutsu.length === 4) { han += 2; yaku.push('対々和'); }

            // チャンタ
            let isChanta = melds.every(m => m.type === 'koutsu' ? m.tile.match(/[19z]/) : m.tiles.some(t => t.match(/[19]/))) && pair.match(/[19z]/);
            let hasZ = allTilesStr.match(/[z]/);
            if (isChanta && !hasZ) { han += (isMenzen?3:2); yaku.push('純全帯幺九'); }
            else if (isChanta && hasZ) { han += (isMenzen?2:1); yaku.push('混全帯幺九'); }

            // 三色同順・同刻、一気通貫
            let isSanshoku = false;
            let isSanshokuDoukoku = false;
            for (let i=1; i<=7; i++) {
                if (shuntsu.some(s=>s.tiles[0]===`${i}m`) && shuntsu.some(s=>s.tiles[0]===`${i}p`) && shuntsu.some(s=>s.tiles[0]===`${i}s`)) isSanshoku = true;
            }
            for (let i=1; i<=9; i++) {
                if (koutsu.some(m=>m.tile===`${i}m`) && koutsu.some(m=>m.tile===`${i}p`) && koutsu.some(m=>m.tile===`${i}s`)) isSanshokuDoukoku = true;
            }
            let isIttsu = ['m','p','s'].some(suit => shuntsu.some(s=>s.tiles[0]===`1${suit}`) && shuntsu.some(s=>s.tiles[0]===`4${suit}`) && shuntsu.some(s=>s.tiles[0]===`7${suit}`));
            
            if (isSanshoku) { han += (isMenzen?2:1); yaku.push('三色同順'); }
            if (isSanshokuDoukoku) { han += 2; yaku.push('三色同刻'); }
            if (isIttsu) { han += (isMenzen?2:1); yaku.push('一気通貫'); }

            // 染め手
            if (!allTilesStr.match(/[m]/) || !allTilesStr.match(/[p]/) || !allTilesStr.match(/[s]/)) {
                if (hasZ) { han += (isMenzen?3:2); yaku.push('混一色'); }
                else { han += (isMenzen?6:5); yaku.push('清一色'); }
            }

            // 大三元・四暗刻
            if (koutsu.some(m=>m.tile==='5z') && koutsu.some(m=>m.tile==='6z') && koutsu.some(m=>m.tile==='7z')) { han += 13; yaku = ['大三元']; }
            let closedKoutsuCount = koutsu.length - playerMelds.length;
            if (!isTsumo && koutsu.some(m => m.tile === winTile)) closedKoutsuCount--; 
            if (closedKoutsuCount === 4) { han += 13; yaku = ['四暗刻']; }

            if (han > maxHan) { maxHan = han; bestYaku = yaku; }
        }
        return { han: maxHan, yaku: bestYaku };
    }

    // ⑦ checkWin(hand) -> 役判定ラッパー
    checkWin(playerId, winTile, isTsumo) {
        let player = this.players[playerId];
        let tilesFree = [...player.hand];
        if (!isTsumo && winTile) tilesFree.push(winTile);
        
        let playerIndex = this.playerIds.indexOf(playerId);
        const winds = ['1z', '2z', '3z', '4z'];
        let result = this.evaluateHand(tilesFree, player.melds, player.melds.length === 0, winTile, isTsumo, player.riichi, '1z', winds[playerIndex % 4]);
        return result.han >= 1 ? result : null;
    }

    // ⑦ canPon(player, tile)
    canPon(playerId, tile) {
        let player = this.players[playerId];
        if (player.riichi) return false;
        return player.hand.filter(t => t === tile).length >= 2;
    }

    // ⑦ canRon(player, tile)
    canRon(playerId, tile) {
        return this.checkWin(playerId, tile, false) !== null;
    }

    // ⑦ isTenpai(hand)
    isTenpai(playerId) {
        let player = this.players[playerId];
        if (player.riichi || player.melds.length > 0) return false; 
        
        let currentHand = player.hand;
        if (currentHand.length !== 14) return false;

        const allTiles = ['1m','2m','3m','4m','5m','6m','7m','8m','9m','1p','2p','3p','4p','5p','6p','7p','8p','9p','1s','2s','3s','4s','5s','6s','7s','8s','9s','1z','2z','3z','4z','5z','6z','7z'];
        let uniqueDiscards = [...new Set(currentHand)];

        for (let discardTile of uniqueDiscards) {
            let testHand = [...currentHand];
            testHand.splice(testHand.indexOf(discardTile), 1); 
            for (let winTile of allTiles) {
                if (testHand.filter(t => t === winTile).length === 4) continue;
                let result = this.evaluateHand([...testHand, winTile], [], true, winTile, false, true, '1z', '1z');
                if (result.han > 0) return true;
            }
        }
        return false;
    }

    // ⑦ handleDiscard(player, tile)
    handleDiscard(playerId, tileIndex) {
        let player = this.players[playerId];
        const tile = player.hand.splice(tileIndex, 1)[0];
        player.discards.push(tile);
        
        this.lastDiscardTile = tile;
        this.lastDiscardPlayer = playerId;
        this.actionResponses = {};
        this.waitingFor = [];
        
        this.playerIds.forEach(id => {
            if (id !== playerId) {
                let canR = this.canRon(id, tile);
                let canP = this.canPon(id, tile);
                if (canR || canP) {
                    this.waitingFor.push(id);
                } else {
                    this.actionResponses[id] = 'PASS';
                }
            }
        });

        // ⑤ ACTION_WAIT の強化
        if (this.waitingFor.length > 0) {
            this.phase = 'ACTION_WAIT';
            this.room.broadcastState();
            this.waitingFor.forEach(id => this.triggerAILogic(id));
        } else {
            this.phase = 'DRAW';
            this.currentTurn = (this.currentTurn + 1) % this.playerIds.length;
            this.drawTile(this.playerIds[this.currentTurn]);
            this.room.broadcastState();
            this.triggerAILogic(this.playerIds[this.currentTurn]);
        }
    }

    // ⑦ resolveActions() -> 全員の応答を待つ仕組み
    resolveActions() {
        let allResponded = this.playerIds.every(id => 
            id === this.lastDiscardPlayer || this.actionResponses[id]
        );
        if (!allResponded) return;

        let ronPlayer = null;
        let ponPlayer = null;

        // 頭ハネ（近い順）
        let discardIdx = this.playerIds.indexOf(this.lastDiscardPlayer);
        for (let i = 1; i < this.playerIds.length; i++) {
            let idx = (discardIdx + i) % this.playerIds.length;
            let id = this.playerIds[idx];
            if (this.actionResponses[id] === 'RON' && !ronPlayer) ronPlayer = id;
            else if (this.actionResponses[id] === 'PON' && !ponPlayer) ponPlayer = id;
        }

        if (ronPlayer) {
            let yakuResult = this.checkWin(ronPlayer, this.lastDiscardTile, false);
            this.phase = 'FINISHED';
            this.winner = ronPlayer;
            this.winningType = 'RON';
            this.winningYaku = yakuResult;
            this.players[ronPlayer].hand.push(this.lastDiscardTile);
            this.room.broadcastState();
            setTimeout(() => this.room.endGame(), 7000);
        } else if (ponPlayer) {
            let player = this.players[ponPlayer];
            let t = this.lastDiscardTile;
            let c = 0;
            for (let i = player.hand.length - 1; i >= 0; i--) {
                if (player.hand[i] === t && c < 2) {
                    player.hand.splice(i, 1);
                    c++;
                }
            }
            player.melds.push({ type: 'koutsu', tile: t });
            
            this.currentTurn = this.playerIds.indexOf(ponPlayer);
            this.phase = 'DRAW';
            this.actionResponses = {};
            this.waitingFor = [];
            this.room.broadcastState();
            this.triggerAILogic(ponPlayer); // ③ ターン移動後の処理
        } else {
            this.phase = 'DRAW';
            this.currentTurn = (this.currentTurn + 1) % this.playerIds.length;
            this.drawTile(this.playerIds[this.currentTurn]);
            this.room.broadcastState();
            this.triggerAILogic(this.playerIds[this.currentTurn]);
        }
    }

    handlePlayerAction(playerId, action) {
        if (this.phase === 'FINISHED') return;

        if (this.phase === 'DRAW') {
            if (playerId !== this.playerIds[this.currentTurn]) return;

            if (action.type === 'RIICHI') {
                if (this.isTenpai(playerId)) {
                    this.players[playerId].riichi = true;
                    this.room.broadcastState();
                }
                return;
            }

            if (action.type === 'DISCARD') {
                this.handleDiscard(playerId, action.payload.tileIndex);
            } else if (action.type === 'TSUMO') {
                let player = this.players[playerId];
                let lastTile = player.hand[player.hand.length - 1];
                let yakuResult = this.checkWin(playerId, lastTile, true);
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
            if (playerId === this.lastDiscardPlayer || !this.waitingFor.includes(playerId)) return;

            if (action.type === 'RON' && this.canRon(playerId, this.lastDiscardTile)) {
                this.actionResponses[playerId] = 'RON';
            } else if (action.type === 'PON' && this.canPon(playerId, this.lastDiscardTile)) {
                this.actionResponses[playerId] = 'PON';
            } else if (action.type === 'PASS') {
                this.actionResponses[playerId] = 'PASS';
            }
            this.resolveActions();
        }
    }

    triggerAILogic(playerId) {
        let player = this.players[playerId];
        const playerInfo = this.room.players.get(playerId);
        let isBot = playerInfo && playerInfo.isAI;
        let isRiichi = player.riichi;

        if (this.phase === 'DRAW' && playerId === this.playerIds[this.currentTurn]) {
            // ④ リーチ後は自動でツモ切り
            if (isBot || isRiichi) {
                setTimeout(() => {
                    if (this.phase !== 'DRAW') return;
                    let lastTile = player.hand[player.hand.length - 1];
                    let canWin = this.checkWin(playerId, lastTile, true);
                    
                    if (canWin) {
                        this.handlePlayerAction(playerId, { type: 'TSUMO' });
                    } else {
                        if (isBot && !isRiichi && this.isTenpai(playerId)) {
                            this.handlePlayerAction(playerId, { type: 'RIICHI' });
                        }
                        this.handlePlayerAction(playerId, { type: 'DISCARD', payload: { tileIndex: player.hand.length - 1 }});
                    }
                }, 1000);
            }
        } else if (this.phase === 'ACTION_WAIT' && this.waitingFor.includes(playerId)) {
            if (isBot) {
                setTimeout(() => {
                    if (this.phase !== 'ACTION_WAIT') return;
                    if (this.canRon(playerId, this.lastDiscardTile)) {
                        this.handlePlayerAction(playerId, { type: 'RON' });
                    } else {
                        this.handlePlayerAction(playerId, { type: 'PASS' });
                    }
                }, 800);
            }
        }
    }

    getClientState(targetPlayerId) {
        const maskedHands = {};
        const mappedMelds = {};
        const mappedDiscards = {};
        const mappedRiichi = {};

        this.playerIds.forEach(id => {
            let p = this.players[id];
            if (id === targetPlayerId || this.phase === 'FINISHED' || this.room.settings.openHands) {
                maskedHands[id] = p.hand;
            } else {
                maskedHands[id] = p.hand.map(() => 'back');
            }
            mappedMelds[id] = p.melds;
            mappedDiscards[id] = p.discards;
            mappedRiichi[id] = p.riichi;
        });

        let allowedActions = [];
        if (this.phase === 'DRAW' && targetPlayerId === this.playerIds[this.currentTurn]) {
            let p = this.players[targetPlayerId];
            if (p.hand.length % 3 === 2 && !p.riichi) {
                let lastTile = p.hand[p.hand.length - 1];
                if (this.checkWin(targetPlayerId, lastTile, true)) allowedActions.push('TSUMO');
                if (this.isTenpai(targetPlayerId)) allowedActions.push('RIICHI');
            } else if (p.hand.length % 3 === 2 && p.riichi) {
                let lastTile = p.hand[p.hand.length - 1];
                if (this.checkWin(targetPlayerId, lastTile, true)) allowedActions.push('TSUMO');
            }
        } else if (this.phase === 'ACTION_WAIT' && this.waitingFor.includes(targetPlayerId)) {
            if (!this.actionResponses[targetPlayerId]) {
                if (this.canRon(targetPlayerId, this.lastDiscardTile)) allowedActions.push('RON');
                if (this.canPon(targetPlayerId, this.lastDiscardTile)) allowedActions.push('PON');
                allowedActions.push('PASS'); 
            }
        }

        return {
            phase: this.phase,
            turnPlayerId: this.playerIds[this.currentTurn],
            wallCount: this.wall.length,
            hands: maskedHands,
            melds: mappedMelds,
            discards: mappedDiscards,
            allowedActions: allowedActions,
            lastDiscard: { playerId: this.lastDiscardPlayer, tile: this.lastDiscardTile },
            winner: this.winner,
            winningType: this.winningType,
            winningYaku: this.winningYaku,
            riichiPlayers: mappedRiichi
        };
    }
}
module.exports = MahjongGame;