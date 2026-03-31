// ==========================================
// STEP 1〜9: 役判定エンジン (独立してテスト可能)
// ==========================================
class YakuEvaluator {
    // 【STEP 1: 牌の表現統一・基礎関数】
    static countTiles(tiles) {
        const counts = {};
        tiles.forEach(t => counts[t] = (counts[t] || 0) + 1);
        return counts;
    }

    static sortHand(tiles) {
        const order = { 'm': 1, 'p': 2, 's': 3, 'z': 4 };
        return [...tiles].sort((a, b) => {
            if (order[a[1]] !== order[b[1]]) return order[a[1]] - order[b[1]];
            return parseInt(a[0]) - parseInt(b[0]);
        });
    }

    // 【STEP 2: 和了形チェック (4面子1雀頭のパターン抽出)】
    static getStandardPatterns(counts, currentMelds = []) {
        let patterns = [];
        const search = (curCounts, melds, pair) => {
            let keys = Object.keys(curCounts).filter(k => curCounts[k] > 0).sort();
            if (keys.length === 0) {
                if (melds.length === 4 && pair) patterns.push({ melds: [...melds], pair });
                return;
            }
            let first = keys[0];
            
            // 雀頭として抜く
            if (!pair && curCounts[first] >= 2) {
                curCounts[first] -= 2;
                search(curCounts, melds, first);
                curCounts[first] += 2;
            }
            // 刻子として抜く
            if (curCounts[first] >= 3) {
                curCounts[first] -= 3;
                melds.push({ type: 'koutsu', tile: first });
                search(curCounts, melds, pair);
                melds.pop();
                curCounts[first] += 3;
            }
            // 順子として抜く
            let num = parseInt(first[0]); let suit = first[1];
            if (suit !== 'z' && num <= 7) {
                let t2 = (num + 1) + suit; let t3 = (num + 2) + suit;
                if (curCounts[t2] > 0 && curCounts[t3] > 0) {
                    curCounts[first]--; curCounts[t2]--; curCounts[t3]--;
                    melds.push({ type: 'shuntsu', tiles: [first, t2, t3] });
                    search(curCounts, melds, pair);
                    melds.pop();
                    curCounts[first]++; curCounts[t2]++; curCounts[t3]++;
                }
            }
        };
        search({...counts}, [...currentMelds], null);
        return patterns;
    }

    // 【STEP 3: 七対子チェック】
    static isChiitoitsu(counts) {
        let pairs = Object.keys(counts).filter(k => counts[k] === 2).length;
        return pairs === 7;
    }

    // 【STEP 4: 簡単な役】
    static isTanyao(allTiles) {
        return !allTiles.some(t => t.match(/[19z]/));
    }
    static countYakuhai(melds, bakaze, jikaze) {
        let count = 0;
        melds.filter(m => m.type === 'koutsu').forEach(m => {
            if (['5z','6z','7z', bakaze, jikaze].includes(m.tile)) count++;
        });
        return count;
    }

    // 【STEP 5: 平和・一盃口】
    static isPinfu(melds, pair, bakaze, jikaze, isMenzen, winTile) {
        if (!isMenzen) return false;
        let shuntsu = melds.filter(m => m.type === 'shuntsu');
        if (shuntsu.length !== 4) return false;
        if (['5z','6z','7z', bakaze, jikaze].includes(pair)) return false;
        
        return shuntsu.some(s => {
            if (s.tiles.includes(winTile)) {
                let wNum = parseInt(winTile[0]);
                let sNums = s.tiles.map(t => parseInt(t[0]));
                if ((wNum === sNums[0] && wNum !== 7) || (wNum === sNums[2] && wNum !== 3)) return true;
            }
            return false;
        });
    }
    static isIipeikou(melds, isMenzen) {
        if (!isMenzen) return 0;
        let shuntsu = melds.filter(m => m.type === 'shuntsu').map(s => s.tiles.join('')).sort();
        let count = 0;
        for(let i=0; i<shuntsu.length-1; i++) {
            if(shuntsu[i] === shuntsu[i+1]) { count++; i++; }
        }
        return count; // 1: 一盃口, 2: 二盃口
    }

    // 【STEP 6: 複合役】
    static isSanshoku(melds) {
        let shuntsu = melds.filter(m => m.type === 'shuntsu');
        for (let i=1; i<=7; i++) {
            if (shuntsu.some(s=>s.tiles[0]===`${i}m`) && shuntsu.some(s=>s.tiles[0]===`${i}p`) && shuntsu.some(s=>s.tiles[0]===`${i}s`)) return true;
        }
        return false;
    }
    static isIttsuu(melds) {
        let shuntsu = melds.filter(m => m.type === 'shuntsu');
        return ['m','p','s'].some(suit => 
            shuntsu.some(s=>s.tiles[0]===`1${suit}`) && shuntsu.some(s=>s.tiles[0]===`4${suit}`) && shuntsu.some(s=>s.tiles[0]===`7${suit}`)
        );
    }
    static isChanta(melds, pair) {
        let isAllMeldChanta = melds.every(m => m.type === 'koutsu' ? m.tile.match(/[19z]/) : m.tiles.some(t => t.match(/[19]/)));
        return isAllMeldChanta && pair.match(/[19z]/);
    }

    // 【STEP 7: 対々和・混一色・清一色】
    static isToitoi(melds) {
        return melds.filter(m => m.type === 'koutsu').length === 4;
    }
    static isHonitsu(allTiles) {
        let hasZ = allTiles.some(t => t.match(/z/));
        let suits = new Set(allTiles.filter(t => !t.match(/z/)).map(t => t[1]));
        return hasZ && suits.size === 1;
    }
    static isChinitsu(allTiles) {
        let hasZ = allTiles.some(t => t.match(/z/));
        let suits = new Set(allTiles.map(t => t[1]));
        return !hasZ && suits.size === 1;
    }

    // 【STEP 8: 役満 (簡略化)】
    static isKokushi(counts) {
        const yaochu = ['1m','9m','1p','9p','1s','9s','1z','2z','3z','4z','5z','6z','7z'];
        return yaochu.every(y => counts[y] >= 1);
    }
    static isSuuankou(melds, declaredMelds, winTile, isTsumo) {
        let koutsu = melds.filter(m => m.type === 'koutsu');
        let closedKoutsuCount = koutsu.length - declaredMelds.length;
        if (!isTsumo && koutsu.some(m => m.tile === winTile)) closedKoutsuCount--;
        return closedKoutsuCount === 4;
    }
    static isDaisangen(melds) {
        let koutsu = melds.filter(m => m.type === 'koutsu');
        return koutsu.some(m=>m.tile==='5z') && koutsu.some(m=>m.tile==='6z') && koutsu.some(m=>m.tile==='7z');
    }

    // 【STEP 9: 統合関数】
    static checkWin(hand, declaredMelds, state) {
        let { winTile, isTsumo, isRiichi, bakaze, jikaze } = state;
        let isMenzen = declaredMelds.length === 0;
        
        let allTiles = [...hand];
        declaredMelds.forEach(m => { if (m.type === 'koutsu') allTiles.push(m.tile, m.tile, m.tile); });
        
        let counts = this.countTiles(hand);
        let maxHan = 0;
        let bestYaku = [];

        // 役満チェック (国士無双)
        if (isMenzen && hand.length === 14 && this.isKokushi(counts)) {
            let yaku = ['国士無双'];
            if (isTsumo) yaku.push('門前清自摸和');
            return { han: 13, yaku };
        }

        // 七対子チェック
        if (isMenzen && hand.length === 14 && this.isChiitoitsu(counts)) {
            let han = 2; let yaku = ['七対子'];
            if (this.isTanyao(allTiles)) { han++; yaku.push('タンヤオ'); }
            if (isRiichi) { han++; yaku.push('立直'); }
            if (isTsumo) { han++; yaku.push('門前清自摸和'); }
            if (this.isHonitsu(allTiles)) { han+=3; yaku.push('混一色'); }
            else if (this.isChinitsu(allTiles)) { han+=6; yaku.push('清一色'); }
            return { han, yaku };
        }

        // 一般手チェック (全和了形パターンから最大翻数を探す)
        let patterns = this.getStandardPatterns(counts, declaredMelds);
        for (let pat of patterns) {
            let han = 0; let yaku = [];
            let { melds, pair } = pat;

            // 役満
            if (this.isSuuankou(melds, declaredMelds, winTile, isTsumo)) return { han: 13, yaku: ['四暗刻'] };
            if (this.isDaisangen(melds)) return { han: 13, yaku: ['大三元'] };

            // 1翻〜
            if (isRiichi && isMenzen) { han++; yaku.push('立直'); }
            if (isTsumo && isMenzen) { han++; yaku.push('門前清自摸和'); }
            if (this.isTanyao(allTiles)) { han++; yaku.push('タンヤオ'); }
            
            let yakuhaiCount = this.countYakuhai(melds, bakaze, jikaze);
            if (yakuhaiCount > 0) { han += yakuhaiCount; yaku.push('役牌'); }

            if (this.isPinfu(melds, pair, bakaze, jikaze, isMenzen, winTile)) { han++; yaku.push('平和'); }
            
            let iipeikouCount = this.isIipeikou(melds, isMenzen);
            if (iipeikouCount === 1) { han++; yaku.push('一盃口'); }
            else if (iipeikouCount === 2) { han+=3; yaku.push('二盃口'); }

            if (this.isToitoi(melds)) { han+=2; yaku.push('対々和'); }

            let chanta = this.isChanta(melds, pair);
            let hasZ = allTiles.some(t => t.match(/z/));
            if (chanta && !hasZ) { han += (isMenzen?3:2); yaku.push('純全帯幺九'); }
            else if (chanta && hasZ) { han += (isMenzen?2:1); yaku.push('混全帯幺九'); }

            if (this.isSanshoku(melds)) { han += (isMenzen?2:1); yaku.push('三色同順'); }
            if (this.isIttsuu(melds)) { han += (isMenzen?2:1); yaku.push('一気通貫'); }

            if (this.isHonitsu(allTiles)) { han += (isMenzen?3:2); yaku.push('混一色'); }
            else if (this.isChinitsu(allTiles)) { han += (isMenzen?6:5); yaku.push('清一色'); }

            if (han > maxHan) { maxHan = han; bestYaku = yaku; }
        }

        return maxHan > 0 ? { han: maxHan, yaku: bestYaku } : null;
    }
}

// ==========================================
// ゲーム進行管理クラス
// ==========================================
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

    // ⑦ checkWin ラッパー関数
    checkWin(playerId, winTile, isTsumo) {
        let player = this.players[playerId];
        let tilesFree = [...player.hand];
        if (!isTsumo && winTile) tilesFree.push(winTile);
        
        let actualWinTile = winTile || player.hand[player.hand.length - 1];
        let playerIndex = this.playerIds.indexOf(playerId);
        const winds = ['1z', '2z', '3z', '4z'];
        
        let state = {
            winTile: actualWinTile,
            isTsumo: isTsumo,
            isRiichi: player.riichi,
            bakaze: '1z',
            jikaze: winds[playerIndex % 4]
        };
        
        return YakuEvaluator.checkWin(tilesFree, player.melds, state);
    }

    // ⑦ canPon判定
    canPon(playerId, tile) {
        let player = this.players[playerId];
        if (player.riichi) return false; // リーチ後はポン不可
        return player.hand.filter(t => t === tile).length >= 2;
    }

    // ⑦ canRon判定
    canRon(playerId, tile) {
        return this.checkWin(playerId, tile, false) !== null;
    }

    // ⑦ isTenpai判定 (リーチ可能か)
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
                
                let state = { winTile: winTile, isTsumo: false, isRiichi: true, bakaze: '1z', jikaze: '1z' };
                let result = YakuEvaluator.checkWin([...testHand, winTile], [], state);
                if (result) return true;
            }
        }
        return false;
    }

    // ⑦ handleDiscard処理
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

        // ⑤ ACTION_WAIT への遷移
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

    // ⑦ resolveActions (全員の応答を待って処理)
    resolveActions() {
        let allResponded = this.playerIds.every(id => 
            id === this.lastDiscardPlayer || this.actionResponses[id]
        );
        if (!allResponded) return;

        let ronPlayer = null;
        let ponPlayer = null;

        // 頭ハネ処理（ツモ順に近い人を優先）
        let discardIdx = this.playerIds.indexOf(this.lastDiscardPlayer);
        for (let i = 1; i < this.playerIds.length; i++) {
            let idx = (discardIdx + i) % this.playerIds.length;
            let id = this.playerIds[idx];
            if (this.actionResponses[id] === 'RON' && !ronPlayer) ronPlayer = id;
            else if (this.actionResponses[id] === 'PON' && !ponPlayer) ponPlayer = id;
        }

        // 優先順位: ロン > ポン > スキップ
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
            
            // ポンしたプレイヤーにターン移動
            this.currentTurn = this.playerIds.indexOf(ponPlayer);
            this.phase = 'DRAW';
            this.actionResponses = {};
            this.waitingFor = [];
            this.room.broadcastState();
            this.triggerAILogic(ponPlayer); 
        } else {
            // 全員パスなら次へ
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
                let yakuResult = this.checkWin(playerId, null, true);
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

    // ⑥ ターン制御・AIロジック
    triggerAILogic(playerId) {
        let player = this.players[playerId];
        const playerInfo = this.room.players.get(playerId);
        let isBot = playerInfo && playerInfo.isAI;
        let isRiichi = player.riichi;

        if (this.phase === 'DRAW' && playerId === this.playerIds[this.currentTurn]) {
            // ④ リーチ後 または AIは自動でツモ切り
            if (isBot || isRiichi) {
                setTimeout(() => {
                    if (this.phase !== 'DRAW') return;
                    let canWin = this.checkWin(playerId, null, true);
                    
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
                if (this.checkWin(targetPlayerId, null, true)) allowedActions.push('TSUMO');
                if (this.isTenpai(targetPlayerId)) allowedActions.push('RIICHI');
            } else if (p.hand.length % 3 === 2 && p.riichi) {
                if (this.checkWin(targetPlayerId, null, true)) allowedActions.push('TSUMO');
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