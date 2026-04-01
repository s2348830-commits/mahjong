class YakuEvaluator {
    // 【① 基礎関数】
    static countTiles(tiles) {
        const counts = {};
        tiles.forEach(t => counts[t] = (counts[t] || 0) + 1);
        return counts;
    }

    // 【③ 面子分解の改善：全パターン探索】
    static getAllMeldPatterns(counts, currentMelds = []) {
        let patterns = [];
        
        const search = (curCounts, melds, hasPair) => {
            let keys = Object.keys(curCounts).filter(k => curCounts[k] > 0).sort();
            if (keys.length === 0) {
                if (melds.length === 4 && hasPair) {
                    patterns.push({ melds: [...melds], pair: hasPair });
                }
                return;
            }
            
            let first = keys[0];
            
            // 雀頭として取る
            if (!hasPair && curCounts[first] >= 2) {
                let next = { ...curCounts };
                next[first] -= 2;
                search(next, melds, first);
            }
            
            // 刻子として取る
            if (curCounts[first] >= 3) {
                let next = { ...curCounts };
                next[first] -= 3;
                melds.push({ type: 'koutsu', tile: first });
                search(next, melds, hasPair);
                melds.pop();
            }
            
            // 順子として取る
            let num = parseInt(first[0]); let suit = first[1];
            if (suit !== 'z' && num <= 7) {
                let t2 = (num + 1) + suit; let t3 = (num + 2) + suit;
                if (curCounts[t2] > 0 && curCounts[t3] > 0) {
                    let next = { ...curCounts };
                    next[first]--; next[t2]--; next[t3]--;
                    melds.push({ type: 'shuntsu', tiles: [first, t2, t3] });
                    search(next, melds, hasPair);
                    melds.pop();
                }
            }
        };
        
        search({ ...counts }, [...currentMelds], null);
        return patterns;
    }

    // 【④ 役判定の分離】
    static isChiitoitsu(counts) {
        return Object.keys(counts).filter(k => counts[k] === 2).length === 7;
    }

    static isTanyao(allTiles) {
        return !allTiles.some(t => t.match(/[19z]/));
    }

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
        return count;
    }

    static countYakuhai(melds, bakaze, jikaze) {
        let count = 0;
        melds.forEach(m => {
            if (m.type === 'koutsu' || m.type === 'kantsu') {
                if (['5z','6z','7z', bakaze, jikaze].includes(m.tile)) count++;
            }
        });
        return count;
    }

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
        let isAllMeldChanta = melds.every(m => (m.type === 'koutsu' || m.type === 'kantsu') ? m.tile.match(/[19z]/) : m.tiles.some(t => t.match(/[19]/)));
        return isAllMeldChanta && pair.match(/[19z]/);
    }

    static isToitoi(melds) { 
        return melds.filter(m => m.type === 'koutsu' || m.type === 'kantsu').length === 4; 
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

    static isKokushi(counts) {
        const yaochu = ['1m','9m','1p','9p','1s','9s','1z','2z','3z','4z','5z','6z','7z'];
        return yaochu.every(y => counts[y] >= 1);
    }

    static isSuuankou(melds, declaredMelds, winTile, isTsumo) {
        let koutsu = melds.filter(m => m.type === 'koutsu' || m.type === 'kantsu');
        let closedKoutsuCount = koutsu.length - declaredMelds.filter(m => m.isOpen).length;
        if (!isTsumo && koutsu.some(m => m.tile === winTile)) closedKoutsuCount--;
        return closedKoutsuCount === 4;
    }

    static isDaisangen(melds) {
        let k = melds.filter(m => m.type === 'koutsu' || m.type === 'kantsu');
        return k.some(m=>m.tile==='5z') && k.some(m=>m.tile==='6z') && k.some(m=>m.tile==='7z');
    }

    // 【⑨ 統合関数】
    static checkWin(hand, declaredMelds, state) {
        let { winTile, isTsumo, isRiichi, bakaze, jikaze, debug } = state;
        // 暗槓は門前扱いを崩さない
        let isMenzen = declaredMelds.filter(m => m.isOpen).length === 0;
        
        let allTiles = [...hand];
        declaredMelds.forEach(m => { 
            if (m.type === 'koutsu') allTiles.push(m.tile, m.tile, m.tile);
            if (m.type === 'kantsu') allTiles.push(m.tile, m.tile, m.tile, m.tile); 
        });
        
        let counts = this.countTiles(hand);
        let maxHan = 0; let bestYaku = [];

        // 【⑤ 七対子・国士の分離】
        if (isMenzen && hand.length === 14) {
            if (this.isKokushi(counts)) {
                let yaku = ['国士無双']; if (isTsumo) yaku.push('門前清自摸和'); return { han: 13, yaku };
            }
            if (this.isChiitoitsu(counts)) {
                let han = 2; let yaku = ['七対子'];
                if (this.isTanyao(allTiles)) { han++; yaku.push('タンヤオ'); }
                if (isRiichi) { han++; yaku.push('立直'); }
                if (isTsumo) { han++; yaku.push('門前清自摸和'); }
                if (this.isHonitsu(allTiles)) { han+=3; yaku.push('混一色'); }
                else if (this.isChinitsu(allTiles)) { han+=6; yaku.push('清一色'); }
                return { han, yaku };
            }
        }

        // 一般形探索
        let patterns = this.getAllMeldPatterns(counts, declaredMelds);
        
        for (let pat of patterns) {
            let han = 0; let yaku = []; let { melds, pair } = pat;

            if (this.isSuuankou(melds, declaredMelds, winTile, isTsumo)) return { han: 13, yaku: ['四暗刻'] };
            if (this.isDaisangen(melds)) return { han: 13, yaku: ['大三元'] };

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
        
        if (debug && maxHan > 0) console.log(`[DEBUG] WIN FOUND: ${bestYaku.join(', ')} (${maxHan}翻)`);
        return maxHan > 0 ? { han: maxHan, yaku: bestYaku } : null;
    }

    static getWinningTiles(hand, declaredMelds, stateTemplate) {
        const allTiles = ['1m','2m','3m','4m','5m','6m','7m','8m','9m','1p','2p','3p','4p','5p','6p','7p','8p','9p','1s','2s','3s','4s','5s','6s','7s','8s','9s','1z','2z','3z','4z','5z','6z','7z'];
        let winning = [];
        for (let winTile of allTiles) {
            let totalCount = hand.filter(t => t === winTile).length;
            declaredMelds.forEach(m => { if (m.tile === winTile) totalCount += (m.type === 'kantsu' ? 4 : 3); });
            if (totalCount >= 4) continue;
            
            let state = { ...stateTemplate, winTile: winTile, isTsumo: false };
            if (this.checkWin([...hand, winTile], declaredMelds, state)) winning.push(winTile);
        }
        return winning;
    }

    static getReachableDiscards(hand, declaredMelds, stateTemplate) {
        if (declaredMelds.filter(m => m.isOpen).length > 0) return [];
        let reachable = [];
        for (let i = 0; i < hand.length; i++) {
            let testHand = [...hand];
            testHand.splice(i, 1);
            let winningTiles = this.getWinningTiles(testHand, declaredMelds, stateTemplate);
            if (winningTiles.length > 0) reachable.push({ index: i, tile: hand[i], winningTiles });
        }
        return reachable;
    }

    static isTenpai(hand, declaredMelds, stateTemplate) {
        let hLen = hand.length;
        if (hLen % 3 === 2) return this.getReachableDiscards(hand, declaredMelds, stateTemplate).length > 0;
        if (hLen % 3 === 1) return this.getWinningTiles(hand, declaredMelds, stateTemplate).length > 0;
        return false;
    }
}

class MahjongGame {
    constructor(playerIds, room) {
        this.room = room;
        this.playerIds = playerIds;
        this.wall = this.generateWall();
        
        this.players = {};
        playerIds.forEach(id => {
            this.players[id] = { hand: [], discards: [], melds: [], riichi: false };
        });
        
        this.currentTurn = 0; 
        this.lastDiscardTile = null; 
        this.lastDiscardPlayer = null;
        
        this.phase = 'DRAW';
        this.actionResponses = {};
        this.waitingFor = [];
        this.winner = null;
        this.winningType = null; 
        this.winningYaku = null; 
    }

    generateWall() {
        const tiles = [];
        const suits = ['m', 'p', 's'];
        for (let suit of suits) {
            for (let i = 1; i <= 9; i++) { for(let j=0; j<4; j++) tiles.push(i + suit); }
        }
        for (let i = 1; i <= 7; i++) { for(let j=0; j<4; j++) tiles.push(i + 'z'); }
        return tiles.sort(() => Math.random() - 0.5);
    }

    start() {
        this.playerIds.forEach(id => {
            for (let i = 0; i < 13; i++) { this.players[id].hand.push(this.wall.pop()); }
        });
        this.phase = 'DRAW';
        this.drawTile(this.playerIds[this.currentTurn]);
        this.room.broadcastState();
        this.broadcastTenpaiInfo(); 
        this.triggerAILogic(this.playerIds[this.currentTurn]);
    }

    drawTile(playerId) {
        if (this.wall.length > 0) this.players[playerId].hand.push(this.wall.pop());
    }

    checkWin(playerId, winTile, isTsumo) {
        let player = this.players[playerId];
        let tilesFree = [...player.hand];
        if (!isTsumo && winTile) tilesFree.push(winTile);
        
        let actualWinTile = winTile || player.hand[player.hand.length - 1];
        let playerIndex = this.playerIds.indexOf(playerId);
        const winds = ['1z', '2z', '3z', '4z'];
        
        let state = {
            winTile: actualWinTile, isTsumo: isTsumo, isRiichi: player.riichi,
            bakaze: '1z', jikaze: winds[playerIndex % 4], debug: false
        };
        return YakuEvaluator.checkWin(tilesFree, player.melds, state);
    }

    getWinningTiles(playerId, testHand = null) {
        let p = this.players[playerId];
        let hand = testHand || p.hand;
        let playerIndex = this.playerIds.indexOf(playerId);
        const winds = ['1z', '2z', '3z', '4z'];
        let stateTemplate = { isRiichi: p.riichi || true, bakaze: '1z', jikaze: winds[playerIndex % 4] };
        return YakuEvaluator.getWinningTiles(hand, p.melds, stateTemplate);
    }

    getReachableDiscards(playerId) {
        let p = this.players[playerId];
        let playerIndex = this.playerIds.indexOf(playerId);
        const winds = ['1z', '2z', '3z', '4z'];
        let stateTemplate = { isRiichi: true, bakaze: '1z', jikaze: winds[playerIndex % 4] };
        return YakuEvaluator.getReachableDiscards(p.hand, p.melds, stateTemplate);
    }

    isTenpai(playerId) {
        let p = this.players[playerId];
        let playerIndex = this.playerIds.indexOf(playerId);
        const winds = ['1z', '2z', '3z', '4z'];
        let stateTemplate = { isRiichi: p.riichi || true, bakaze: '1z', jikaze: winds[playerIndex % 4] };
        return YakuEvaluator.isTenpai(p.hand, p.melds, stateTemplate);
    }

    broadcastTenpaiInfo() {
        this.playerIds.forEach(id => {
            let p = this.players[id];
            let winningTiles = [];
            if (p.hand.length % 3 === 1) {
                winningTiles = this.getWinningTiles(id, p.hand);
            } else if (p.hand.length % 3 === 2) {
                if (p.riichi) {
                    let testHand = [...p.hand]; testHand.pop();
                    winningTiles = this.getWinningTiles(id, testHand);
                } else {
                    let discards = this.getReachableDiscards(id);
                    let set = new Set();
                    discards.forEach(d => d.winningTiles.forEach(wt => set.add(wt)));
                    winningTiles = Array.from(set);
                }
            }
            
            const playerInfo = this.room.players.get(id);
            if (playerInfo && playerInfo.ws && playerInfo.ws.readyState === 1) {
                playerInfo.ws.send(JSON.stringify({ type: 'TENPAI_INFO', payload: { winningTiles } }));
            }
        });
    }

    canPon(playerId, tile) {
        let player = this.players[playerId];
        if (player.riichi) return false;
        return player.hand.filter(t => t === tile).length >= 2;
    }

    // ★追加: カンができるか判定
    canKan(playerId, tile = null) {
        let player = this.players[playerId];
        if (player.riichi) return false; // リーチ後は一旦不可（送り槓等非対応）
        
        if (this.phase === 'ACTION_WAIT' && tile) {
            // 大明槓
            return player.hand.filter(t => t === tile).length >= 3;
        } else if (this.phase === 'DRAW' && playerId === this.playerIds[this.currentTurn]) {
            // 暗槓
            let counts = YakuEvaluator.countTiles(player.hand);
            for (let k in counts) { if (counts[k] === 4) return k; }
            // 加槓
            for (let meld of player.melds) {
                if (meld.type === 'koutsu' && player.hand.includes(meld.tile)) return meld.tile;
            }
        }
        return false;
    }

    canRon(playerId, tile) { return this.checkWin(playerId, tile, false) !== null; }

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
                let canK = this.canKan(id, tile); // 大明槓
                if (canR || canP || canK) this.waitingFor.push(id);
                else this.actionResponses[id] = 'PASS';
            }
        });

        if (this.waitingFor.length > 0) {
            this.phase = 'ACTION_WAIT';
            this.room.broadcastState();
            this.broadcastTenpaiInfo();
            this.waitingFor.forEach(id => this.triggerAILogic(id));
        } else {
            this.phase = 'DRAW';
            this.currentTurn = (this.currentTurn + 1) % this.playerIds.length;
            this.drawTile(this.playerIds[this.currentTurn]);
            this.room.broadcastState();
            this.broadcastTenpaiInfo();
            this.triggerAILogic(this.playerIds[this.currentTurn]);
        }
    }

    resolveActions() {
        let allResponded = this.playerIds.every(id => id === this.lastDiscardPlayer || this.actionResponses[id]);
        if (!allResponded) return;

        let ronPlayer = null; let ponPlayer = null; let kanPlayer = null;
        let discardIdx = this.playerIds.indexOf(this.lastDiscardPlayer);
        for (let i = 1; i < this.playerIds.length; i++) {
            let idx = (discardIdx + i) % this.playerIds.length;
            let id = this.playerIds[idx];
            if (this.actionResponses[id] === 'RON' && !ronPlayer) ronPlayer = id;
            else if (this.actionResponses[id] === 'PON' && !ponPlayer) ponPlayer = id;
            else if (this.actionResponses[id] === 'KAN' && !kanPlayer) kanPlayer = id;
        }

        if (ronPlayer) {
            let yakuResult = this.checkWin(ronPlayer, this.lastDiscardTile, false);
            this.phase = 'FINISHED'; this.winner = ronPlayer; this.winningType = 'RON'; this.winningYaku = yakuResult;
            this.players[ronPlayer].hand.push(this.lastDiscardTile);
            this.room.broadcastState();
            setTimeout(() => this.room.endGame(), 7000);
        } else if (ponPlayer || kanPlayer) {
            let activeId = ponPlayer || kanPlayer;
            let player = this.players[activeId];
            let t = this.lastDiscardTile; 
            let removeCount = ponPlayer ? 2 : 3; // ポンなら2枚、大明槓なら3枚削除
            
            let c = 0;
            for (let i = player.hand.length - 1; i >= 0; i--) {
                if (player.hand[i] === t && c < removeCount) { player.hand.splice(i, 1); c++; }
            }
            player.melds.push({ type: ponPlayer ? 'koutsu' : 'kantsu', tile: t, isOpen: true });
            
            this.currentTurn = this.playerIds.indexOf(activeId);
            this.actionResponses = {}; this.waitingFor = [];
            
            if (kanPlayer) this.drawTile(activeId); // 嶺上ツモ
            
            this.phase = 'DRAW'; 
            this.room.broadcastState();
            this.broadcastTenpaiInfo();
            this.triggerAILogic(activeId); 
        } else {
            this.phase = 'DRAW';
            this.currentTurn = (this.currentTurn + 1) % this.playerIds.length;
            this.drawTile(this.playerIds[this.currentTurn]);
            this.room.broadcastState();
            this.broadcastTenpaiInfo();
            this.triggerAILogic(this.playerIds[this.currentTurn]);
        }
    }

    handlePlayerAction(playerId, action) {
        if (this.phase === 'FINISHED') return;

        if (this.phase === 'DRAW') {
            if (playerId !== this.playerIds[this.currentTurn]) return;

            if (action.type === 'RIICHI') {
                let discards = this.getReachableDiscards(playerId);
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
                let target = this.getReachableDiscards(playerId).find(d => d.index === action.payload.tileIndex);
                if (target) {
                    this.players[playerId].riichi = true;
                    this.handleDiscard(playerId, action.payload.tileIndex);
                }
                return;
            }
            
            // ★追加: 暗槓・加槓の処理
            if (action.type === 'KAN') {
                let kanTile = this.canKan(playerId);
                if (kanTile) {
                    let player = this.players[playerId];
                    let counts = YakuEvaluator.countTiles(player.hand);
                    if (counts[kanTile] === 4) {
                        // 暗槓
                        for(let i=0; i<4; i++) player.hand.splice(player.hand.indexOf(kanTile), 1);
                        player.melds.push({ type: 'kantsu', tile: kanTile, isOpen: false });
                    } else {
                        // 加槓
                        player.hand.splice(player.hand.indexOf(kanTile), 1);
                        let m = player.melds.find(m => m.type === 'koutsu' && m.tile === kanTile);
                        if (m) { m.type = 'kantsu'; m.isOpen = true; }
                    }
                    this.drawTile(playerId); // 嶺上ツモ
                    this.room.broadcastState();
                    this.broadcastTenpaiInfo();
                    this.triggerAILogic(playerId);
                }
                return;
            }

            if (action.type === 'DISCARD') {
                this.handleDiscard(playerId, action.payload.tileIndex);
            } else if (action.type === 'TSUMO') {
                let yakuResult = this.checkWin(playerId, null, true);
                if (yakuResult) {
                    this.phase = 'FINISHED'; this.winner = playerId; this.winningType = 'TSUMO'; this.winningYaku = yakuResult; 
                    this.room.broadcastState();
                    setTimeout(() => this.room.endGame(), 7000); 
                }
            }
        } 
        else if (this.phase === 'ACTION_WAIT') {
            if (playerId === this.lastDiscardPlayer || !this.waitingFor.includes(playerId)) return;
            if (action.type === 'RON' && this.canRon(playerId, this.lastDiscardTile)) this.actionResponses[playerId] = 'RON';
            else if (action.type === 'PON' && this.canPon(playerId, this.lastDiscardTile)) this.actionResponses[playerId] = 'PON';
            else if (action.type === 'KAN' && this.canKan(playerId, this.lastDiscardTile)) this.actionResponses[playerId] = 'KAN';
            else if (action.type === 'PASS') this.actionResponses[playerId] = 'PASS';
            this.resolveActions();
        }
    }

    triggerAILogic(playerId) {
        let player = this.players[playerId];
        const playerInfo = this.room.players.get(playerId);
        let isBot = playerInfo && playerInfo.isAI;
        let isRiichi = player.riichi;

        if (this.phase === 'DRAW' && playerId === this.playerIds[this.currentTurn]) {
            if (isBot || isRiichi) { 
                setTimeout(() => {
                    if (this.phase !== 'DRAW') return;
                    let canWin = this.checkWin(playerId, null, true);
                    if (canWin) {
                        this.handlePlayerAction(playerId, { type: 'TSUMO' });
                    } else {
                        if (isBot && !isRiichi && this.isTenpai(playerId)) {
                            this.handlePlayerAction(playerId, { type: 'RIICHI' });
                        } else {
                            this.handlePlayerAction(playerId, { type: 'DISCARD', payload: { tileIndex: player.hand.length - 1 }});
                        }
                    }
                }, 1000);
            }
        } else if (this.phase === 'ACTION_WAIT' && this.waitingFor.includes(playerId)) {
            if (isBot) {
                setTimeout(() => {
                    if (this.phase !== 'ACTION_WAIT') return;
                    if (this.canRon(playerId, this.lastDiscardTile)) this.handlePlayerAction(playerId, { type: 'RON' });
                    else this.handlePlayerAction(playerId, { type: 'PASS' });
                }, 800);
            }
        }
    }

    getClientState(targetPlayerId) {
        const maskedHands = {}; const mappedMelds = {}; const mappedDiscards = {}; const mappedRiichi = {};

        this.playerIds.forEach(id => {
            let p = this.players[id];
            if (id === targetPlayerId || this.phase === 'FINISHED' || this.room.settings.openHands) maskedHands[id] = p.hand;
            else maskedHands[id] = p.hand.map(() => 'back');
            mappedMelds[id] = p.melds; mappedDiscards[id] = p.discards; mappedRiichi[id] = p.riichi;
        });

        let allowedActions = [];
        if (this.phase === 'DRAW' && targetPlayerId === this.playerIds[this.currentTurn]) {
            let p = this.players[targetPlayerId];
            if (p.hand.length % 3 === 2 && !p.riichi) {
                if (this.checkWin(targetPlayerId, null, true)) allowedActions.push('TSUMO');
                if (this.canKan(targetPlayerId)) allowedActions.push('KAN');
                if (this.isTenpai(targetPlayerId)) allowedActions.push('RIICHI');
            } else if (p.hand.length % 3 === 2 && p.riichi) {
                if (this.checkWin(targetPlayerId, null, true)) allowedActions.push('TSUMO');
            }
        } else if (this.phase === 'ACTION_WAIT' && this.waitingFor.includes(targetPlayerId)) {
            if (!this.actionResponses[targetPlayerId]) {
                if (this.canRon(targetPlayerId, this.lastDiscardTile)) allowedActions.push('RON');
                if (this.canPon(targetPlayerId, this.lastDiscardTile)) allowedActions.push('PON');
                if (this.canKan(targetPlayerId, this.lastDiscardTile)) allowedActions.push('KAN');
                allowedActions.push('PASS'); 
            }
        }

        return {
            phase: this.phase, turnPlayerId: this.playerIds[this.currentTurn], wallCount: this.wall.length,
            hands: maskedHands, melds: mappedMelds, discards: mappedDiscards, allowedActions: allowedActions,
            lastDiscard: { playerId: this.lastDiscardPlayer, tile: this.lastDiscardTile },
            winner: this.winner, winningType: this.winningType, winningYaku: this.winningYaku, riichiPlayers: mappedRiichi
        };
    }
    
    // 【② テスト機能】10回連続で結果がブレないかチェック
    static testYaku() {
        console.log("=== YAKU TEST START ===");
        const testCases = [
            { name: "タンヤオ・ピンフ", hand: ["2m","3m","4m","2p","3p","4p","3s","4s","5s","6p","7p","8p","6s"], win: "6s", tsumo: true },
            { name: "七対子", hand: ["1m","1m","2m","2m","3m","3m","4p","4p","5p","5p","6s","6s","1z"], win: "1z", tsumo: true },
            { name: "役満・大三元", hand: ["5z","5z","5z","6z","6z","6z","7z","7z","7z","1m","2m","3m","2p"], win: "2p", tsumo: false }
        ];

        testCases.forEach(tc => {
            console.log(`\n[TEST: ${tc.name}] 手牌: ${tc.hand.join(',')} | アタリ: ${tc.win}`);
            let state = { winTile: tc.win, isTsumo: tc.tsumo, isRiichi: false, bakaze: "1z", jikaze: "1z", debug: false };
            
            let firstResult = JSON.stringify(YakuEvaluator.checkWin(tc.hand, [], state));
            let passed = true;
            for (let i = 0; i < 10; i++) {
                let res = JSON.stringify(YakuEvaluator.checkWin(tc.hand, [], state));
                if (res !== firstResult) { passed = false; console.error(`Mismatch at iter ${i}: ${res}`); }
            }
            console.log(`-> Result: ${firstResult} | Stability: ${passed ? 'OK' : 'FAILED'}`);
        });
        console.log("=== YAKU TEST END ===");
    }
}
module.exports = MahjongGame;