class MahjongGame {
    constructor(playerIds, room) {
        this.room = room;
        this.playerIds = playerIds;
        this.wall = this.generateWall();
        this.hands = {};
        this.discards = {};
        this.turnIndex = 0;
        
        // 状態管理
        this.phase = 'DRAW'; // 'DRAW', 'ACTION_WAIT', 'FINISHED'
        this.lastDiscard = null; 
        this.actionResponses = {};
        this.winner = null;
        this.winningType = null; 
        this.winningYaku = null; 
        
        // リーチ宣言者の追跡
        this.riichiPlayers = {};

        playerIds.forEach(id => {
            this.hands[id] = [];
            this.discards[id] = [];
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

    // 14枚の手牌から「翻数」と「役のリスト」を算出する判定エンジン
    evaluateHand(tiles14, winTile, isTsumo, isRiichi, bakaze, jikaze) {
        let counts = {};
        tiles14.forEach(t => counts[t] = (counts[t] || 0) + 1);

        let maxHan = 0;
        let bestYaku = [];

        // 1. 国士無双の判定
        const yaochu = ['1m','9m','1p','9p','1s','9s','1z','2z','3z','4z','5z','6z','7z'];
        let isKokushi = yaochu.every(y => counts[y] >= 1);
        if (isKokushi) {
            let yaku = ['国士無双'];
            if (isTsumo) yaku.push('門前清自摸和');
            return { han: 13, yaku };
        }

        // 2. 七対子の判定
        let pairs = Object.keys(counts).filter(k => counts[k] === 2).length;
        if (pairs === 7) {
            let han = 2; let yaku = ['七対子'];
            let allStr = Object.keys(counts).join('');
            if (!allStr.match(/[19z]/)) { han += 1; yaku.push('タンヤオ'); }
            if (isRiichi) { han += 1; yaku.push('立直'); }
            if (isTsumo) { han += 1; yaku.push('門前清自摸和'); }
            if (!allStr.match(/[m]/) || !allStr.match(/[p]/) || !allStr.match(/[s]/)) {
                if (allStr.match(/[z]/)) { han += 3; yaku.push('混一色'); }
                else { han += 6; yaku.push('清一色'); }
            }
            if (!allStr.match(/[2345678]/)) { han += 2; yaku.push('混老頭'); }
            return { han, yaku };
        }

        // 3. 一般形（4面子1雀頭）の再帰的パターン抽出
        let patterns = [];
        const searchStandard = (currentCounts, melds, pair) => {
            let keys = Object.keys(currentCounts).filter(k => currentCounts[k] > 0).sort();
            if (keys.length === 0) {
                if (melds.length === 4 && pair) patterns.push({ melds: melds.slice(), pair });
                return;
            }
            let first = keys[0];
            
            // 雀頭
            if (!pair && currentCounts[first] >= 2) {
                currentCounts[first] -= 2;
                searchStandard(currentCounts, melds, first);
                currentCounts[first] += 2;
            }
            // 刻子
            if (currentCounts[first] >= 3) {
                currentCounts[first] -= 3;
                melds.push({ type: 'koutsu', tile: first });
                searchStandard(currentCounts, melds, pair);
                melds.pop();
                currentCounts[first] += 3;
            }
            // 順子
            let suit = first[1];
            let num = parseInt(first[0]);
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
        searchStandard({...counts}, [], null);

        // 4. パターンごとに役を評価
        for (let pat of patterns) {
            let han = 0; let yaku = [];
            let { melds, pair } = pat;
            let allTilesStr = tiles14.join('');

            if (isRiichi) { han += 1; yaku.push('立直'); }
            if (isTsumo) { han += 1; yaku.push('門前清自摸和'); }
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

            // 平和（ピンフ）
            if (shuntsu.length === 4 && !['5z','6z','7z',bakaze,jikaze].includes(pair)) {
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

            // 一盃口・二盃口
            let iipeiko = 0;
            if (shuntsu.length >= 2) {
                let sStr = shuntsu.map(s => s.tiles.join('')).sort();
                for(let i=0; i<sStr.length-1; i++) {
                    if(sStr[i] === sStr[i+1]) { iipeiko++; i++; }
                }
            }
            if (iipeiko === 1) { han += 1; yaku.push('一盃口'); }
            if (iipeiko === 2) { han += 3; yaku.push('二盃口'); }

            // 対々和・三暗刻
            if (koutsu.length === 4) { han += 2; yaku.push('対々和'); }
            let closedKoutsuCount = koutsu.length;
            if (!isTsumo && koutsu.some(m => m.tile === winTile)) closedKoutsuCount--; 
            if (closedKoutsuCount === 3) { han += 2; yaku.push('三暗刻'); }
            if (closedKoutsuCount === 4) { han += 13; yaku = ['四暗刻']; }

            // 三色同順
            let isSanshoku = false;
            for (let i=1; i<=7; i++) {
                if (shuntsu.some(s=>s.tiles[0]===`${i}m`) && shuntsu.some(s=>s.tiles[0]===`${i}p`) && shuntsu.some(s=>s.tiles[0]===`${i}s`)) {
                    isSanshoku = true; break;
                }
            }
            if (isSanshoku) { han += 2; yaku.push('三色同順'); }

            // 一気通貫
            let isIttsu = ['m','p','s'].some(suit => 
                shuntsu.some(s=>s.tiles[0]===`1${suit}`) && shuntsu.some(s=>s.tiles[0]===`4${suit}`) && shuntsu.some(s=>s.tiles[0]===`7${suit}`)
            );
            if (isIttsu) { han += 2; yaku.push('一気通貫'); }

            // 全帯・純全帯
            let isChanta = melds.every(m => m.type === 'koutsu' ? m.tile.match(/[19z]/) : m.tiles.some(t => t.match(/[19]/))) && pair.match(/[19z]/);
            let hasZ = allTilesStr.match(/[z]/);
            if (isChanta && !hasZ) { han += 3; yaku.push('純全帯幺九'); }
            else if (isChanta && hasZ) { han += 2; yaku.push('混全帯幺九'); }

            // 染め手
            if (!allTilesStr.match(/[m]/) || !allTilesStr.match(/[p]/) || !allTilesStr.match(/[s]/)) {
                if (hasZ) { han += 3; yaku.push('混一色'); }
                else { han += 6; yaku.push('清一色'); }
            }

            if (han > maxHan) { maxHan = han; bestYaku = yaku; }
        }

        return { han: maxHan, yaku: bestYaku };
    }

    checkYaku(playerId, winTile, isTsumo) {
        let tiles14 = [...this.hands[playerId]];
        if (!isTsumo) tiles14.push(winTile);

        let playerIndex = this.playerIds.indexOf(playerId);
        const winds = ['1z', '2z', '3z', '4z'];
        let jikaze = winds[playerIndex % 4];
        let bakaze = '1z';

        let result = this.evaluateHand(tiles14, winTile, isTsumo, this.riichiPlayers[playerId], bakaze, jikaze);
        return result.han >= 1 ? result : null;
    }

    // ★追加: テンパイ（リーチ可能か）を判定するアルゴリズム
    canRiichi(playerId) {
        if (this.riichiPlayers[playerId]) return false; // 既にリーチ済みなら不可
        
        let currentHand = this.hands[playerId];
        if (currentHand.length !== 14) return false;

        const allTiles = [
            '1m','2m','3m','4m','5m','6m','7m','8m','9m',
            '1p','2p','3p','4p','5p','6p','7p','8p','9p',
            '1s','2s','3s','4s','5s','6s','7s','8s','9s',
            '1z','2z','3z','4z','5z','6z','7z'
        ];

        let playerIndex = this.playerIds.indexOf(playerId);
        const winds = ['1z', '2z', '3z', '4z'];
        let jikaze = winds[playerIndex % 4];
        let bakaze = '1z';

        // 捨てる候補の牌（重複を除外して最適化）
        let uniqueDiscards = [...new Set(currentHand)];

        for (let i = 0; i < uniqueDiscards.length; i++) {
            let discardTile = uniqueDiscards[i];
            
            // 1枚抜いた13枚の手牌を作成（捨てるシミュレーション）
            let testHand = [...currentHand];
            testHand.splice(testHand.indexOf(discardTile), 1); 
            
            // どの牌を引けば和了できるか（待ち牌があるか）確認
            for (let j = 0; j < allTiles.length; j++) {
                let winTile = allTiles[j];
                
                // 既に自分の手牌で4枚使っている牌は物理的に引けないのでスキップ
                if (testHand.filter(t => t === winTile).length === 4) continue;

                let test14 = [...testHand, winTile];
                
                // もしリーチしたと仮定して、役（最低でもリーチの1翻）が成立するか確認
                let result = this.evaluateHand(test14, winTile, false, true, bakaze, jikaze);
                
                if (result.han > 0) {
                    return true; // テンパイになる捨て牌が少なくとも1つ存在する
                }
            }
        }
        return false;
    }

    handlePlayerAction(playerId, action) {
        if (this.phase === 'FINISHED') return;

        if (this.phase === 'DRAW') {
            if (playerId !== this.playerIds[this.turnIndex]) return;

            if (action.type === 'RIICHI') {
                // ★追加: 不正リクエスト防止のため、サーバー側でもテンパイ判定を行う
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
                        const yakuResult = this.checkYaku(id, tile, false);
                        if (yakuResult) {
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
                    // ★追加: AIもテンパイしていればリーチを宣言する
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
                    this.handlePlayerAction(playerId, { type: 'PASS' });
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
            let lastTile = this.hands[targetPlayerId][this.hands[targetPlayerId].length - 1];
            if (this.checkYaku(targetPlayerId, lastTile, true)) {
                allowedActions.push('TSUMO');
            }
            
            // ★変更: テンパイしている場合のみリーチボタンを許可
            if (this.canRiichi(targetPlayerId)) {
                allowedActions.push('RIICHI');
            }
        } else if (this.phase === 'ACTION_WAIT' && targetPlayerId !== this.lastDiscard.playerId) {
            if (!this.actionResponses[targetPlayerId]) {
                if (this.checkYaku(targetPlayerId, this.lastDiscard.tile, false)) {
                    allowedActions.push('RON');
                }
                allowedActions.push('PASS'); 
            }
        }

        return {
            phase: this.phase,
            turnPlayerId: this.playerIds[this.turnIndex],
            wallCount: this.wall.length,
            hands: maskedHands,
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